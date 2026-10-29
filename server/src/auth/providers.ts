import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.js';

export type DeliveryReceipt = { providerRequestId: string; messageId?: string };
export type CodeInput = { code: string; expiresMinutes: number; challengeId: string };
export interface EmailSender { sendCode(input: CodeInput & { to: string }): Promise<DeliveryReceipt> }
export interface SmsSender { sendCode(input: CodeInput & { toE164: string }): Promise<DeliveryReceipt> }
export type CapturedCode = CodeInput & { channel: 'email' | 'phone'; target: string };
export class ConsoleProvider implements EmailSender, SmsSender {
  constructor(env: string, private capture?: (input: CapturedCode) => void, private write: (line: string) => void = console.warn) {
    if (env !== 'development') throw new Error('DEV ONLY console provider requires NODE_ENV=development');
  }
  async sendCode(input: CodeInput & ({ to: string } | { toE164: string })): Promise<DeliveryReceipt> {
    const entry: CapturedCode = { ...input, channel: 'to' in input ? 'email' : 'phone', target: 'to' in input ? input.to : input.toE164 };
    // Sole intentional plaintext-code output, guarded by development-only construction.
    this.write(`[DEV ONLY — NEVER USE IN PRODUCTION] OTP ${entry.channel} challenge=${input.challengeId} code=${input.code}`);
    this.capture?.(entry);
    return { providerRequestId: `console:${input.challengeId}` };
  }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
export function signTc3(input: { secretId: string; secretKey: string; service: string; action: string; body: string; timestamp: number }) {
  const { secretId, secretKey, service, action, body, timestamp } = input;
  const host = `${service}.tencentcloudapi.com`;
  const contentType = 'application/json; charset=utf-8';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n\n${signedHeaders}\n${hash(body)}`;
  const scope = `${date}/${service}/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const key = hmac(hmac(hmac(`TC3${secretKey}`, date), service), 'tc3_request');
  const signature = hmac(key, toSign).toString('hex');
  return { Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType, Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp) };
}
const receiptSchema = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider response');
  return value as Record<string, unknown>;
};
export class TencentProvider implements EmailSender, SmsSender {
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}
  private async call(service: string, action: string, version: string, region: string, payload: unknown) {
    const body = JSON.stringify(payload);
    const c = this.config;
    if (!c.TENCENT_SECRET_ID || !c.TENCENT_SECRET_KEY) throw new Error('Missing Tencent credentials');
    const headers = { ...signTc3({ secretId: c.TENCENT_SECRET_ID, secretKey: c.TENCENT_SECRET_KEY, service, action, body, timestamp: Math.floor(Date.now() / 1000) }), 'X-TC-Version': version, 'X-TC-Region': region };
    const response = await this.fetcher(`https://${service}.tencentcloudapi.com/`, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Provider HTTP failure');
    const data = receiptSchema(receiptSchema(await response.json()).Response);
    if (data.Error || typeof data.RequestId !== 'string') throw new Error('Provider rejected request');
    return data;
  }
  async sendCode(input: CodeInput & ({ to: string } | { toE164: string })): Promise<DeliveryReceipt> {
    const c = this.config;
    if ('to' in input) {
      const data = await this.call('ses', 'SendEmail', '2020-10-02', c.TENCENT_SES_REGION, {
        FromEmailAddress: c.TENCENT_SES_FROM_EMAIL, Destination: [input.to], Subject: c.TENCENT_SES_SUBJECT,
        Template: { TemplateID: c.TENCENT_SES_TEMPLATE_ID, TemplateData: JSON.stringify({ code: input.code, expiresMinutes: String(input.expiresMinutes) }) },
      });
      if (typeof data.MessageId !== 'string' || !data.MessageId) throw new Error('Missing SES acceptance');
      return { providerRequestId: String(data.RequestId), messageId: data.MessageId };
    }
    const data = await this.call('sms', 'SendSms', '2021-01-11', c.TENCENT_SMS_REGION, {
      SmsSdkAppId: c.TENCENT_SMS_SDK_APP_ID, SignName: c.TENCENT_SMS_SIGN_NAME, TemplateId: c.TENCENT_SMS_TEMPLATE_ID,
      PhoneNumberSet: [input.toE164], TemplateParamSet: [input.code, String(input.expiresMinutes)],
    });
    if (!Array.isArray(data.SendStatusSet) || data.SendStatusSet.length !== 1) throw new Error('Invalid SMS acceptance');
    const status = receiptSchema(data.SendStatusSet[0]);
    if (status.Code !== 'Ok' || status.PhoneNumber !== input.toE164 || typeof status.SerialNo !== 'string') throw new Error('SMS rejected');
    return { providerRequestId: String(data.RequestId), messageId: status.SerialNo };
  }
}
export function createProviders(c: Config): { email: EmailSender; sms: SmsSender } {
  return { email: c.EMAIL_PROVIDER === 'console' ? new ConsoleProvider(c.NODE_ENV) : new TencentProvider(c),
    sms: c.SMS_PROVIDER === 'console' ? new ConsoleProvider(c.NODE_ENV) : new TencentProvider(c) };
}
