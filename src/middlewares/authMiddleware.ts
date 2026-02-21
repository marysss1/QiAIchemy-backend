import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.headers.authorization;

  if (!authorization) {
    res.status(401).json({ message: 'Missing Authorization header' });
    return;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ message: 'Invalid Authorization format' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      email: string;
    };

    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}
