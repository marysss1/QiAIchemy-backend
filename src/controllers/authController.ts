import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { User, UserDocument } from '../models/User';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  email: z.email(),
  password: z.string().min(8).max(64),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(64),
});

function signToken(user: UserDocument): string {
  return jwt.sign(
    { userId: user.id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

function toSafeUser(user: UserDocument): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await User.create({
    name: parsed.data.name ?? '',
    email,
    passwordHash,
  });

  const token = signToken(user);

  res.status(201).json({ token, user: toSafeUser(user) });
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = await User.findOne({ email });

  if (!user) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);

  if (!passwordOk) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const token = signToken(user);
  res.status(200).json({ token, user: toSafeUser(user) });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const user = await User.findById(req.auth.userId);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  res.status(200).json({ user: toSafeUser(user) });
}
