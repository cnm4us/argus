import crypto from 'crypto';
import { config } from './config';

export const SESSION_COOKIE_NAME = 'argus_session';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface SessionPayload {
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

export function createSessionToken(userId: number | string): string {
  const payload: SessionPayload = {
    sub: String(userId),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sigB64 = signPayload(payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function decodeSessionToken(token: string): SessionPayload | null {
  try {
    if (!config.appPassword) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts;
    const expectedSig = signPayload(payloadB64);

    const a = Buffer.from(expectedSig);
    const b = Buffer.from(sigB64);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    const payloadJson = base64UrlDecode(payloadB64).toString('utf8');
    const payload = JSON.parse(payloadJson) as SessionPayload;
    if (!payload.exp || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Date.now()) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string): boolean {
  return decodeSessionToken(token) !== null;
}

