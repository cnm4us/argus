import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.appPassword) {
    res.status(500).json({ error: 'APP_PASSWORD not configured on server' });
    return;
  }

  const authHeader = req.header('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || token !== config.appPassword) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

