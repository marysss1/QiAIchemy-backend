import 'dotenv/config';
import { app } from './app';
import { connectToDatabase } from './config/db';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  await connectToDatabase();

  app.listen(env.PORT, () => {
    console.log(`[server] Running at http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('[server] Startup failed:', error);
  process.exit(1);
});
