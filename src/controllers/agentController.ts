import { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { HealthSnapshotDocument, HealthSnapshot } from '../models/HealthSnapshot';
import {
  answerWithRag,
  answerWithRagPersonalized,
  ConversationTurn,
} from '../services/rag/answerWithRag';

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().positive().max(20).optional(),
});

const conversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2000),
});

const healthChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().positive().max(20).optional(),
  history: z.array(conversationTurnSchema).max(20).optional(),
});

function formatMetric(value: number | undefined, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return `${value}${unit}`;
}

function buildHealthContext(snapshot: HealthSnapshotDocument): string {
  const lines: string[] = [];
  lines.push(`来源: ${snapshot.source}, 授权状态: ${snapshot.authorized ? '已授权' : '未授权'}`);
  lines.push(`采集时间: ${snapshot.generatedAt.toISOString()}`);
  lines.push(`上传时间: ${snapshot.uploadedAt.toISOString()}`);

  const activity = snapshot.activity;
  if (activity) {
    lines.push(
      `活动: 步数=${formatMetric(activity.stepsToday, '步')}, 距离=${formatMetric(
        activity.distanceWalkingRunningKmToday,
        'km'
      )}, 活动能量=${formatMetric(activity.activeEnergyKcalToday, 'kcal')}, 运动分钟=${formatMetric(
        activity.exerciseMinutesToday,
        'min'
      )}`
    );
  }

  const sleep = snapshot.sleep;
  if (sleep) {
    lines.push(
      `睡眠: 入睡时长=${formatMetric(sleep.asleepMinutesLast36h, 'min')}, 在床时长=${formatMetric(
        sleep.inBedMinutesLast36h,
        'min'
      )}, 睡眠评分=${formatMetric(sleep.sleepScore)}`
    );
  }

  const heart = snapshot.heart;
  if (heart) {
    lines.push(
      `心脏: 最新心率=${formatMetric(heart.latestHeartRateBpm, 'bpm')}, 静息心率=${formatMetric(
        heart.restingHeartRateBpm,
        'bpm'
      )}, HRV=${formatMetric(heart.heartRateVariabilityMs, 'ms')}, 收缩压/舒张压=${formatMetric(
        heart.systolicBloodPressureMmhg,
        'mmHg'
      )}/${formatMetric(heart.diastolicBloodPressureMmhg, 'mmHg')}`
    );
  }

  const oxygen = snapshot.oxygen;
  if (oxygen) {
    lines.push(`血氧: ${formatMetric(oxygen.bloodOxygenPercent, '%')}`);
  }

  const metabolic = snapshot.metabolic;
  if (metabolic) {
    lines.push(`血糖: ${formatMetric(metabolic.bloodGlucoseMgDl, 'mg/dL')}`);
  }

  const environment = snapshot.environment;
  if (environment) {
    lines.push(`日照时长: ${formatMetric(environment.daylightMinutesToday, 'min')}`);
  }

  const body = snapshot.body;
  if (body) {
    lines.push(
      `身体指标: 呼吸率=${formatMetric(body.respiratoryRateBrpm, 'brpm')}, 体温=${formatMetric(
        body.bodyTemperatureCelsius,
        '°C'
      )}, 体重=${formatMetric(body.bodyMassKg, 'kg')}`
    );
  }

  if (Array.isArray(snapshot.workouts) && snapshot.workouts.length > 0) {
    const recent = snapshot.workouts[0];
    lines.push(
      `运动记录: 共${snapshot.workouts.length}条, 最近一次=${
        recent.activityTypeName || recent.activityTypeCode || '未知'
      }, 时长=${formatMetric(recent.durationMinutes, 'min')}, 距离=${formatMetric(
        recent.totalDistanceKm,
        'km'
      )}`
    );
  }

  if (snapshot.note) {
    lines.push(`备注: ${snapshot.note}`);
  }

  return lines.join('\n');
}

function normalizeHistory(history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined):
  | ConversationTurn[]
  | undefined {
  if (!history || history.length === 0) {
    return undefined;
  }
  return history.map((item) => ({ role: item.role, content: item.content.trim() }));
}

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

export async function ragHealthChat(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const parsed = healthChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  try {
    const latestSnapshot = await HealthSnapshot.findOne({ userId: req.auth.userId })
      .sort({ uploadedAt: -1 })
      .exec();

    const healthContext = latestSnapshot ? buildHealthContext(latestSnapshot) : undefined;
    const result = await answerWithRagPersonalized({
      question: parsed.data.message,
      topK: parsed.data.topK ?? env.RAG_TOP_K,
      conversationHistory: normalizeHistory(parsed.data.history),
      healthContext,
    });

    res.status(200).json({
      ...result,
      healthSnapshotUsed: latestSnapshot
        ? {
            id: latestSnapshot.id,
            source: latestSnapshot.source,
            generatedAt: latestSnapshot.generatedAt.toISOString(),
            uploadedAt: latestSnapshot.uploadedAt.toISOString(),
          }
        : null,
    });
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

    console.error('[agent] ragHealthChat failed:', error);
    res.status(500).json({ message: 'Agent health chat request failed' });
  }
}
