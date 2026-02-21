import { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[error]', err);
  res.status(500).json({ message: 'Internal server error' });
}
