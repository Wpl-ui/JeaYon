import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { first, rows, type Database, type Connection } from '../db/index.js';
import { ApiError } from '../http.js';
import { audit } from '../audit.js';
import { ipKey, keyedHash, normalize, otpHash, otpMatches, otpUsable, tokenHash, type OtpFields } from './crypto.js';
import { assertPasswordPolicy, hashPassword, verifyPassword, verifyPasswordOrDummy } from './password.js';
import { quota, reserve, windows } from './quotas.js';
import type { EmailSender, SmsSender } from './providers.js';
export type Actor = { userId: string; sessionId: string; expiresAt: number };
type Session = { id: string; user_id: string; revoked_at: Date | null; absolute_expires_at: Date; idle_expires_at: Date; status: string };
type Otp = OtpFields & { code_hmac: Buffer; state: string; attempts: number; expires_at: Date };
const requestSchema = z.object({ channel: z.enum(['email', 'phone']), target: z.string().max(512), purpose: z.enum(['login', 'register']) }).strict();
const verifySchema = z.object({ challenge_id: z.uuid(), code: z.string().max(256) }).strict();
const registerSchema = verifySchema.extend({ password: z.string().max(256) }).strict();
const passwordLoginSchema = z.object({
  channel: z.enum(['email', 'phone']),
  target: z.string().max(512),
  password: z.string().max(256),
}).strict();
const setPasswordSchema = z.object({
  password: z.string().max(256),
  current_password: z.string().min(1).max(256),
  reauth_token: z.string().min(1).max(256),
}).strict();
const updateProfileSchema = z.object({
  name: z.string().transform(value => value.replace(/^ +| +$/g, '')).refine(value => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 40 && !/^\s*$/.test(value) && !value.includes('\0');
  }),
}).strict();
const validSession = (s: Session | undefined): s is Session => !!s && !s.revoked_at && s.status === 'active' && Math.min(s.absolute_expires_at.getTime(), s.idle_expires_at.getTime()) > Date.now();
export class AuthService {
  readonly accessName: string;
  readonly refreshName: string;
  private secure: boolean;
  constructor(private db: Database, private c: Config, private providers: { email: EmailSender; sms: SmsSender }) {
    this.secure = new URL(c.APP_ORIGIN).protocol === 'https:';
    this.accessName = this.secure ? '__Secure-dwa_access' : 'dwa_access';
    this.refreshName = this.secure ? '__Secure-dwa_refresh' : 'dwa_refresh';
  }
  private ip(req: FastifyRequest) { return ipKey(req.ip); }
  async request(req: FastifyRequest) {
    const body = requestSchema.parse(req.body);
    const target = normalize(body.channel, body.target);
    return this.sendOtp(req, { channel: body.channel, target_normalized: target, purpose: body.purpose });
  }
  private async sendOtp(req: FastifyRequest, input: Omit<OtpFields, 'id'>) {
    const { channel, target_normalized: target, purpose } = input;
    const scope = (name: string) => purpose === 'login' ? name : `${purpose}_${name}`;
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const challengeId = randomUUID();
    const fields = { ...input, id: challengeId };
    await this.db.transaction().execute(async tx => {
      if (input.bound_user_id && input.bound_session_id) {
        await sql`select id from users where id=${input.bound_user_id} for update`.execute(tx);
        const session = await first(tx, sql<Session>`select s.*,u.status from sessions s join users u on u.id=s.user_id where s.id=${input.bound_session_id} and s.user_id=${input.bound_user_id} for update of s`);
        if (!validSession(session)) throw new ApiError(401, 'unauthenticated');
      }
      await reserve(tx, this.c.RATE_LIMIT_HMAC_SECRET, [
        { scope: scope('send_cooldown'), key: target, seconds: 60, max: 1, cooldown: true },
        ...windows(scope('send_target'), target, [[3600, 5], [86400, 20]]),
        ...windows(scope('send_ip'), this.ip(req), [[60, 10], [3600, 30], [86400, 100]]),
        ...windows('send_budget', channel, [[86400, channel === 'email' ? this.c.OTP_EMAIL_DAILY_CAP : this.c.OTP_SMS_DAILY_CAP]]),
      ]);
      await sql`update otp_codes set state='superseded' where channel=${channel} and target_normalized=${target} and purpose=${purpose} and state in ('pending','sent')`.execute(tx);
      await sql`insert into otp_codes(id,channel,target_normalized,purpose,bound_user_id,bound_session_id,code_hmac,key_version,state,expires_at,request_ip_hash)
        values(${challengeId},${channel},${target},${purpose},${input.bound_user_id ?? null},${input.bound_session_id ?? null},${otpHash(this.c.OTP_PEPPER, fields, code)},1,'pending',now()+interval '5 minutes',${keyedHash(this.c.RATE_LIMIT_HMAC_SECRET, this.ip(req))})`.execute(tx);
    });
    let receipt;
    try {
      const input = { code, challengeId, expiresMinutes: 5 };
      receipt = channel === 'email' ? await this.providers.email.sendCode({ ...input, to: target }) : await this.providers.sms.sendCode({ ...input, toE164: target });
    } catch {
      await sql`update otp_codes set state='failed' where id=${challengeId} and state='pending'`.execute(this.db);
      await audit(this.db, 'otp.delivery', req.id, undefined, undefined, 'failure');
      throw new ApiError(503, 'delivery_unavailable');
    }
    const sent = await first(this.db, sql<{expires_at: Date; created_at: Date}>`update otp_codes set state='sent',sent_at=now(),provider_request_id=${receipt.providerRequestId}
      where id=${challengeId} and state='pending' and expires_at>now() returning expires_at,created_at`);
    if (!sent) throw new ApiError(503, 'delivery_unavailable');
    return { challenge_id: challengeId, expires_in: Math.max(0, Math.min(300, Math.ceil((sent.expires_at.getTime() - Date.now()) / 1000))), retry_after: Math.max(0, Math.ceil((sent.created_at.getTime() + 60000 - Date.now()) / 1000)) };
  }
  private async newRefresh(tx: Connection, sessionId: string, expires: Date) {
    const id = randomUUID();
    const token = `${id}.${randomBytes(32).toString('base64url')}`;
    await sql`insert into session_refresh_tokens(id,session_id,token_hash,expires_at) values(${id},${sessionId},${tokenHash(token)},${expires})`.execute(tx);
    return { id, token };
  }
  private async checkOtp(tx: Connection, req: FastifyRequest, body: z.infer<typeof verifySchema>, purpose: string, actor?: Actor) {
    const otp = await first(tx, sql<Otp>`select * from otp_codes where id=${body.challenge_id} for update`);
    const matched = otp ? otpMatches(this.c.OTP_PEPPER, otp, body.code) : timingSafeEqual(otpHash(this.c.OTP_PEPPER, { id: body.challenge_id, purpose, channel: 'email', target_normalized: '' }, body.code), Buffer.alloc(32));
    if (!otp || !otpUsable(otp) || otp.purpose !== purpose ||
        (otp.bound_user_id ?? null) !== (actor?.userId ?? null) || (otp.bound_session_id ?? null) !== (actor?.sessionId ?? null)) {
      await audit(tx, 'otp.verify', req.id, actor, undefined, 'denied');
      return { error: new ApiError(400, 'invalid_code') };
    }
    const scope = purpose === 'login' ? 'verify_target' : `${purpose}_verify_target`;
    const targetFailures = await first(tx, sql<{count: number}>`select count from auth_rate_limits where scope=${scope} and key_hash=${keyedHash(this.c.RATE_LIMIT_HMAC_SECRET, otp.target_normalized)} and window_start=${new Date(Math.floor(Date.now() / 3600000) * 3600000)} and window_seconds=3600 and expires_at>now()`);
    if (targetFailures && targetFailures.count >= 20) return { error: new ApiError(429, 'rate-limited', undefined, 3600) };
    if (!matched || !/^\d{6}$/.test(body.code)) {
      await reserve(tx, this.c.RATE_LIMIT_HMAC_SECRET, windows(scope, otp.target_normalized, [[3600, 20]]));
      await sql`update otp_codes set attempts=attempts+1 where id=${otp.id}`.execute(tx);
      await audit(tx, 'otp.verify', req.id, actor, undefined, 'denied');
      return { error: new ApiError(400, 'invalid_code') };
    }
    return { otp };
  }
  async verify(req: FastifyRequest, reply: FastifyReply, registration = false) {
    const body = registration ? registerSchema.parse(req.body) : verifySchema.parse(req.body);
    if (registration) assertPasswordPolicy((body as z.infer<typeof registerSchema>).password);
    const purpose = registration ? 'register' : 'login';
    await quota(this.db, this.c.RATE_LIMIT_HMAC_SECRET, windows(registration ? 'register_verify_ip' : 'verify_ip', this.ip(req), [[60, 30], [3600, 300], [86400, 1000]]));
    const result = await this.db.transaction().execute(async tx => {
      const checked = await this.checkOtp(tx, req, body, purpose);
      if (checked.error) return { error: checked.error };
      const otp = checked.otp!;
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${otp.channel}:${otp.target_normalized}`},0))`.execute(tx);
      let identity = await first(tx, sql<{user_id: string; status: string; password_hash: string | null}>`select i.user_id,u.status,u.password_hash from identities i join users u on u.id=i.user_id where i.kind=${otp.channel} and i.identifier_normalized=${otp.target_normalized} for update of u`);
      if (identity && identity.status !== 'active') return { error: new ApiError(400, 'invalid_code') };
      if (!registration && !identity?.password_hash) return { error: new ApiError(409, 'registration_required') };
      if (registration) {
        if (identity?.password_hash) return { error: new ApiError(409, 'password_exists') };
        const hash = await hashPassword((body as z.infer<typeof registerSchema>).password);
        if (identity) {
          await sql`update users set password_hash=${hash},password_updated_at=now(),updated_at=now() where id=${identity.user_id}`.execute(tx);
          await sql`update sessions set revoked_at=coalesce(revoked_at,now()),revoke_reason='password_completion' where user_id=${identity.user_id} and revoked_at is null`.execute(tx);
        } else {
          const user = await first(tx, sql<{id: string}>`insert into users(password_hash,password_updated_at) values(${hash},now()) returning id`);
          if (!user) throw new Error('User insert failed');
          await sql`insert into identities(user_id,kind,identifier_normalized) values(${user.id},${otp.channel},${otp.target_normalized})`.execute(tx);
          identity = { user_id: user.id, status: 'active', password_hash: hash };
        }
      }
      if (!identity) throw new Error('Missing identity');
      await sql`update otp_codes set state='consumed',consumed_at=now() where id=${otp.id}`.execute(tx);
      const issued = await this.issueSession(tx, req, identity.user_id);
      await audit(tx, registration ? 'auth.register' : 'auth.login', req.id, { userId: issued.session.user_id, sessionId: issued.session.id });
      return issued;
    });
    if ('error' in result) throw result.error;
    return this.me(await this.setCookies(reply, result.session, result.refresh));
  }
  async requestReauth(req: FastifyRequest, actor: Actor) {
    z.object({}).strict().parse(req.body);
    const identity = await first(this.db, sql<{kind: string; identifier_normalized: string}>`select kind,identifier_normalized from identities where user_id=${actor.userId} and kind in ('phone','email') order by case kind when 'phone' then 0 else 1 end limit 1`);
    if (!identity) throw new ApiError(409, 'identity_required');
    return this.sendOtp(req, { channel: identity.kind, target_normalized: identity.identifier_normalized, purpose: 'password_change', bound_user_id: actor.userId, bound_session_id: actor.sessionId });
  }
  async verifyReauth(req: FastifyRequest, actor: Actor) {
    const body = verifySchema.parse(req.body);
    await quota(this.db, this.c.RATE_LIMIT_HMAC_SECRET, windows('password_change_verify_ip', this.ip(req), [[60, 30], [3600, 300], [86400, 1000]]));
    const result = await this.db.transaction().execute(async tx => {
      // Use the same user -> session -> challenge lock order as password changes.
      await sql`select id from users where id=${actor.userId} for update`.execute(tx);
      const session = await first(tx, sql<Session>`select s.*,u.status from sessions s join users u on u.id=s.user_id where s.id=${actor.sessionId} and s.user_id=${actor.userId} for update of s`);
      if (!validSession(session)) return { error: new ApiError(401, 'unauthenticated') };
      const checked = await this.checkOtp(tx, req, body, 'password_change', actor);
      if (checked.error) return { error: checked.error };
      const token = randomBytes(32).toString('base64url');
      await sql`update otp_codes set state='consumed',consumed_at=now() where id=${checked.otp!.id}`.execute(tx);
      await sql`insert into password_reauth(user_id,session_id,token_hash,expires_at) values(${actor.userId},${actor.sessionId},${tokenHash(token)},now()+interval '5 minutes')`.execute(tx);
      await audit(tx, 'auth.reauth', req.id, actor);
      return { reauth_token: token, expires_in: 300 };
    });
    if ('error' in result) throw result.error;
    return result;
  }
  private async setCookies(reply: FastifyReply, session: Session, refresh: string): Promise<Actor> {
    const expires = Math.min(Date.now() + 15 * 60000, session.absolute_expires_at.getTime(), session.idle_expires_at.getTime());
    const token = await new SignJWT({ sid: session.id }).setProtectedHeader({ alg: 'HS256' }).setSubject(session.user_id).setIssuer(this.c.APP_ORIGIN).setAudience('daily-work-api').setIssuedAt().setExpirationTime(Math.floor(expires / 1000)).setJti(randomUUID()).sign(new TextEncoder().encode(this.c.JWT_SECRET));
    const base = { httpOnly: true, secure: this.secure, sameSite: 'lax' as const };
    reply.setCookie(this.accessName, token, { ...base, path: '/api', maxAge: Math.floor((expires - Date.now()) / 1000) });
    reply.setCookie(this.refreshName, refresh, { ...base, path: '/api/auth', maxAge: Math.floor((Math.min(session.idle_expires_at.getTime(), session.absolute_expires_at.getTime()) - Date.now()) / 1000) });
    return { userId: session.user_id, sessionId: session.id, expiresAt: Math.floor(expires / 1000) * 1000 };
  }
  async authenticate(req: FastifyRequest): Promise<Actor> {
    const token = req.cookies[this.accessName];
    if (!token) throw new ApiError(401, 'unauthenticated');
    let claims;
    try { claims = (await jwtVerify(token, new TextEncoder().encode(this.c.JWT_SECRET), { algorithms: ['HS256'], issuer: this.c.APP_ORIGIN, audience: 'daily-work-api', requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp'] })).payload; }
    catch { throw new ApiError(401, 'unauthenticated'); }
    if (typeof claims.sid !== 'string' || !z.uuid().safeParse(claims.sid).success || typeof claims.sub !== 'string' || !claims.exp) throw new ApiError(401, 'unauthenticated');
    const session = await first(this.db, sql<Session>`select s.*,u.status from sessions s join users u on u.id=s.user_id where s.id=${claims.sid} and s.user_id=${claims.sub}`);
    if (!validSession(session)) throw new ApiError(401, 'unauthenticated');
    return { userId: session.user_id, sessionId: session.id, expiresAt: claims.exp * 1000 };
  }
  async me(actor: Actor) {
    const user = await first(this.db, sql<{id: string; name: string | null; has_password: boolean}>`select id,name,password_hash is not null as has_password from users where id=${actor.userId}`);
    if (!user) throw new ApiError(401, 'unauthenticated');
    const identities = await rows(this.db, sql<{kind: string; identifier_normalized: string}>`select kind,identifier_normalized from identities where user_id=${user.id}`);
    return { user: { ...user, ...Object.fromEntries(identities.map(i => [i.kind, i.identifier_normalized])), isAnonymous: false }, expiresAt: actor.expiresAt };
  }

  async updateProfile(req: FastifyRequest, actor: Actor) {
    const { name } = updateProfileSchema.parse(req.body);
    await sql`update users set name=${name},updated_at=now() where id=${actor.userId}`.execute(this.db);
    return this.me(actor);
  }

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    z.object({}).strict().parse(req.body);
    const token = req.cookies[this.refreshName] ?? '';
    const result = await this.db.transaction().execute(async tx => {
      const located = await first(tx, sql<{session_id: string}>`select session_id from session_refresh_tokens where token_hash=${tokenHash(token)}`);
      if (!located) return { error: new ApiError(401, 'unauthenticated') };
      const session = await first(tx, sql<Session>`select s.*,u.status from sessions s join users u on u.id=s.user_id where s.id=${located.session_id} for update of s`);
      const old = await first(tx, sql<{id: string; used_at: Date | null; expires_at: Date}>`select * from session_refresh_tokens where token_hash=${tokenHash(token)} for update`);
      if (!validSession(session) || !old) return { error: new ApiError(401, 'unauthenticated') };
      if (old.used_at) {
        if (Date.now() - old.used_at.getTime() <= 5000) return { error: new ApiError(409, 'refresh_conflict') };
        await sql`update sessions set revoked_at=now(),revoke_reason='refresh_replay' where id=${session.id}`.execute(tx);
        await audit(tx, 'auth.refresh_replay', req.id, { userId: session.user_id, sessionId: session.id }, undefined, 'denied');
        return { error: new ApiError(401, 'unauthenticated') };
      }
      if (old.expires_at.getTime() <= Date.now()) return { error: new ApiError(401, 'unauthenticated') };
      await sql`update session_refresh_tokens set used_at=now() where id=${old.id}`.execute(tx);
      const expiry = new Date(Math.min(Date.now() + 7 * 86400000, session.absolute_expires_at.getTime()));
      const next = await this.newRefresh(tx, session.id, expiry);
      await sql`update session_refresh_tokens set replaced_by=${next.id} where id=${old.id}`.execute(tx);
      await sql`update sessions set last_seen_at=now(),idle_expires_at=${expiry} where id=${session.id}`.execute(tx);
      session.idle_expires_at = expiry;
      return { session, refresh: next.token };
    });
    if ('error' in result) throw result.error;
    if (!result.session || !result.refresh) throw new Error('Missing refresh');
    return this.me(await this.setCookies(reply, result.session, result.refresh));
  }
  private async issueSession(tx: Connection, req: FastifyRequest, userId: string) {
    const s = await first(tx, sql<Session>`insert into sessions(user_id,absolute_expires_at,idle_expires_at,created_ip_hash,user_agent_hash)
      values(${userId},now()+interval '720 hours',now()+interval '168 hours',${keyedHash(this.c.RATE_LIMIT_HMAC_SECRET, this.ip(req))},${tokenHash(req.headers['user-agent'] ?? '')}) returning *`);
    if (!s) throw new Error('Session insert failed');
    const refresh = await this.newRefresh(tx, s.id, s.idle_expires_at);
    return { session: s, refresh: refresh.token };
  }

  /** Password login with phone or email — same cookie session as OTP. */
  async passwordLogin(req: FastifyRequest, reply: FastifyReply) {
    const body = passwordLoginSchema.parse(req.body);
    const target = normalize(body.channel, body.target);
    // Account-independent quotas run before Argon2id work.
    await quota(this.db, this.c.RATE_LIMIT_HMAC_SECRET, [
      ...windows('password_login_ip', this.ip(req), [[60, 20], [3600, 100], [86400, 300]]),
      ...windows('password_login_target', `${body.channel}:${target}`, [[60, 5], [3600, 20], [86400, 40]]),
    ]);
    const result = await this.db.transaction().execute(async tx => {
      const identity = await first(tx, sql<{user_id: string; status: string; password_hash: string | null}>`
        select i.user_id,u.status,u.password_hash from identities i
        join users u on u.id=i.user_id
        where i.kind=${body.channel} and i.identifier_normalized=${target} for update of u`);
      const matched = await verifyPasswordOrDummy(body.password, identity?.password_hash ?? null);
      if (!identity || identity.status !== 'active' || !identity.password_hash || !matched) {
        await audit(tx, 'auth.password_login', req.id, undefined, undefined, 'denied');
        return { error: new ApiError(401, 'invalid_credentials') };
      }
      const issued = await this.issueSession(tx, req, identity.user_id);
      await audit(tx, 'auth.password_login', req.id, { userId: issued.session.user_id, sessionId: issued.session.id });
      return issued;
    });
    if ('error' in result) throw result.error;
    if (!result.session || !result.refresh) throw new Error('Missing session');
    return this.me(await this.setCookies(reply, result.session, result.refresh));
  }

  /** Both the canonical change endpoint and legacy set alias require OTP step-up. */
  async setPassword(req: FastifyRequest, actor: Actor) {
    const body = setPasswordSchema.parse(req.body);
    assertPasswordPolicy(body.password);
    await quota(this.db, this.c.RATE_LIMIT_HMAC_SECRET, windows('password_change_user', actor.userId, [[60, 5], [3600, 20]]));
    const result = await this.db.transaction().execute(async tx => {
      const user = await first(tx, sql<{id: string; password_hash: string | null}>`select id,password_hash from users where id=${actor.userId} for update`);
      const session = await first(tx, sql<Session>`select s.*,u.status from sessions s join users u on u.id=s.user_id
        where s.id=${actor.sessionId} and s.user_id=${actor.userId} for update of s`);
      if (!user || !validSession(session)) return { error: new ApiError(401, 'unauthenticated') };
      const reauth = await first(tx, sql<{id: string}>`select id from password_reauth where token_hash=${tokenHash(body.reauth_token)} and user_id=${actor.userId} and session_id=${actor.sessionId} and consumed_at is null and expires_at>now() for update`);
      if (!reauth) return { error: new ApiError(403, 'reauth_required') };
      if (!user.password_hash || !await verifyPassword(body.current_password, user.password_hash)) {
        await audit(tx, 'auth.password_change', req.id, actor, undefined, 'denied');
        return { error: new ApiError(401, 'invalid_credentials') };
      }
      const hash = await hashPassword(body.password);
      const consumed = await first(tx, sql<{id: string}>`update password_reauth set consumed_at=clock_timestamp() where id=${reauth.id} and consumed_at is null and expires_at>clock_timestamp() returning id`);
      if (!consumed) return { error: new ApiError(403, 'reauth_required') };
      await sql`update password_reauth set consumed_at=coalesce(consumed_at,now()) where user_id=${actor.userId} and consumed_at is null`.execute(tx);
      await sql`update users set password_hash=${hash},password_updated_at=now(),updated_at=now() where id=${user.id}`.execute(tx);
      // Contract: password set/change revokes every other session; keep caller's.
      await sql`update sessions set revoked_at=coalesce(revoked_at,now()),revoke_reason='password_change'
        where user_id=${user.id} and id<>${actor.sessionId}::uuid and revoked_at is null`.execute(tx);
      await audit(tx, 'auth.password_change', req.id, actor);
      return { error: undefined };
    });
    if (result.error) throw result.error;
    return this.me(actor);
  }

  async logout(req: FastifyRequest, reply: FastifyReply) {
    z.object({}).strict().parse(req.body);
    let actor: Actor | undefined;
    try { actor = await this.authenticate(req); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    const refresh = req.cookies[this.refreshName];
    await this.db.transaction().execute(async tx => {
      // Access and refresh may identify different sessions: revoke both presented credentials.
      await sql`update sessions set revoked_at=coalesce(revoked_at,now()),revoke_reason='logout'
        where id::text=${actor?.sessionId ?? ''} or id in (select session_id from session_refresh_tokens where token_hash=${tokenHash(refresh ?? '')})`.execute(tx);
      if (actor) await audit(tx, 'auth.logout', req.id, actor);
    });
    reply.clearCookie(this.accessName, { path: '/api', secure: this.secure, httpOnly: true, sameSite: 'lax' });
    reply.clearCookie(this.refreshName, { path: '/api/auth', secure: this.secure, httpOnly: true, sameSite: 'lax' });
    return null;
  }
}
