import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../http.js';

const PREFIX = '$argon2id$v=19$m=19456,t=2,p=1$';
const RECORD = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;
// Public dummy, never assigned to an account; missing credentials pay the same KDF cost.
export const DUMMY_PASSWORD_HASH = `${PREFIX}BwcHBwcHBwcHBwcHBwcHBw$hQX/lL2SRQvHlWJo2rnK5/5yjosoF/X5gOwugOZJ5vg`;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new ApiError(400, 'invalid');
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, memory: 19456, passes: 2, parallelism: 1, tagLength: 32 },
      (error, tag) => error ? reject(error) : resolve(tag));
  });
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  const tag = await derive(password, salt);
  return `${PREFIX}${salt.toString('base64').replace(/=+$/, '')}$${tag.toString('base64').replace(/=+$/, '')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (typeof password !== 'string') return false;
  const parsed = RECORD.exec(stored ?? '');
  const record = parsed ?? RECORD.exec(DUMMY_PASSWORD_HASH)!;
  const actual = await derive(password, Buffer.from(record[1]!, 'base64'));
  const matched = timingSafeEqual(actual, Buffer.from(record[2]!, 'base64'));
  return !!parsed && matched;
}

export const verifyPasswordOrDummy = verifyPassword;
