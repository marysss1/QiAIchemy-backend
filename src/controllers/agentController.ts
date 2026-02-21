import { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { answerWithRag } from '../services/rag/answerWithRag';

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().positive().max(20).optional(),
});

export async function ragChat(req: Request, res: Response): Promise<void> {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  try {
    const result = await answerWithRag(
      parsed.data.message,
      parsed.data.topK ?? env.RAG_TOP_K
    );
    res.status(200).json(result);
  } catch (error) {
    const maybeError = error as { status?: number; message?: string };
    const status = typeof maybeError?.status === 'number' ? maybeError.status : 500;

    if (status === 401 || status === 403 || status === 402) {
      res.status(status).json({ message: maybeError.message ?? 'LLM provider authorization error' });
      return;
    }

    if (status === 429) {
      res.status(429).json({ message: 'LLM rate limited, please retry later' });
      return;
    }

    console.error('[agent] ragChat failed:', error);
    res.status(500).json({ message: 'Agent request failed' });
  }
}
