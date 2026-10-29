import Fastify, { type FastifyRequest, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import pino from 'pino';
import { z } from 'zod';
import type { Config } from './config.js';
import { createDb, type Database } from './db/index.js';
import { ready } from './db/migrator.js';
import { ApiError, dto, ok } from './http.js';
import { AuthService, type Actor } from './auth/service.js';
import { createProviders, type EmailSender, type SmsSender } from './auth/providers.js';
import { businessRoutes } from './business.js';
import { quota, windows } from './auth/quotas.js';
import { ipKey } from './auth/crypto.js';
declare module 'fastify' { interface FastifyRequest { actor: Actor | null } }
const publicPaths = new Set(['/api/auth/register', '/api/auth/otp/request', '/api/auth/otp/verify', '/api/auth/password/login', '/api/auth/refresh', '/api/auth/logout']);
export function buildApp(c: Config, options: { db?: Database; providers?: { email: EmailSender; sms: SmsSender } } = {}) {
  const db = options.db ?? createDb(c.DATABASE_URL);
  const app = Fastify({
    bodyLimit: 32768, trustProxy: c.TRUST_PROXY_CIDR ? [c.TRUST_PROXY_CIDR] : false,
    loggerInstance: pino({ level: c.LOG_LEVEL, redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'body', 'code', 'target', 'password', 'secret', 'token'], censor: '[REDACTED]' },
      serializers: { req(req: FastifyRequest) { return { method: req.method, url: req.url.split('?')[0], request_id: req.id }; } } }) as FastifyBaseLogger,
    requestIdHeader: false,
  });
  const auth = new AuthService(db, c, options.providers ?? createProviders(c));
  app.decorateRequest('actor', null);
  app.register(cookie);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const path = req.url.split('?')[0]!;
    if (path.startsWith('/api/health/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.headers.origin !== c.APP_ORIGIN || req.headers['x-dwa-csrf'] !== '1' || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ApiError(403, 'csrf_rejected');
    }
  });
  app.addHook('preHandler', async req => {
    const path = req.url.split('?')[0]!;
    if (path.startsWith('/api/health/')) return;
    if (!['/api/teams/:teamId/tasks', '/api/teams/:teamId/work-logs'].includes(req.routeOptions.url ?? '')) z.object({}).strict().parse(req.query);
    if (!publicPaths.has(path)) req.actor = await auth.authenticate(req);
    await quota(db, c.RATE_LIMIT_HMAC_SECRET, windows(req.actor ? 'api_user' : 'api_ip', req.actor?.userId ?? ipKey(req.ip), [[60, req.actor ? 120 : 60]]));
  });
  app.addHook('preSerialization', async (_req, _reply, payload) => dto(payload));
  app.setErrorHandler((err, req, reply) => {
    let e: ApiError;
    if (err instanceof ApiError) e = err;
    else if (err instanceof z.ZodError) e = new ApiError(400, 'invalid');
    else if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') e = new ApiError(409, 'already_exists');
    else if (typeof err === 'object' && err !== null && 'code' in err && ['23503', '23514', '22P02', '22003', '22007', '22008'].includes(String(err.code))) e = new ApiError(400, 'invalid');
    else if (typeof err === 'object' && err !== null && 'code' in err && (/^08/.test(String(err.code)) || ['57P01', '57P02', '57P03', '53300', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(String(err.code)))) e = new ApiError(503, 'backend-unavailable');
    else if (typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' && [400, 413, 415].includes(err.statusCode)) e = new ApiError(err.statusCode, 'invalid');
    else {
      // Do not log driver errors/query parameters: they can contain OTP/identity or business content.
      req.log.error({ request_id: req.id, error_type: err instanceof Error ? err.name : 'unknown' }, 'Request failed');
      e = new ApiError(500, 'unknown', { request_id: req.id });
    }
    if (e.retryAfter) reply.header('Retry-After', e.retryAfter);
    return reply.code(e.status).send({ ok: false, code: e.code, message: e.code, ...(e.data === undefined ? {} : { data: e.data }) });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false, code: 'not_found', message: 'not_found' }));
  app.get('/api/health/live', async () => ok({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, reply) => {
    if (!(await ready(db))) return reply.code(503).send({ ok: false, code: 'backend-unavailable', message: 'backend-unavailable', data: { status: 'unavailable' } });
    return ok({ status: 'ok' });
  });
  app.post('/api/auth/otp/request', async (req, reply) => reply.code(202).send(ok(await auth.request(req))));
  app.post('/api/auth/otp/verify', async (req, reply) => ok(await auth.verify(req, reply)));
  app.post('/api/auth/password/login', async (req, reply) => ok(await auth.passwordLogin(req, reply)));
  app.post('/api/auth/register', async (req, reply) => ok(await auth.verify(req, reply, true)));
  app.post('/api/auth/reauth/request', async (req, reply) => reply.code(202).send(ok(await auth.requestReauth(req, req.actor!))));
  app.post('/api/auth/reauth/verify', async req => ok(await auth.verifyReauth(req, req.actor!)));
  app.post('/api/auth/password/change', async req => ok(await auth.setPassword(req, req.actor!)));
  app.post('/api/auth/password/set', async req => ok(await auth.setPassword(req, req.actor!)));
  app.get('/api/auth/me', async req => ok(await auth.me(req.actor!)));
  app.patch('/api/auth/me', async req => ok(await auth.updateProfile(req, req.actor!)));
  app.post('/api/auth/refresh', async (req, reply) => ok(await auth.refresh(req, reply)));
  app.post('/api/auth/logout', async (req, reply) => ok(await auth.logout(req, reply)));
  businessRoutes(app, db, c);
  app.addHook('onClose', async () => { if (!options.db) await db.destroy(); });
  return app;
}
