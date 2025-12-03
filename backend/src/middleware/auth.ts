import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { SESSION_COOKIE_NAME, decodeSessionToken } from '../session';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.appPassword) {
    res.status(500).json({ error: 'APP_PASSWORD not configured on server' });
    return;
  }

  const authHeader = req.header('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme === 'Bearer' && token === config.appPassword) {
    (req as any).user = {
      id: null,
      email: null,
      displayName: 'App Password',
      role: 'admin',
    };
    next();
    return;
  }

  const sessionToken = (req as any).cookies?.[SESSION_COOKIE_NAME] as
    | string
    | undefined;

  if (!sessionToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = decodeSessionToken(sessionToken);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const row = rows[0] as any;
    (req as any).user = {
      id: row.id as number,
      email: row.email as string,
      displayName: row.display_name as string,
      role: row.role as 'user' | 'admin',
    };

    next();
  } catch (error) {
    console.error('Error in requireAuth middleware:', error);
    res.status(500).json({ error: 'Failed to verify authentication.' });
  }
}
