import 'dotenv/config';
import mongoose from 'mongoose';
import path from 'node:path';
import { connectToDatabase } from '../config/db';
import { env } from '../config/env';
import { ingestKnowledgeFromDirectory } from '../services/rag/ingestKnowledge';

function parseDirFromArgv(): string | undefined {
  const dirFlagIndex = process.argv.findIndex((arg) => arg === '--dir');
  if (dirFlagIndex >= 0 && process.argv[dirFlagIndex + 1]) {
    return process.argv[dirFlagIndex + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const dir = parseDirFromArgv() ?? env.RAG_INGEST_DIR;
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  console.log(`[rag:ingest] directory: ${absDir}`);

  await connectToDatabase();
  const summary = await ingestKnowledgeFromDirectory(absDir);

  console.log(
    `[rag:ingest] completed: files=${summary.files}, chunks=${summary.chunks}`
  );
}

main()
  .catch((error) => {
    console.error('[rag:ingest] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
