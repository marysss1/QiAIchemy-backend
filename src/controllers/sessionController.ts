import { Request, Response } from 'express';
import { z } from 'zod';
import { ChatSession } from '../models/ChatSession';
import { HEALTH_RISK_ALERT_CODES } from '../services/health/healthRisk';
import { summarizeChatSession } from '../services/agent/sessionSummarizer';

const sessionMessageCitationSchema = z.object({
  label: z.string().trim().min(1).max(32),
  sourceTitle: z.string().trim().min(1).max(200),
  sectionTitle: z.string().trim().max(200).optional(),
});

const sessionMessageSchema = z.object({
  id: z.string().trim().min(1).max(100),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(12000),
  citations: z.array(sessionMessageCitationSchema).max(8).optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
});

const sessionUpsertSchema = z.object({
  sessionType: z.enum(['manual', 'login_health_review']).optional(),
  messages: z.array(sessionMessageSchema).min(1).max(200),
  riskAlertCodes: z.array(z.enum(HEALTH_RISK_ALERT_CODES)).max(24).optional(),
});

function serializeSession(session: {
  sessionId: number;
  title: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
  sessionType: 'manual' | 'login_health_review';
  riskAlertCodes?: string[];
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: Array<{ label: string; sourceTitle: string; sectionTitle?: string }>;
    createdAt: Date;
  }>;
}) {
  return {
    id: session.sessionId,
    title: session.title,
    summary: session.summary,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    sessionType: session.sessionType,
    riskAlertCodes: session.riskAlertCodes ?? [],
    messages: session.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: message.citations?.map(citation => ({
        label: citation.label,
        sourceTitle: citation.sourceTitle,
        sectionTitle: citation.sectionTitle || undefined,
      })),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function listChatSessions(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const sessions = await ChatSession.find({ userId: req.auth.userId })
      .sort({ updatedAt: -1 })
      .limit(60)
      .lean()
      .exec();

    res.status(200).json({
      sessions: sessions.map(session =>
        serializeSession({
          sessionId: session.sessionId,
          title: session.title,
          summary: session.summary ?? '',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          sessionType: session.sessionType,
          riskAlertCodes: session.riskAlertCodes,
          messages: session.messages,
        })
      ),
    });
  } catch (error) {
    console.error('[session] list failed:', error);
    res.status(500).json({ message: 'Failed to load chat sessions' });
  }
}

export async function upsertChatSession(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const sessionIdRaw = Number(req.params.sessionId);
  if (!Number.isInteger(sessionIdRaw) || sessionIdRaw <= 0) {
    res.status(400).json({ message: 'Invalid session id' });
    return;
  }

  const parsed = sessionUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  try {
    const existing = await ChatSession.findOne({
      userId: req.auth.userId,
      sessionId: sessionIdRaw,
    }).exec();

    const sessionType = parsed.data.sessionType ?? existing?.sessionType ?? 'manual';
    const normalizedMessages = parsed.data.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content.trim(),
      citations: message.citations?.map(citation => ({
        label: citation.label,
        sourceTitle: citation.sourceTitle,
        sectionTitle: citation.sectionTitle,
      })),
      createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
    }));
    const summary = await summarizeChatSession(
      normalizedMessages.map(message => ({ role: message.role, content: message.content })),
      sessionType
    );

    const next = await ChatSession.findOneAndUpdate(
      {
        userId: req.auth.userId,
        sessionId: sessionIdRaw,
      },
      {
        $set: {
          sessionType,
          title: summary.title,
          summary: summary.summary,
          riskAlertCodes: parsed.data.riskAlertCodes ?? existing?.riskAlertCodes ?? [],
          messages: normalizedMessages,
        },
        $setOnInsert: {
          userId: req.auth.userId,
          sessionId: sessionIdRaw,
          createdAt: existing?.createdAt ?? new Date(),
        },
      },
      {
        new: true,
        upsert: true,
      }
    ).exec();

    res.status(existing ? 200 : 201).json({
      session: serializeSession({
        sessionId: next.sessionId,
        title: next.title,
        summary: next.summary,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        sessionType: next.sessionType,
        riskAlertCodes: next.riskAlertCodes,
        messages: next.messages,
      }),
    });
  } catch (error) {
    console.error('[session] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save chat session' });
  }
}
