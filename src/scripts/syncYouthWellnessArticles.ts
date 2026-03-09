import 'dotenv/config';
import { connectToDatabase } from '../config/db';
import { syncYouthWellnessArticles } from '../services/content/youthWellnessArticles';

async function main(): Promise<void> {
  await connectToDatabase();
  const count = await syncYouthWellnessArticles(true);
  console.log(`[content] synced ${count} youth wellness articles`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[content] sync failed:', error);
  process.exit(1);
});
