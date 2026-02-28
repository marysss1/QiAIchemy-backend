import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ZodError, z } from 'zod';
import { HealthSnapshot } from '../models/HealthSnapshot';

const optionalNumber = z.number().finite().optional();
const optionalDateTime = z.string().datetime({ offset: true }).optional();

const healthTrendPointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    value: z.number().finite(),
    unit: z.string().trim().min(1).max(24),
  })
  .passthrough();

const healthSleepStageMinutesSchema = z
  .object({
    inBedMinutes: optionalNumber,
    asleepUnspecifiedMinutes: optionalNumber,
    awakeMinutes: optionalNumber,
    asleepCoreMinutes: optionalNumber,
    asleepDeepMinutes: optionalNumber,
    asleepREMMinutes: optionalNumber,
  })
  .passthrough();

const healthSleepSampleSchema = z
  .object({
    value: z.number().int(),
    stage: z
      .enum(['inBed', 'asleepUnspecified', 'awake', 'asleepCore', 'asleepDeep', 'asleepREM', 'unknown']),
    startDate: z.string().datetime({ offset: true }),
    endDate: z.string().datetime({ offset: true }),
    sourceName: z.string().trim().max(200).optional(),
    sourceBundleId: z.string().trim().max(200).optional(),
  })
  .passthrough();

const healthSleepApneaDataSchema = z
  .object({
    eventCountLast30d: optionalNumber,
    durationMinutesLast30d: optionalNumber,
    latestEventAt: optionalDateTime,
    riskLevel: z.enum(['none', 'watch', 'high', 'unknown']).optional(),
    reminder: z.string().trim().max(500).optional(),
  })
  .passthrough();

const healthWorkoutRecordSchema = z
  .object({
    activityTypeCode: z.number().int().optional(),
    activityTypeName: z.string().trim().max(100).optional(),
    startDate: optionalDateTime,
    endDate: optionalDateTime,
    durationMinutes: optionalNumber,
    totalEnergyKcal: optionalNumber,
    totalDistanceKm: optionalNumber,
  })
  .passthrough();

const healthActivityDataSchema = z
  .object({
    stepsToday: optionalNumber,
    distanceWalkingRunningKmToday: optionalNumber,
    activeEnergyKcalToday: optionalNumber,
    basalEnergyKcalToday: optionalNumber,
    flightsClimbedToday: optionalNumber,
    exerciseMinutesToday: optionalNumber,
    standHoursToday: optionalNumber,
    stepsHourlySeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
    activeEnergyHourlySeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
    exerciseMinutesHourlySeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
  })
  .passthrough();

const healthSleepDataSchema = z
  .object({
    inBedMinutesLast36h: optionalNumber,
    asleepMinutesLast36h: optionalNumber,
    awakeMinutesLast36h: optionalNumber,
    sampleCountLast36h: optionalNumber,
    sleepScore: optionalNumber,
    stageMinutesLast36h: healthSleepStageMinutesSchema.optional(),
    samplesLast36h: z.array(healthSleepSampleSchema).max(1000).optional(),
    apnea: healthSleepApneaDataSchema.optional(),
  })
  .passthrough();

const healthHeartDataSchema = z
  .object({
    latestHeartRateBpm: optionalNumber,
    restingHeartRateBpm: optionalNumber,
    walkingHeartRateAverageBpm: optionalNumber,
    heartRateVariabilityMs: optionalNumber,
    vo2MaxMlKgMin: optionalNumber,
    atrialFibrillationBurdenPercent: optionalNumber,
    systolicBloodPressureMmhg: optionalNumber,
    diastolicBloodPressureMmhg: optionalNumber,
    heartRateSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
    heartRateVariabilitySeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthOxygenDataSchema = z
  .object({
    bloodOxygenPercent: optionalNumber,
    bloodOxygenSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthMetabolicDataSchema = z
  .object({
    bloodGlucoseMgDl: optionalNumber,
    bloodGlucoseSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthEnvironmentDataSchema = z
  .object({
    daylightMinutesToday: optionalNumber,
    daylightSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthBodyDataSchema = z
  .object({
    respiratoryRateBrpm: optionalNumber,
    bodyTemperatureCelsius: optionalNumber,
    bodyMassKg: optionalNumber,
    respiratoryRateSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
    bodyTemperatureSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
    bodyMassSeriesLast30d: z.array(healthTrendPointSchema).max(1500).optional(),
  })
  .passthrough();

const healthKitAllDataSchema = z
  .object({
    source: z.enum(['healthkit', 'mock']),
    authorized: z.boolean(),
    generatedAt: z.string().datetime({ offset: true }),
    note: z.string().max(1000).optional(),
    activity: healthActivityDataSchema.optional(),
    sleep: healthSleepDataSchema.optional(),
    heart: healthHeartDataSchema.optional(),
    oxygen: healthOxygenDataSchema.optional(),
    metabolic: healthMetabolicDataSchema.optional(),
    environment: healthEnvironmentDataSchema.optional(),
    body: healthBodyDataSchema.optional(),
    workouts: z.array(healthWorkoutRecordSchema).optional(),
  })
  .passthrough();

const healthUploadBodySchema = z
  .object({
    snapshot: healthKitAllDataSchema,
    syncReason: z.enum(['manual', 'auto', 'chat']).optional(),
  })
  .passthrough();

type HealthUploadPayload = z.infer<typeof healthKitAllDataSchema>;
type HealthSyncReason = 'manual' | 'auto' | 'chat';

type HealthRiskAlertSeverity = 'watch' | 'high';

type HealthRiskAlertCode =
  | 'heart_rate_warning'
  | 'blood_glucose_high'
  | 'sleep_score_low'
  | 'blood_oxygen_low'
  | 'sleep_apnea_detected';

type HealthRiskAlert = {
  code: HealthRiskAlertCode;
  severity: HealthRiskAlertSeverity;
  title: string;
  message: string;
  recommendation: string;
  value?: number;
  unit?: string;
  triggeredAt: string;
};

const HEALTH_RETRY_DEDUP_WINDOW_MS = 2 * 60 * 1000;
const HEALTH_SNAPSHOT_KEEP_MAX = 4320;
const HEALTH_SNAPSHOT_PRUNE_COOLDOWN_MS = 30 * 60 * 1000;
const pruneStampByUser = new Map<string, number>();

function severityRank(value: HealthRiskAlertSeverity): number {
  return value === 'high' ? 2 : 1;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

function createSnapshotDigest(snapshot: HealthUploadPayload): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

function estimatePayloadBytes(snapshot: HealthUploadPayload): number {
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  } catch (_error) {
    return 0;
  }
}

async function pruneSnapshotsForUser(userId: string, nowMs: number): Promise<void> {
  if (pruneStampByUser.size > 5000 && !pruneStampByUser.has(userId)) {
    pruneStampByUser.clear();
  }
  const lastPrunedAt = pruneStampByUser.get(userId) ?? 0;
  if (nowMs - lastPrunedAt < HEALTH_SNAPSHOT_PRUNE_COOLDOWN_MS) {
    return;
  }
  pruneStampByUser.set(userId, nowMs);

  const staleRows = await HealthSnapshot.find({ userId })
    .sort({ uploadedAt: -1 })
    .skip(HEALTH_SNAPSHOT_KEEP_MAX)
    .select('_id')
    .lean()
    .exec();

  if (staleRows.length === 0) {
    return;
  }

  const staleIds = staleRows.map(row => row._id);
  await HealthSnapshot.deleteMany({ _id: { $in: staleIds } }).exec();
}

function toMmolL(valueMgDl: number): number {
  return Math.round((valueMgDl / 18) * 10) / 10;
}

function detectHealthRiskAlerts(snapshot: HealthUploadPayload): HealthRiskAlert[] {
  const alertsByCode = new Map<HealthRiskAlertCode, HealthRiskAlert>();
  const triggeredAt = snapshot.generatedAt;

  const putAlert = (alert: HealthRiskAlert) => {
    const existing = alertsByCode.get(alert.code);
    if (!existing || severityRank(alert.severity) > severityRank(existing.severity)) {
      alertsByCode.set(alert.code, alert);
    }
  };

  const latestHeartRate = snapshot.heart?.latestHeartRateBpm;
  if (typeof latestHeartRate === 'number') {
    if (latestHeartRate >= 130) {
      putAlert({
        code: 'heart_rate_warning',
        severity: 'high',
        title: '心率预警',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，已明显偏高。`,
        recommendation: '请先停止活动并休息；若伴随胸闷、胸痛或头晕，请尽快就医。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    } else if (latestHeartRate <= 45) {
      putAlert({
        code: 'heart_rate_warning',
        severity: 'high',
        title: '心率预警',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，偏低。`,
        recommendation: '请先静坐复测；若持续偏低或有不适，请及时就医。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    } else if (latestHeartRate >= 115) {
      putAlert({
        code: 'heart_rate_warning',
        severity: 'watch',
        title: '心率偏高提醒',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，建议关注近期压力与睡眠。`,
        recommendation: '建议减少刺激性饮品，进行放松呼吸，连续观察 24 小时趋势。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    }
  }

  const restingHeartRate = snapshot.heart?.restingHeartRateBpm;
  if (typeof restingHeartRate === 'number' && restingHeartRate >= 100) {
    putAlert({
      code: 'heart_rate_warning',
      severity: 'watch',
      title: '静息心率偏高提醒',
      message: `静息心率约 ${Math.round(restingHeartRate)} bpm，提示恢复状态可能不足。`,
      recommendation: '建议优先保证睡眠并降低应激负荷，若持续升高请线下评估。',
      value: restingHeartRate,
      unit: 'bpm',
      triggeredAt,
    });
  }

  const heartRecord = snapshot.heart as Record<string, unknown> | undefined;
  const heartRateWarningRaw = typeof heartRecord?.heartRateWarning === 'string'
    ? heartRecord.heartRateWarning.trim().toLowerCase()
    : '';
  if (heartRateWarningRaw && heartRateWarningRaw !== 'normal' && heartRateWarningRaw !== 'none') {
    const severe = ['high', 'critical', 'danger'].includes(heartRateWarningRaw);
    putAlert({
      code: 'heart_rate_warning',
      severity: severe ? 'high' : 'watch',
      title: '心率系统预警',
      message: `检测到系统心率预警标记：${heartRateWarningRaw}。`,
      recommendation: '请结合当前症状进行复测，若出现不适请优先就医。',
      triggeredAt,
    });
  }

  const glucoseMgDl = snapshot.metabolic?.bloodGlucoseMgDl;
  if (typeof glucoseMgDl === 'number') {
    const glucoseMmolL = toMmolL(glucoseMgDl);
    if (glucoseMmolL >= 11.1) {
      putAlert({
        code: 'blood_glucose_high',
        severity: 'high',
        title: '血糖过高预警',
        message: `当前血糖约 ${glucoseMmolL} mmol/L（>=11.1）。`,
        recommendation: '请尽快复测并减少高糖摄入；若持续偏高请及时就医。',
        value: glucoseMmolL,
        unit: 'mmol/L',
        triggeredAt,
      });
    }
  }

  const sleepScore = snapshot.sleep?.sleepScore;
  if (typeof sleepScore === 'number') {
    if (sleepScore <= 35) {
      putAlert({
        code: 'sleep_score_low',
        severity: 'high',
        title: '睡眠分数极低预警',
        message: `本次睡眠分数约 ${Math.round(sleepScore)}，恢复质量较差。`,
        recommendation: '建议今天降低训练/工作负荷，优先补充睡眠并关注情绪状态。',
        value: sleepScore,
        unit: 'score',
        triggeredAt,
      });
    } else if (sleepScore <= 45) {
      putAlert({
        code: 'sleep_score_low',
        severity: 'watch',
        title: '睡眠分数偏低提醒',
        message: `本次睡眠分数约 ${Math.round(sleepScore)}，建议调整作息。`,
        recommendation: '建议减少晚间刺激、提前入睡，并持续观察 3 天趋势。',
        value: sleepScore,
        unit: 'score',
        triggeredAt,
      });
    }
  }

  const bloodOxygen = snapshot.oxygen?.bloodOxygenPercent;
  if (typeof bloodOxygen === 'number' && bloodOxygen < 90) {
    putAlert({
      code: 'blood_oxygen_low',
      severity: 'high',
      title: '血氧过低预警',
      message: `当前血氧约 ${Math.round(bloodOxygen)}%，低于 90%。`,
      recommendation: '请立即复测；若持续偏低或伴随呼吸不适，请尽快就医。',
      value: bloodOxygen,
      unit: '%',
      triggeredAt,
    });
  }

  const apneaEventCount = snapshot.sleep?.apnea?.eventCountLast30d;
  const apneaRiskLevel = snapshot.sleep?.apnea?.riskLevel;
  if (
    (typeof apneaEventCount === 'number' && apneaEventCount > 0) ||
    apneaRiskLevel === 'watch' ||
    apneaRiskLevel === 'high'
  ) {
    const severe = apneaRiskLevel === 'high' || (typeof apneaEventCount === 'number' && apneaEventCount >= 3);
    putAlert({
      code: 'sleep_apnea_detected',
      severity: severe ? 'high' : 'watch',
      title: '睡眠呼吸暂停提醒',
      message:
        typeof apneaEventCount === 'number'
          ? `近30天检测到约 ${Math.round(apneaEventCount)} 次睡眠呼吸暂停事件。`
          : '检测到睡眠呼吸暂停风险信号。',
      recommendation: '建议尽快进行睡眠专项评估，避免长期忽视造成白天功能受损。',
      value: apneaEventCount,
      unit: 'events/30d',
      triggeredAt,
    });
  }

  return Array.from(alertsByCode.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function getSnapshotPayload(body: unknown): { snapshot: HealthUploadPayload; syncReason: HealthSyncReason } {
  const wrappedParsed = healthUploadBodySchema.safeParse(body);
  if (wrappedParsed.success) {
    return {
      snapshot: wrappedParsed.data.snapshot,
      syncReason: wrappedParsed.data.syncReason ?? 'manual',
    };
  }
  return {
    snapshot: healthKitAllDataSchema.parse(body),
    syncReason: 'manual',
  };
}

export async function uploadHealthSnapshot(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const { snapshot, syncReason } = getSnapshotPayload(req.body);
    const generatedAtDate = new Date(snapshot.generatedAt);
    const now = new Date();
    const nowMs = now.getTime();
    const userId = req.auth.userId;

    if (Number.isNaN(generatedAtDate.getTime())) {
      res.status(400).json({ message: 'Invalid generatedAt datetime' });
      return;
    }

    const snapshotDigest = createSnapshotDigest(snapshot);
    const payloadBytes = estimatePayloadBytes(snapshot);
    const alerts = detectHealthRiskAlerts(snapshot);

    const existingSameSample = await HealthSnapshot.findOne({
      userId,
      source: snapshot.source,
      generatedAt: generatedAtDate,
    }).exec();

    if (existingSameSample) {
      existingSameSample.set({
        authorized: snapshot.authorized,
        syncReason,
        uploadedAt: now,
        snapshotDigest,
        payloadBytes,
        note: snapshot.note ?? '',
        activity: snapshot.activity,
        sleep: snapshot.sleep,
        heart: snapshot.heart,
        oxygen: snapshot.oxygen,
        metabolic: snapshot.metabolic,
        environment: snapshot.environment,
        body: snapshot.body,
        workouts: snapshot.workouts ?? [],
      });
      await existingSameSample.save();

      void pruneSnapshotsForUser(String(userId), nowMs).catch(error => {
        console.error('[health] prune failed:', error);
      });

      res.status(200).json({
        id: existingSameSample.id,
        uploadedAt: existingSameSample.uploadedAt.toISOString(),
        generatedAt: existingSameSample.generatedAt.toISOString(),
        hasRiskAlerts: alerts.length > 0,
        alerts,
        deduplicated: true,
        dedupReason: 'same_generated_at',
      });
      return;
    }

    const latest = await HealthSnapshot.findOne({ userId })
      .sort({ uploadedAt: -1 })
      .select('_id uploadedAt generatedAt snapshotDigest')
      .lean()
      .exec();

    if (latest && latest.snapshotDigest === snapshotDigest) {
      const latestUploadMs = new Date(latest.uploadedAt).getTime();
      if (Number.isFinite(latestUploadMs) && nowMs - latestUploadMs < HEALTH_RETRY_DEDUP_WINDOW_MS) {
        res.status(200).json({
          id: String(latest._id),
          uploadedAt: new Date(latest.uploadedAt).toISOString(),
          generatedAt: new Date(latest.generatedAt).toISOString(),
          hasRiskAlerts: alerts.length > 0,
          alerts,
          deduplicated: true,
          dedupReason: 'retry_window',
        });
        return;
      }
    }

    const created = await HealthSnapshot.create({
      userId,
      source: snapshot.source,
      authorized: snapshot.authorized,
      syncReason,
      generatedAt: generatedAtDate,
      uploadedAt: now,
      snapshotDigest,
      payloadBytes,
      note: snapshot.note ?? '',
      activity: snapshot.activity,
      sleep: snapshot.sleep,
      heart: snapshot.heart,
      oxygen: snapshot.oxygen,
      metabolic: snapshot.metabolic,
      environment: snapshot.environment,
      body: snapshot.body,
      workouts: snapshot.workouts ?? [],
    });

    void pruneSnapshotsForUser(String(userId), nowMs).catch(error => {
      console.error('[health] prune failed:', error);
    });

    res.status(201).json({
      id: created.id,
      uploadedAt: created.uploadedAt.toISOString(),
      generatedAt: created.generatedAt.toISOString(),
      hasRiskAlerts: alerts.length > 0,
      alerts,
      deduplicated: false,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        message: 'Invalid health snapshot payload',
        errors: error.flatten(),
      });
      return;
    }

    console.error('[health] upload failed:', error);
    res.status(500).json({ message: 'Failed to save health snapshot' });
  }
}

export async function getLatestHealthSnapshot(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const latest = await HealthSnapshot.findOne({ userId: req.auth.userId })
      .sort({ uploadedAt: -1 })
      .lean()
      .exec();

    if (!latest) {
      res.status(404).json({ message: 'No health snapshot found' });
      return;
    }

    res.status(200).json({
      snapshot: {
        id: String(latest._id),
        source: latest.source,
        authorized: latest.authorized,
        syncReason: latest.syncReason ?? 'manual',
        generatedAt: new Date(latest.generatedAt).toISOString(),
        uploadedAt: new Date(latest.uploadedAt).toISOString(),
        snapshotDigest: latest.snapshotDigest ?? '',
        payloadBytes: latest.payloadBytes ?? 0,
        note: latest.note ?? '',
        activity: latest.activity,
        sleep: latest.sleep,
        heart: latest.heart,
        oxygen: latest.oxygen,
        metabolic: latest.metabolic,
        environment: latest.environment,
        body: latest.body,
        workouts: latest.workouts ?? [],
      },
    });
  } catch (error) {
    console.error('[health] get latest failed:', error);
    res.status(500).json({ message: 'Failed to load latest health snapshot' });
  }
}
