import mongoose from 'mongoose';
import { env } from './env';

export async function connectToDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
  console.log('[db] MongoDB connected');
}
