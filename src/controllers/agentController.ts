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

const clientHealthSnapshotSchema = z
  .object({
    source: z.enum(['healthkit', 'mock']).optional(),
    authorized: z.boolean().optional(),
    generatedAt: z.string().datetime({ offset: true }).optional(),
    uploadedAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(1000).optional(),
    activity: z.record(z.unknown()).optional(),
    sleep: z.record(z.unknown()).optional(),
    heart: z.record(z.unknown()).optional(),
    oxygen: z.record(z.unknown()).optional(),
    metabolic: z.record(z.unknown()).optional(),
    environment: z.record(z.unknown()).optional(),
    body: z.record(z.unknown()).optional(),
    workouts: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

const healthChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().positive().max(20).optional(),
  history: z.array(conversationTurnSchema).max(20).optional(),
  latestHealthSnapshot: clientHealthSnapshotSchema.optional(),
});

const askSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().positive().max(20).optional(),
  style: z.enum(['readable', 'default']).optional(),
});

type ClientHealthSnapshotPayload = z.infer<typeof clientHealthSnapshotSchema>;

function formatMetric(value: number | undefined, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return `${value}${unit}`;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildHealthContextFromClientSnapshot(snapshot: ClientHealthSnapshotPayload): string {
  const lines: string[] = [];
  lines.push(`来源: ${snapshot.source ?? 'unknown'}, 授权状态: ${snapshot.authorized ? '已授权' : '未授权'}`);

  if (snapshot.generatedAt) {
    lines.push(`采集时间: ${snapshot.generatedAt}`);
  }
  if (snapshot.uploadedAt) {
    lines.push(`上传时间: ${snapshot.uploadedAt}`);
  }

  const activity = toRecord(snapshot.activity);
  if (activity) {
    lines.push(
      `活动: 步数=${formatMetric(toNumber(activity.stepsToday), '步')}, 距离=${formatMetric(
        toNumber(activity.distanceWalkingRunningKmToday),
        'km'
      )}, 活动能量=${formatMetric(toNumber(activity.activeEnergyKcalToday), 'kcal')}, 运动分钟=${formatMetric(
        toNumber(activity.exerciseMinutesToday),
        'min'
      )}`
    );
  }

  const sleep = toRecord(snapshot.sleep);
  if (sleep) {
    lines.push(
      `睡眠: 入睡时长=${formatMetric(toNumber(sleep.asleepMinutesLast36h), 'min')}, 在床时长=${formatMetric(
        toNumber(sleep.inBedMinutesLast36h),
        'min'
      )}, 睡眠评分=${formatMetric(toNumber(sleep.sleepScore))}`
    );

    const stage = toRecord(sleep.stageMinutesLast36h);
    if (stage) {
      lines.push(
        `睡眠分期: Core=${formatMetric(
          toNumber(stage.asleepCoreMinutes),
          'min'
        )}, Deep=${formatMetric(toNumber(stage.asleepDeepMinutes), 'min')}, REM=${formatMetric(
          toNumber(stage.asleepREMMinutes),
          'min'
        )}, 醒来=${formatMetric(toNumber(stage.awakeMinutes), 'min')}`
      );
    }

    const apnea = toRecord(sleep.apnea);
    if (apnea) {
      lines.push(
        `睡眠呼吸暂停: 近30天事件=${formatMetric(
          toNumber(apnea.eventCountLast30d),
          '次'
        )}, 累计时长=${formatMetric(toNumber(apnea.durationMinutesLast30d), 'min')}, 风险=${
          typeof apnea.riskLevel === 'string' ? apnea.riskLevel : '-'
        }`
      );
      if (typeof apnea.reminder === 'string' && apnea.reminder.trim().length > 0) {
        lines.push(`睡眠呼吸暂停提醒: ${apnea.reminder.trim()}`);
      }
    }
  }

  const heart = toRecord(snapshot.heart);
  if (heart) {
    lines.push(
      `心脏: 最新心率=${formatMetric(toNumber(heart.latestHeartRateBpm), 'bpm')}, 静息心率=${formatMetric(
        toNumber(heart.restingHeartRateBpm),
        'bpm'
      )}, HRV=${formatMetric(toNumber(heart.heartRateVariabilityMs), 'ms')}, 收缩压/舒张压=${formatMetric(
        toNumber(heart.systolicBloodPressureMmhg),
        'mmHg'
      )}/${formatMetric(toNumber(heart.diastolicBloodPressureMmhg), 'mmHg')}`
    );
  }

  const oxygen = toRecord(snapshot.oxygen);
  if (oxygen) {
    lines.push(`血氧: ${formatMetric(toNumber(oxygen.bloodOxygenPercent), '%')}`);
  }

  const metabolic = toRecord(snapshot.metabolic);
  if (metabolic) {
    lines.push(`血糖: ${formatMetric(toNumber(metabolic.bloodGlucoseMgDl), 'mg/dL')}`);
  }

  const environment = toRecord(snapshot.environment);
  if (environment) {
    lines.push(`日照时长: ${formatMetric(toNumber(environment.daylightMinutesToday), 'min')}`);
  }

  const body = toRecord(snapshot.body);
  if (body) {
    lines.push(
      `身体指标: 呼吸率=${formatMetric(toNumber(body.respiratoryRateBrpm), 'brpm')}, 体温=${formatMetric(
        toNumber(body.bodyTemperatureCelsius),
        '°C'
      )}, 体重=${formatMetric(toNumber(body.bodyMassKg), 'kg')}`
    );
  }

  if (Array.isArray(snapshot.workouts) && snapshot.workouts.length > 0) {
    const recent = snapshot.workouts[0];
    lines.push(
      `运动记录: 共${snapshot.workouts.length}条, 最近一次=${
        typeof recent.activityTypeName === 'string'
          ? recent.activityTypeName
          : typeof recent.activityTypeCode === 'number'
          ? String(recent.activityTypeCode)
          : '未知'
      }, 时长=${formatMetric(toNumber(recent.durationMinutes), 'min')}, 距离=${formatMetric(
        toNumber(recent.totalDistanceKm),
        'km'
      )}`
    );
  }

  if (snapshot.note) {
    lines.push(`备注: ${snapshot.note}`);
  }

  return lines.join('\n');
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

    if (sleep.stageMinutesLast36h) {
      lines.push(
        `睡眠分期: Core=${formatMetric(
          sleep.stageMinutesLast36h.asleepCoreMinutes,
          'min'
        )}, Deep=${formatMetric(sleep.stageMinutesLast36h.asleepDeepMinutes, 'min')}, REM=${formatMetric(
          sleep.stageMinutesLast36h.asleepREMMinutes,
          'min'
        )}, 醒来=${formatMetric(sleep.stageMinutesLast36h.awakeMinutes, 'min')}`
      );
    }

    if (Array.isArray(sleep.samplesLast36h) && sleep.samplesLast36h.length > 0) {
      lines.push(`睡眠样本: ${sleep.samplesLast36h.length} 条`);
    }

    if (sleep.apnea) {
      lines.push(
        `睡眠呼吸暂停: 近30天事件=${formatMetric(
          sleep.apnea.eventCountLast30d,
          '次'
        )}, 累计时长=${formatMetric(sleep.apnea.durationMinutesLast30d, 'min')}, 风险=${sleep.apnea.riskLevel ?? '-'}`
      );
      if (sleep.apnea.reminder) {
        lines.push(`睡眠呼吸暂停提醒: ${sleep.apnea.reminder}`);
      }
    }
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
    const clientSnapshot = parsed.data.latestHealthSnapshot;
    let latestSnapshot: HealthSnapshotDocument | null = null;
    let healthContext: string | undefined;
    let healthSnapshotUsed:
      | {
          id: string | null;
          source: string;
          generatedAt: string | null;
          uploadedAt: string | null;
          from: 'client_payload' | 'db';
        }
      | null = null;

    if (clientSnapshot) {
      healthContext = buildHealthContextFromClientSnapshot(clientSnapshot);
      healthSnapshotUsed = {
        id: null,
        source: clientSnapshot.source ?? 'unknown',
        generatedAt: clientSnapshot.generatedAt ?? null,
        uploadedAt: clientSnapshot.uploadedAt ?? null,
        from: 'client_payload',
      };
    } else {
      latestSnapshot = await HealthSnapshot.findOne({ userId: req.auth.userId })
        .sort({ uploadedAt: -1 })
        .exec();
      healthContext = latestSnapshot ? buildHealthContext(latestSnapshot) : undefined;
      healthSnapshotUsed = latestSnapshot
        ? {
            id: latestSnapshot.id,
            source: latestSnapshot.source,
            generatedAt: latestSnapshot.generatedAt.toISOString(),
            uploadedAt: latestSnapshot.uploadedAt.toISOString(),
            from: 'db',
          }
        : null;
    }

    const result = await answerWithRagPersonalized({
      question: parsed.data.message,
      topK: parsed.data.topK ?? env.RAG_TOP_K,
      conversationHistory: normalizeHistory(parsed.data.history),
      healthContext,
    });

    res.status(200).json({
      ...result,
      healthSnapshotUsed,
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

export async function simpleAsk(req: Request, res: Response): Promise<void> {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
    return;
  }

  try {
    const style = parsed.data.style ?? 'readable';
    const result = await answerWithRagPersonalized({
      question: parsed.data.question,
      topK: parsed.data.topK ?? env.RAG_TOP_K,
      responseStyle: style,
      temperature: 0,
    });
    res.status(200).json({
      ...result,
      profile: {
        name: 'graph-rag-best-v1',
        responseStyle: style,
        embeddingModel: env.EMBEDDING_MODEL,
        graphPath: env.RAG_GRAPH_PATH,
        pprAlpha: env.RAG_GRAPH_PPR_ALPHA,
        topNodes: env.RAG_GRAPH_TOP_NODES,
        minConfidence: env.RAG_GRAPH_MIN_CONFIDENCE,
        maxWeight: env.RAG_GRAPH_MAX_WEIGHT,
        rrfWeight: env.RAG_GRAPH_RRF_WEIGHT,
        temperature: 0,
      },
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

    console.error('[agent] simpleAsk failed:', error);
    res.status(500).json({ message: 'Agent ask request failed' });
  }
}
