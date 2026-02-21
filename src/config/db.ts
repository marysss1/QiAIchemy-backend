import mongoose from 'mongoose';
import { requireMongoUri } from './env';

export async function connectToDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(requireMongoUri());
  console.log('[db] MongoDB connected');
}
