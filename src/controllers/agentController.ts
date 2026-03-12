import { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { HealthSnapshotDocument, HealthSnapshot } from '../models/HealthSnapshot';
import { User } from '../models/User';
import { UserHealthProfile } from '../models/UserHealthProfile';
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
    source: z.enum(['healthkit', 'huawei_health', 'huawei', 'mock']).optional(),
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
    profile: z.record(z.unknown()).optional(),
    body: z.record(z.unknown()).optional(),
    huawei: z.record(z.unknown()).optional(),
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

function formatHoursMetric(valueMinutes: number | undefined, digits = 1): string {
  if (typeof valueMinutes !== 'number' || !Number.isFinite(valueMinutes)) {
    return '-';
  }
  if (Math.abs(valueMinutes) < 60) {
    return `${Math.round(valueMinutes)}分钟`;
  }
  return `${(valueMinutes / 60).toFixed(digits)}小时`;
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
      )}, 活动能量=${formatMetric(toNumber(activity.activeEnergyKcalToday), '千卡')}, 运动时长=${formatHoursMetric(
        toNumber(activity.exerciseMinutesToday)
      )}`
    );
  }

  const sleep = toRecord(snapshot.sleep);
  if (sleep) {
    lines.push(
      `睡眠: 入睡时长=${formatHoursMetric(toNumber(sleep.asleepMinutesLast36h))}, 在床时长=${formatHoursMetric(
        toNumber(sleep.inBedMinutesLast36h)
      )}, 睡眠评分=${formatMetric(toNumber(sleep.sleepScore))}`
    );

    const stage = toRecord(sleep.stageMinutesLast36h);
    if (stage) {
      lines.push(
        `睡眠分期: 浅睡=${formatHoursMetric(
          toNumber(stage.asleepCoreMinutes)
        )}, 深睡=${formatHoursMetric(toNumber(stage.asleepDeepMinutes))}, 快速眼动=${formatHoursMetric(
          toNumber(stage.asleepREMMinutes)
        )}, 醒来=${formatHoursMetric(toNumber(stage.awakeMinutes))}`
      );
    }

    const apnea = toRecord(sleep.apnea);
    if (apnea) {
      lines.push(
        `睡眠呼吸暂停: 近30天事件=${formatMetric(
          toNumber(apnea.eventCountLast30d),
          '次'
        )}, 累计时长=${formatHoursMetric(toNumber(apnea.durationMinutesLast30d))}, 风险=${
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
      `心脏: 最新心率=${formatMetric(toNumber(heart.latestHeartRateBpm), '次/分')}, 静息心率=${formatMetric(
        toNumber(heart.restingHeartRateBpm),
        '次/分'
      )}, 心率变异性=${formatMetric(toNumber(heart.heartRateVariabilityMs), '毫秒')}, 收缩压/舒张压=${formatMetric(
        toNumber(heart.systolicBloodPressureMmhg),
        '毫米汞柱'
      )}/${formatMetric(toNumber(heart.diastolicBloodPressureMmhg), '毫米汞柱')}`
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
    lines.push(`日照时长: ${formatHoursMetric(toNumber(environment.daylightMinutesToday))}`);
  }

  const body = toRecord(snapshot.body);
  if (body) {
    lines.push(
      `身体指标: 呼吸率=${formatMetric(toNumber(body.respiratoryRateBrpm), '次/分')}, 体温=${formatMetric(
        toNumber(body.bodyTemperatureCelsius),
        '°C'
      )}, 体重=${formatMetric(toNumber(body.bodyMassKg), 'kg')}`
    );
  }

  const huawei = toRecord(snapshot.huawei);
  if (huawei) {
    const huaweiActivity = toRecord(huawei.activity);
    if (huaweiActivity) {
      lines.push(
        `华为活动: 步数=${formatMetric(toNumber(huaweiActivity.stepsToday), '步')}, 距离=${formatMetric(
          toNumber(huaweiActivity.distanceKmToday),
          'km'
        )}, 卡路里=${formatMetric(toNumber(huaweiActivity.caloriesKcalToday), '千卡')}, 活跃时长=${formatHoursMetric(
          toNumber(huaweiActivity.activeMinutesToday)
        )}`
      );
    }

    const huaweiSleep = toRecord(huawei.sleep);
    if (huaweiSleep) {
      lines.push(
        `华为睡眠: 总睡眠=${formatHoursMetric(
          toNumber(huaweiSleep.asleepMinutesLast24h)
        )}, 深睡=${formatHoursMetric(toNumber(huaweiSleep.deepSleepMinutesLast24h))}, 快速眼动=${formatHoursMetric(
          toNumber(huaweiSleep.remSleepMinutesLast24h)
        )}, 评分=${formatMetric(toNumber(huaweiSleep.sleepScore))}`
      );
    }

    const huaweiHeart = toRecord(huawei.heart);
    if (huaweiHeart) {
      lines.push(
        `华为心脏: 最新心率=${formatMetric(
          toNumber(huaweiHeart.latestHeartRateBpm),
          '次/分'
        )}, 静息心率=${formatMetric(toNumber(huaweiHeart.restingHeartRateBpm), '次/分')}, 最高/最低=${formatMetric(
          toNumber(huaweiHeart.maxHeartRateBpmLast24h),
          '次/分'
        )}/${formatMetric(toNumber(huaweiHeart.minHeartRateBpmLast24h), '次/分')}`
      );
      if (typeof huaweiHeart.heartRateWarning === 'string' && huaweiHeart.heartRateWarning.trim().length > 0) {
        lines.push(`华为心率预警: ${huaweiHeart.heartRateWarning.trim()}`);
      }
    }

    const huaweiOxygen = toRecord(huawei.oxygen);
    if (huaweiOxygen) {
      lines.push(
        `华为血氧: 最新=${formatMetric(
          toNumber(huaweiOxygen.latestSpO2Percent),
          '%'
        )}, 最低=${formatMetric(toNumber(huaweiOxygen.minSpO2PercentLast24h), '%')}`
      );
    }

    const huaweiStress = toRecord(huawei.stress);
    if (huaweiStress) {
      lines.push(
        `华为压力: 最新=${formatMetric(
          toNumber(huaweiStress.latestStressScore)
        )}, 平均=${formatMetric(toNumber(huaweiStress.averageStressScoreToday))}, 心率变异性=${formatMetric(
          toNumber(huaweiStress.hrvMs),
          '毫秒'
        )}`
      );
    }

    const huaweiBody = toRecord(huawei.body);
    if (huaweiBody) {
      lines.push(
        `华为身体成分: 体重=${formatMetric(toNumber(huaweiBody.weightKg), 'kg')}, 体重指数=${formatMetric(
          toNumber(huaweiBody.bmi)
        )}, 体脂=${formatMetric(toNumber(huaweiBody.bodyFatPercent), '%')}`
      );
    }

    const huaweiBloodPressure = toRecord(huawei.bloodPressure);
    if (huaweiBloodPressure) {
      lines.push(
        `华为血压: 收缩压/舒张压=${formatMetric(
          toNumber(huaweiBloodPressure.latestSystolicMmhg),
          '毫米汞柱'
        )}/${formatMetric(toNumber(huaweiBloodPressure.latestDiastolicMmhg), '毫米汞柱')}`
      );
    }
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
      }, 时长=${formatHoursMetric(toNumber(recent.durationMinutes))}, 距离=${formatMetric(
        toNumber(recent.totalDistanceKm),
        'km'
      )}`
    );
  } else if (huawei && Array.isArray(huawei.workouts) && huawei.workouts.length > 0) {
    const recent = toRecord(huawei.workouts[0]);
    lines.push(
      `华为运动记录: 共${huawei.workouts.length}条, 最近一次=${
        typeof recent?.activityTypeName === 'string'
          ? recent.activityTypeName
          : typeof recent?.activityTypeCode === 'number'
          ? String(recent.activityTypeCode)
          : '未知'
      }, 时长=${formatHoursMetric(toNumber(recent?.durationMinutes))}, 距离=${formatMetric(
        toNumber(recent?.totalDistanceKm),
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
      )}, 活动能量=${formatMetric(activity.activeEnergyKcalToday, '千卡')}, 运动时长=${formatHoursMetric(
        activity.exerciseMinutesToday
      )}`
    );
  }

  const sleep = snapshot.sleep;
  if (sleep) {
    lines.push(
      `睡眠: 入睡时长=${formatHoursMetric(sleep.asleepMinutesLast36h)}, 在床时长=${formatHoursMetric(
        sleep.inBedMinutesLast36h
      )}, 睡眠评分=${formatMetric(sleep.sleepScore)}`
    );

    if (sleep.stageMinutesLast36h) {
      lines.push(
        `睡眠分期: 浅睡=${formatHoursMetric(
          sleep.stageMinutesLast36h.asleepCoreMinutes
        )}, 深睡=${formatHoursMetric(sleep.stageMinutesLast36h.asleepDeepMinutes)}, 快速眼动=${formatHoursMetric(
          sleep.stageMinutesLast36h.asleepREMMinutes
        )}, 醒来=${formatHoursMetric(sleep.stageMinutesLast36h.awakeMinutes)}`
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
        )}, 累计时长=${formatHoursMetric(sleep.apnea.durationMinutesLast30d)}, 风险=${sleep.apnea.riskLevel ?? '-'}`
      );
      if (sleep.apnea.reminder) {
        lines.push(`睡眠呼吸暂停提醒: ${sleep.apnea.reminder}`);
      }
    }
  }

  const heart = snapshot.heart;
  if (heart) {
    lines.push(
      `心脏: 最新心率=${formatMetric(heart.latestHeartRateBpm, '次/分')}, 静息心率=${formatMetric(
        heart.restingHeartRateBpm,
        '次/分'
      )}, 心率变异性=${formatMetric(heart.heartRateVariabilityMs, '毫秒')}, 收缩压/舒张压=${formatMetric(
        heart.systolicBloodPressureMmhg,
        '毫米汞柱'
      )}/${formatMetric(heart.diastolicBloodPressureMmhg, '毫米汞柱')}`
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
    lines.push(`日照时长: ${formatHoursMetric(environment.daylightMinutesToday)}`);
  }

  const body = snapshot.body;
  if (body) {
    lines.push(
      `身体指标: 呼吸率=${formatMetric(body.respiratoryRateBrpm, '次/分')}, 体温=${formatMetric(
        body.bodyTemperatureCelsius,
        '°C'
      )}, 体重=${formatMetric(body.bodyMassKg, 'kg')}`
    );
  }

  const huawei = snapshot.huawei;
  if (huawei) {
    if (huawei.activity) {
      lines.push(
        `华为活动: 步数=${formatMetric(huawei.activity.stepsToday, '步')}, 距离=${formatMetric(
          huawei.activity.distanceKmToday,
          'km'
        )}, 卡路里=${formatMetric(huawei.activity.caloriesKcalToday, '千卡')}, 活跃时长=${formatHoursMetric(
          huawei.activity.activeMinutesToday
        )}`
      );
    }

    if (huawei.sleep) {
      lines.push(
        `华为睡眠: 总睡眠=${formatHoursMetric(
          huawei.sleep.asleepMinutesLast24h
        )}, 深睡=${formatHoursMetric(huawei.sleep.deepSleepMinutesLast24h)}, 快速眼动=${formatHoursMetric(
          huawei.sleep.remSleepMinutesLast24h
        )}, 评分=${formatMetric(huawei.sleep.sleepScore)}`
      );
    }

    if (huawei.heart) {
      lines.push(
        `华为心脏: 最新心率=${formatMetric(
          huawei.heart.latestHeartRateBpm,
          '次/分'
        )}, 静息心率=${formatMetric(huawei.heart.restingHeartRateBpm, '次/分')}, 最高/最低=${formatMetric(
          huawei.heart.maxHeartRateBpmLast24h,
          '次/分'
        )}/${formatMetric(huawei.heart.minHeartRateBpmLast24h, '次/分')}`
      );
      if (huawei.heart.heartRateWarning) {
        lines.push(`华为心率预警: ${huawei.heart.heartRateWarning}`);
      }
    }

    if (huawei.oxygen) {
      lines.push(
        `华为血氧: 最新=${formatMetric(
          huawei.oxygen.latestSpO2Percent,
          '%'
        )}, 最低=${formatMetric(huawei.oxygen.minSpO2PercentLast24h, '%')}`
      );
    }

    if (huawei.stress) {
      lines.push(
        `华为压力: 最新=${formatMetric(
          huawei.stress.latestStressScore
        )}, 平均=${formatMetric(huawei.stress.averageStressScoreToday)}, 心率变异性=${formatMetric(
          huawei.stress.hrvMs,
          '毫秒'
        )}`
      );
    }

    if (huawei.body) {
      lines.push(
        `华为身体成分: 体重=${formatMetric(huawei.body.weightKg, 'kg')}, 体重指数=${formatMetric(
          huawei.body.bmi
        )}, 体脂=${formatMetric(huawei.body.bodyFatPercent, '%')}`
      );
    }

    if (huawei.bloodPressure) {
      lines.push(
        `华为血压: 收缩压/舒张压=${formatMetric(
          huawei.bloodPressure.latestSystolicMmhg,
          '毫米汞柱'
        )}/${formatMetric(huawei.bloodPressure.latestDiastolicMmhg, '毫米汞柱')}`
      );
    }
  }

  if (Array.isArray(snapshot.workouts) && snapshot.workouts.length > 0) {
    const recent = snapshot.workouts[0];
    lines.push(
      `运动记录: 共${snapshot.workouts.length}条, 最近一次=${
        recent.activityTypeName || recent.activityTypeCode || '未知'
      }, 时长=${formatHoursMetric(recent.durationMinutes)}, 距离=${formatMetric(
        recent.totalDistanceKm,
        'km'
      )}`
    );
  } else if (Array.isArray(snapshot.huawei?.workouts) && snapshot.huawei.workouts.length > 0) {
    const recent = snapshot.huawei.workouts[0];
    lines.push(
      `华为运动记录: 共${snapshot.huawei.workouts.length}条, 最近一次=${
        recent.activityTypeName || recent.activityTypeCode || '未知'
      }, 时长=${formatHoursMetric(recent.durationMinutes)}, 距离=${formatMetric(
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

function buildHealthProfileContext(profile: {
  llmHealthOverview?: string;
  latestSignals?: Array<{
    title: string;
    severity: 'watch' | 'high';
    latestMessage?: string;
    latestRecommendation?: string;
  }>;
  trackedSignals?: Array<{
    title: string;
    occurrenceCount: number;
    lastDetectedAt: Date;
  }>;
  lastSnapshotGeneratedAt?: Date;
  lastSnapshotSource?: string;
} | null): string | undefined {
  if (!profile) {
    return undefined;
  }

  const latestSignalCount = profile.latestSignals?.length ?? 0;
  const highRiskCount = profile.latestSignals?.filter(signal => signal.severity === 'high').length ?? 0;
  const trackedSignalCount = profile.trackedSignals?.length ?? 0;
  const totalOccurrences =
    profile.trackedSignals?.reduce((sum, signal) => sum + signal.occurrenceCount, 0) ?? 0;
  const lines: string[] = [];
  lines.push('用户历史健康画像:');
  lines.push(`最近一次画像更新时间: ${profile.lastSnapshotGeneratedAt?.toISOString() ?? '-'}`);
  lines.push(`最近一次画像来源: ${profile.lastSnapshotSource ?? '-'}`);
  if (profile.llmHealthOverview) {
    lines.push(`画像总览: ${profile.llmHealthOverview}`);
  }
  lines.push(
    `模型统计: 本次异常 ${latestSignalCount} 项，高风险 ${highRiskCount} 项，历史累计异常类型 ${trackedSignalCount} 项，累计触发 ${totalOccurrences} 次。`
  );

  if (Array.isArray(profile.latestSignals) && profile.latestSignals.length > 0) {
    lines.push(
      `最近识别异常: ${profile.latestSignals
        .slice(0, 6)
        .map(
          signal =>
            `${signal.title}(${signal.severity === 'high' ? '高' : '中'}风险)：${signal.latestMessage ?? ''}${
              signal.latestRecommendation ? `；建议 ${signal.latestRecommendation}` : ''
            }`
        )
        .join(' | ')}`
    );
  }

  if (Array.isArray(profile.trackedSignals) && profile.trackedSignals.length > 0) {
    lines.push(
      `累计异常记录: ${profile.trackedSignals
        .slice(0, 8)
        .map(signal => `${signal.title}(${signal.occurrenceCount}次, 最近 ${signal.lastDetectedAt.toISOString()})`)
        .join(' | ')}`
    );
    lines.push(
      `高频异常Top3: ${[...profile.trackedSignals]
        .sort((left, right) => right.occurrenceCount - left.occurrenceCount)
        .slice(0, 3)
        .map(signal => `${signal.title}(${signal.occurrenceCount}次)`)
        .join(' | ')}`
    );
  }

  return lines.join('\n');
}

function buildUserBaselineContext(user: {
  age?: number;
  gender?: string;
  heightCm?: number;
  weightKg?: number;
  experimentConsent?: boolean;
} | null): string | undefined {
  if (!user) {
    return undefined;
  }

  return [
    '账号基础信息:',
    `年龄: ${user.age ?? '未知'}`,
    `性别: ${user.gender ?? '未知'}`,
    `身高: ${user.heightCm ?? '未知'} cm`,
    `体重: ${user.weightKg ?? '未知'} kg`,
    `实验参与: ${user.experimentConsent ? '已同意' : '未同意'}`,
  ].join('\n');
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
    const [healthProfile, user] = await Promise.all([
      UserHealthProfile.findOne({ userId: req.auth.userId }).exec(),
      User.findById(req.auth.userId).exec(),
    ]);
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

    const userBaselineContext = buildUserBaselineContext(user);
    const healthProfileContext = buildHealthProfileContext(healthProfile);
    healthContext = [userBaselineContext, healthContext, healthProfileContext].filter(Boolean).join('\n\n') || undefined;

    const result = await answerWithRagPersonalized({
      question: parsed.data.message,
      topK: parsed.data.topK ?? env.RAG_TOP_K,
      conversationHistory: normalizeHistory(parsed.data.history),
      healthContext,
      strictTcmScope: true,
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
