import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { ApiError } from '../http.js';
export function normalize(channel: 'email' | 'phone', value: string): string {
  if (channel === 'phone') {
    const phone = value.replace(/[\s-]/g, '');
    if (!/^(?:\+86)?1\d{10}$/.test(phone)) throw new ApiError(400, 'invalid');
    return phone.startsWith('+86') ? phone : `+86${phone}`;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, 'invalid');
  const email = value.trim().toLowerCase();
  const [local, domain] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain ||
      !/^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      domain.split('.').some(s => !s || s.length > 63 || s.startsWith('-') || s.endsWith('-'))) throw new ApiError(400, 'invalid');
  return email;
}
export function ipKey(ip: string) {
  const parsed = ipaddr.process(ip);
  if (parsed.kind() === 'ipv4') return parsed.toString();
  const bytes = parsed.toByteArray();
  return Buffer.from(bytes.slice(0, 8)).toString('hex') + '/64';
}
export function keyedHash(secret: string, value: string): Buffer { return createHmac('sha256', secret).update(value).digest(); }
export const tokenHash = (value: string) => createHash('sha256').update(value).digest();
export type OtpFields = { id: string; purpose: string; channel: string; target_normalized: string; bound_user_id?: string | null; bound_session_id?: string | null; key_version?: number };
export function otpHash(secret: string, row: OtpFields, code: string): Buffer {
  return keyedHash(secret, JSON.stringify([row.key_version ?? 1, row.id, row.purpose, row.channel, row.target_normalized, row.bound_user_id ?? null, row.bound_session_id ?? null, code]));
}
export function otpMatches(secret: string, row: OtpFields & { code_hmac: Buffer }, code: string) {
  return timingSafeEqual(otpHash(secret, row, code), row.code_hmac);
}
export function otpUsable(row: { state: string; attempts: number; expires_at: Date }, now = Date.now()) {
  return row.state === 'sent' && row.attempts < 5 && row.expires_at.getTime() > now;
}
