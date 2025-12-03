import crypto from 'crypto';

const SCRYPT_KEYLEN = 64;

// Format: scrypt$<saltHex>$<hashHex>
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEYLEN) as Buffer;
  const hashHex = derivedKey.toString('hex');
  return `scrypt$${salt}$${hashHex}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;

  const [scheme, salt, hashHex] = parts;
  if (scheme !== 'scrypt') return false;
  if (!salt || !hashHex) return false;

  const hash = Buffer.from(hashHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, hash.length) as Buffer;

  if (hash.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(hash, derivedKey);
}

