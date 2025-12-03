import express from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db';
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  decodeSessionToken,
} from '../session';
import { hashPassword, verifyPassword } from '../passwords';

const router = express.Router();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';
    const rawDisplayName =
      typeof body.displayName === 'string' ? body.displayName : '';

    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@') || email.length > 255) {
      res.status(400).json({ error: 'A valid email is required.' });
      return;
    }

    const password = rawPassword.trim();
    if (password.length < 8) {
      res
        .status(400)
        .json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const displayName =
      rawDisplayName.trim() ||
      email.substring(0, email.indexOf('@')) ||
      email;

    const db = await getDb();

    const [existingRows] = (await db.query(
      `
        SELECT id
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [email],
    )) as any[];

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = hashPassword(password);

    const [result] = (await db.query(
      `
        INSERT INTO users (email, display_name, password_hash, role)
        VALUES (?, ?, ?, 'user')
      `,
      [email, displayName, passwordHash],
    )) as any[];

    const userId =
      result && typeof result.insertId === 'number'
        ? (result.insertId as number)
        : null;

    if (!userId) {
      res.status(500).json({ error: 'Failed to create user account.' });
      return;
    }

    const token = createSessionToken(userId);

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,
    });

    res.status(201).json({
      id: userId,
      email,
      displayName,
      role: 'user',
    });
  } catch (error) {
    console.error('Error in POST /api/auth/register:', error);
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = req.body as { email?: string; password?: string };
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@') || email.length > 255) {
      res.status(400).json({ error: 'A valid email is required.' });
      return;
    }

    const password = rawPassword.trim();
    if (!password) {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    const db = await getDb();
    const [rows] = (await db.query(
      `
        SELECT id, email, display_name, password_hash, role
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [email],
    )) as any[];

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user = rows[0] as any;
    const storedHash = user.password_hash as string;

    if (!verifyPassword(password, storedHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = createSessionToken(user.id as number);

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,
    });

    res.json({
      id: user.id as number,
      email: user.email as string,
      displayName: user.display_name as string,
      role: user.role as string,
    });
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/session', async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const payload = decodeSessionToken(token);
    if (!payload) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const db = await getDb();
    const [rows] = (await db.query(
      `
        SELECT id, email, display_name, role
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId],
    )) as any[];

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(401).json({ authenticated: false });
      return;
    }

    const user = rows[0] as any;

    res.json({
      authenticated: true,
      user: {
        id: user.id as number,
        email: user.email as string,
        displayName: user.display_name as string,
        role: user.role as string,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/auth/session:', error);
    res.status(500).json({ error: 'Failed to check session.' });
  }
});

export default router;
