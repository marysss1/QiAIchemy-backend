import 'dotenv/config';
import { app } from './app';
import { connectToDatabase } from './config/db';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  await connectToDatabase();

  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] Running at http://${env.HOST}:${env.PORT}`);
    if (env.HOST === '0.0.0.0') {
      console.log(`[server] External access: http://<your-server-ip>:${env.PORT}`);
    }
  });
}

bootstrap().catch((error) => {
  console.error('[server] Startup failed:', error);
  process.exit(1);
});
