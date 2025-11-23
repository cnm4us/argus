import crypto from 'crypto';
import { config } from './config';

export const SESSION_COOKIE_NAME = 'argus_session';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

interface SessionPayload {
  sub: string;
  exp: number;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  let str = input.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64');
}

function signPayload(payloadB64: string): string {
  const hmac = crypto.createHmac('sha256', config.appPassword);
  hmac.update(payloadB64);
  return base64UrlEncode(hmac.digest());
}

export function createSessionToken(): string {
  const payload: SessionPayload = {
    sub: 'argus',
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sigB64 = signPayload(payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token: string): boolean {
  try {
    if (!config.appPassword) {
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payloadB64, sigB64] = parts;
    const expectedSig = signPayload(payloadB64);

    const a = Buffer.from(expectedSig);
    const b = Buffer.from(sigB64);
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;

    const payloadJson = base64UrlDecode(payloadB64).toString('utf8');
    const payload = JSON.parse(payloadJson) as SessionPayload;
    if (!payload.exp || typeof payload.exp !== 'number') return false;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

