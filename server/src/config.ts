import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  APP_ORIGIN: z.url(), DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32), OTP_PEPPER: z.string().min(32), RATE_LIMIT_HMAC_SECRET: z.string().min(32),
  EMAIL_PROVIDER: z.enum(['console', 'tencent-ses']), SMS_PROVIDER: z.enum(['console', 'tencent-sms']),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY_CIDR: z.string().optional(),
  TENCENT_SECRET_ID: z.string().min(1).optional(), TENCENT_SECRET_KEY: z.string().min(1).optional(),
  TENCENT_SES_REGION: z.enum(['ap-guangzhou', 'ap-hongkong']).default('ap-guangzhou'),
  TENCENT_SES_FROM_EMAIL: z.email().optional(), TENCENT_SES_TEMPLATE_ID: z.coerce.number().int().positive().optional(),
  TENCENT_SES_SUBJECT: z.string().min(1).optional(),
  TENCENT_SMS_REGION: z.string().min(1).default('ap-guangzhou'),
  TENCENT_SMS_SDK_APP_ID: z.string().regex(/^\d+$/).optional(), TENCENT_SMS_SIGN_NAME: z.string().min(1).optional(),
  TENCENT_SMS_TEMPLATE_ID: z.string().regex(/^\d+$/).optional(),
  OTP_EMAIL_DAILY_CAP: z.coerce.number().int().positive().default(1000),
  OTP_SMS_DAILY_CAP: z.coerce.number().int().positive().default(500),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const c = parsed.data;
  const origin = new URL(c.APP_ORIGIN);
  if (origin.origin !== c.APP_ORIGIN || origin.username || origin.password) throw new Error('APP_ORIGIN must be an exact origin');
  if (!['postgres:', 'postgresql:'].includes(new URL(c.DATABASE_URL).protocol)) throw new Error('PostgreSQL required');
  const loopbackHttp = c.NODE_ENV === 'development' && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  // Staging on a public IP uses HTTP + NODE_ENV=development until ICP/HTTPS; still blocked in production.
  const stagingIpHttp = c.NODE_ENV === 'development' && origin.protocol === 'http:' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(origin.hostname);
  if (origin.protocol !== 'https:' && !loopbackHttp && !stagingIpHttp) throw new Error('HTTPS origin required outside loopback development');
  if (c.NODE_ENV !== 'development' && (c.EMAIL_PROVIDER === 'console' || c.SMS_PROVIDER === 'console')) throw new Error('DEV ONLY console providers require NODE_ENV=development');
  if (new Set([c.JWT_SECRET, c.OTP_PEPPER, c.RATE_LIMIT_HMAC_SECRET]).size !== 3) throw new Error('Secrets must be independent');
  if (c.NODE_ENV === 'production' && [c.JWT_SECRET, c.OTP_PEPPER, c.RATE_LIMIT_HMAC_SECRET].some(s => /replace|placeholder|change.me|example/i.test(s) || new Set(s).size < 12)) throw new Error('Production requires strong random secrets');
  const needed: (keyof Config)[] = [];
  if (c.EMAIL_PROVIDER === 'tencent-ses') needed.push('TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_SES_FROM_EMAIL', 'TENCENT_SES_TEMPLATE_ID', 'TENCENT_SES_SUBJECT');
  if (c.SMS_PROVIDER === 'tencent-sms') needed.push('TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_ID');
  if (needed.some(k => c[k] === undefined)) throw new Error(`Missing provider configuration: ${needed.filter(k => c[k] === undefined).join(', ')}`);
  return c;
}
