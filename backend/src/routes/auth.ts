import express from 'express';
import type { Request, Response } from 'express';
import { config } from '../config';
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken } from '../session';

const router = express.Router();

router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };

  if (!config.appPassword) {
    res.status(500).json({ error: 'APP_PASSWORD not configured' });
    return;
  }

  if (!password || password !== config.appPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = createSessionToken();

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12,
  });

  res.json({ ok: true });
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/session', (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || !verifySessionToken(token)) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true });
});

export default router;

