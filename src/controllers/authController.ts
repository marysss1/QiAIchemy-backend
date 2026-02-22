import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env, requireJwtSecret } from '../config/env';
import { User, UserDocument } from '../models/User';

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_][a-z0-9_.-]{2,23}$/, 'Invalid username format');

const registerSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(50).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(64),
});

const loginSchema = z
  .object({
    login: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(8).max(64),
  })
  .refine(data => Boolean(data.login || data.email), {
    message: 'login or email is required',
    path: ['login'],
  });

const usernameAvailabilitySchema = z.object({
  username: usernameSchema,
});

function signToken(user: UserDocument): string {
  const jwtSecret = requireJwtSecret();
  return jwt.sign(
    { userId: user.id, email: user.email, username: user.username },
    jwtSecret,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

function toSafeUser(user: UserDocument): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeLogin(input: string): string {
  return input.trim().toLowerCase();
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const email = parsed.data.email.toLowerCase().trim();
  const existingByEmail = await User.findOne({ email });

  if (existingByEmail) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const existingByUsername = await User.findOne({ username });

  if (existingByUsername) {
    res.status(409).json({ message: 'Username already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await User.create({
    username,
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

  const loginValue = normalizeLogin(parsed.data.login ?? parsed.data.email ?? '');
  const user = await User.findOne(
    loginValue.includes('@')
      ? { email: loginValue }
      : { $or: [{ username: loginValue }, { email: loginValue }] }
  );

  if (!user) {
    res.status(401).json({ message: 'Invalid username or email or password' });
    return;
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);

  if (!passwordOk) {
    res.status(401).json({ message: 'Invalid username or email or password' });
    return;
  }

  const token = signToken(user);
  res.status(200).json({ token, user: toSafeUser(user) });
}

export async function usernameAvailable(req: Request, res: Response): Promise<void> {
  const parsed = usernameAvailabilitySchema.safeParse({
    username: req.query.username,
  });

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid username format' });
    return;
  }

  const username = parsed.data.username;
  const existing = await User.findOne({ username }).select('_id').lean();
  res.status(200).json({
    username,
    available: !existing,
  });
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
