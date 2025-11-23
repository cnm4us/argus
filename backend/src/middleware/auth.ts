import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../session';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.appPassword) {
    res.status(500).json({ error: 'APP_PASSWORD not configured on server' });
    return;
  }

  const authHeader = req.header('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme === 'Bearer' && token === config.appPassword) {
    next();
    return;
  }

  const sessionToken = (req as any).cookies?.[SESSION_COOKIE_NAME] as string | undefined;

  if (sessionToken && verifySessionToken(sessionToken)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}

