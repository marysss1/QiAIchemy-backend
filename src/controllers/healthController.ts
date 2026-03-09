import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ZodError, z } from 'zod';
import { HealthSnapshot } from '../models/HealthSnapshot';
import { User } from '../models/User';
import { UserHealthProfile } from '../models/UserHealthProfile';
import {
  detectHealthRiskAlerts,
  mergeTrackedHealthSignals,
  type HealthRiskAlert,
} from '../services/health/healthRisk';
import { summarizeHealthProfileOverview } from '../services/agent/healthProfileOverviewSummarizer';

const optionalNumber = z.number().finite().optional();
const optionalDateTime = z.string().datetime({ offset: true }).optional();
const healthSourceInputSchema = z.enum(['healthkit', 'huawei_health', 'huawei', 'mock']);

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
    averageHeartRateBpm: optionalNumber,
    maxHeartRateBpm: optionalNumber,
    sourceDevice: z.string().trim().max(100).optional(),
  })
  .passthrough();

const healthActivityDataSchema = z
  .object({
    stepsToday: optionalNumber,
    distanceWalkingRunningKmToday: optionalNumber,
    activeEnergyKcalToday: optionalNumber,
    activeEnergyGoalKcal: optionalNumber,
    basalEnergyKcalToday: optionalNumber,
    flightsClimbedToday: optionalNumber,
    exerciseMinutesToday: optionalNumber,
    exerciseGoalMinutes: optionalNumber,
    standHoursToday: optionalNumber,
    standGoalHours: optionalNumber,
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
    sleepScoreSource: z.enum(['today', 'latestAvailable']).optional(),
    sleepScoreWindowStart: optionalDateTime,
    sleepScoreWindowEnd: optionalDateTime,
    sleepScoreFallbackUsed: z.boolean().optional(),
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
    restingHeartRateSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
    heartRateVariabilitySeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
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
    bloodGlucoseSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
    bloodGlucoseSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthEnvironmentDataSchema = z
  .object({
    daylightMinutesToday: optionalNumber,
    daylightSeriesLast7d: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const healthProfileDataSchema = z
  .object({
    age: optionalNumber,
    heightCm: optionalNumber,
    weightKg: optionalNumber,
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

const huaweiSleepSegmentSchema = z
  .object({
    stage: z.enum(['deep', 'light', 'rem', 'awake', 'nap', 'unknown']),
    startDate: z.string().datetime({ offset: true }),
    endDate: z.string().datetime({ offset: true }),
    durationMinutes: optionalNumber,
  })
  .passthrough();

const huaweiBloodPressurePointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    systolicMmhg: z.number().finite(),
    diastolicMmhg: z.number().finite(),
    unit: z.string().trim().max(24).optional(),
  })
  .passthrough();

const huaweiActivityDataSchema = z
  .object({
    stepsToday: optionalNumber,
    distanceKmToday: optionalNumber,
    caloriesKcalToday: optionalNumber,
    floorsClimbedToday: optionalNumber,
    activeMinutesToday: optionalNumber,
    moderateToVigorousMinutesToday: optionalNumber,
    standingHoursToday: optionalNumber,
    stepsSeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
    caloriesSeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
    activeMinutesSeriesToday: z.array(healthTrendPointSchema).max(300).optional(),
  })
  .passthrough();

const huaweiSleepDataSchema = z
  .object({
    asleepMinutesLast24h: optionalNumber,
    deepSleepMinutesLast24h: optionalNumber,
    lightSleepMinutesLast24h: optionalNumber,
    remSleepMinutesLast24h: optionalNumber,
    awakeMinutesLast24h: optionalNumber,
    napMinutesLast24h: optionalNumber,
    sleepScore: optionalNumber,
    bedTime: optionalDateTime,
    wakeTime: optionalDateTime,
    sleepSegmentsLast24h: z.array(huaweiSleepSegmentSchema).max(1000).optional(),
  })
  .passthrough();

const huaweiHeartDataSchema = z
  .object({
    latestHeartRateBpm: optionalNumber,
    restingHeartRateBpm: optionalNumber,
    maxHeartRateBpmLast24h: optionalNumber,
    minHeartRateBpmLast24h: optionalNumber,
    heartRateWarning: z.string().trim().max(100).optional(),
    heartRateSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const huaweiOxygenDataSchema = z
  .object({
    latestSpO2Percent: optionalNumber,
    minSpO2PercentLast24h: optionalNumber,
    spO2SeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const huaweiStressDataSchema = z
  .object({
    latestStressScore: optionalNumber,
    averageStressScoreToday: optionalNumber,
    hrvMs: optionalNumber,
    stressSeriesLast24h: z.array(healthTrendPointSchema).max(500).optional(),
  })
  .passthrough();

const huaweiBodyDataSchema = z
  .object({
    weightKg: optionalNumber,
    bmi: optionalNumber,
    bodyFatPercent: optionalNumber,
    skeletalMuscleKg: optionalNumber,
    bodyWaterPercent: optionalNumber,
    visceralFatLevel: optionalNumber,
  })
  .passthrough();

const huaweiBloodPressureDataSchema = z
  .object({
    latestSystolicMmhg: optionalNumber,
    latestDiastolicMmhg: optionalNumber,
    bloodPressureSeriesLast30d: z.array(huaweiBloodPressurePointSchema).max(1500).optional(),
  })
  .passthrough();

const huaweiAllDataSchema = z
  .object({
    deviceModel: z.string().trim().max(100).optional(),
    appVersion: z.string().trim().max(50).optional(),
    dataWindowStart: optionalDateTime,
    dataWindowEnd: optionalDateTime,
    activity: huaweiActivityDataSchema.optional(),
    sleep: huaweiSleepDataSchema.optional(),
    heart: huaweiHeartDataSchema.optional(),
    oxygen: huaweiOxygenDataSchema.optional(),
    stress: huaweiStressDataSchema.optional(),
    body: huaweiBodyDataSchema.optional(),
    bloodPressure: huaweiBloodPressureDataSchema.optional(),
    workouts: z.array(healthWorkoutRecordSchema).max(500).optional(),
  })
  .passthrough();

const healthSnapshotDataSchema = z
  .object({
    source: healthSourceInputSchema,
    authorized: z.boolean(),
    generatedAt: z.string().datetime({ offset: true }),
    note: z.string().max(1000).optional(),
    activity: healthActivityDataSchema.optional(),
    sleep: healthSleepDataSchema.optional(),
    heart: healthHeartDataSchema.optional(),
    oxygen: healthOxygenDataSchema.optional(),
    metabolic: healthMetabolicDataSchema.optional(),
    environment: healthEnvironmentDataSchema.optional(),
    profile: healthProfileDataSchema.optional(),
    body: healthBodyDataSchema.optional(),
    huawei: huaweiAllDataSchema.optional(),
    workouts: z.array(healthWorkoutRecordSchema).optional(),
  })
  .passthrough();

const healthUploadBodySchema = z
  .object({
    snapshot: healthSnapshotDataSchema,
    syncReason: z.enum(['manual', 'auto', 'chat']).optional(),
  })
  .passthrough();

type HealthUploadPayload = {
  source: 'healthkit' | 'huawei_health' | 'mock';
  authorized: boolean;
  generatedAt: string;
  note?: string;
  activity?: z.infer<typeof healthActivityDataSchema>;
  sleep?: z.infer<typeof healthSleepDataSchema>;
  heart?: z.infer<typeof healthHeartDataSchema>;
  oxygen?: z.infer<typeof healthOxygenDataSchema>;
  metabolic?: z.infer<typeof healthMetabolicDataSchema>;
  environment?: z.infer<typeof healthEnvironmentDataSchema>;
  profile?: z.infer<typeof healthProfileDataSchema>;
  body?: z.infer<typeof healthBodyDataSchema>;
  huawei?: z.infer<typeof huaweiAllDataSchema>;
  workouts?: Array<z.infer<typeof healthWorkoutRecordSchema>>;
};
type HealthUploadPayloadRaw = {
  source: 'healthkit' | 'huawei_health' | 'huawei' | 'mock';
  authorized: boolean;
  generatedAt: string;
  note?: string;
  activity?: z.infer<typeof healthActivityDataSchema>;
  sleep?: z.infer<typeof healthSleepDataSchema>;
  heart?: z.infer<typeof healthHeartDataSchema>;
  oxygen?: z.infer<typeof healthOxygenDataSchema>;
  metabolic?: z.infer<typeof healthMetabolicDataSchema>;
  environment?: z.infer<typeof healthEnvironmentDataSchema>;
  profile?: z.infer<typeof healthProfileDataSchema>;
  body?: z.infer<typeof healthBodyDataSchema>;
  huawei?: z.infer<typeof huaweiAllDataSchema>;
  workouts?: Array<z.infer<typeof healthWorkoutRecordSchema>>;
};
type HealthSyncReason = 'manual' | 'auto' | 'chat';

const HEALTH_RETRY_DEDUP_WINDOW_MS = 2 * 60 * 1000;
const HEALTH_SNAPSHOT_KEEP_MAX = 4320;
const HEALTH_SNAPSHOT_PRUNE_COOLDOWN_MS = 30 * 60 * 1000;
const pruneStampByUser = new Map<string, number>();

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

function normalizeHealthSource(source: HealthUploadPayloadRaw['source']): HealthUploadPayload['source'] {
  if (source === 'huawei') {
    return 'huawei_health';
  }
  return source;
}

function sanitizeProfileNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < min || value > max) {
    return undefined;
  }
  return value;
}

function shouldUpdateNumericField(previousValue: number | undefined, nextValue: number | undefined): boolean {
  if (nextValue === undefined) {
    return false;
  }
  if (previousValue === undefined) {
    return true;
  }
  return Math.abs(previousValue - nextValue) >= 0.1;
}

function toSafeUser(user: {
  id?: string;
  _id?: unknown;
  username?: string;
  name?: string;
  email?: string;
  age?: number;
  gender?: string;
  heightCm?: number;
  weightKg?: number;
  experimentConsent?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): Record<string, unknown> {
  return {
    id: user.id ?? String(user._id ?? ''),
    username: user.username,
    name: user.name,
    email: user.email ?? '',
    age: user.age,
    gender: user.gender,
    heightCm: user.heightCm,
    weightKg: user.weightKg,
    experimentConsent: user.experimentConsent,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function syncUserRegistrationFromHealthSnapshot(args: {
  userId: string;
  user: {
    id?: string;
    _id?: unknown;
    username?: string;
    name?: string;
    email?: string;
    age?: number;
    gender?: string;
    heightCm?: number;
    weightKg?: number;
    experimentConsent?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  } | null;
  snapshot: HealthUploadPayload;
}): Promise<
  | {
      id?: string;
      _id?: unknown;
      username?: string;
      name?: string;
      email?: string;
      age?: number;
      gender?: string;
      heightCm?: number;
      weightKg?: number;
      experimentConsent?: boolean;
      createdAt?: Date;
      updatedAt?: Date;
    }
  | null
> {
  if (!args.user) {
    return null;
  }
  if (args.snapshot.source !== 'healthkit') {
    return args.user;
  }

  const nextAge = sanitizeProfileNumber(args.snapshot.profile?.age, 1, 120);
  const nextHeightCm = sanitizeProfileNumber(args.snapshot.profile?.heightCm, 50, 250);
  const nextWeightKg =
    sanitizeProfileNumber(args.snapshot.profile?.weightKg, 20, 300) ??
    sanitizeProfileNumber(args.snapshot.body?.bodyMassKg, 20, 300);

  const updates: Record<string, number> = {};
  if (shouldUpdateNumericField(args.user.age, nextAge)) {
    updates.age = Math.round(nextAge as number);
  }
  if (shouldUpdateNumericField(args.user.heightCm, nextHeightCm)) {
    updates.heightCm = Number((nextHeightCm as number).toFixed(1));
  }
  if (shouldUpdateNumericField(args.user.weightKg, nextWeightKg)) {
    updates.weightKg = Number((nextWeightKg as number).toFixed(1));
  }

  if (Object.keys(updates).length === 0) {
    return args.user;
  }

  return User.findByIdAndUpdate(args.userId, { $set: updates }, { new: true })
    .select('username name email age gender heightCm weightKg experimentConsent createdAt updatedAt')
    .lean()
    .exec();
}

async function syncUserHealthProfile(args: {
  userId: string;
  snapshotId: string;
  source: string;
  generatedAt: Date;
  alerts: HealthRiskAlert[];
  userProfile?: {
    age?: number;
    gender?: string;
    heightCm?: number;
    weightKg?: number;
  } | null;
}): Promise<void> {
  const existing = await UserHealthProfile.findOne({ userId: args.userId }).exec();
  const latestSignals = args.alerts.map(alert => {
    const alertDate = new Date(alert.triggeredAt);
    const detectedAt = Number.isNaN(alertDate.getTime()) ? args.generatedAt : alertDate;
    return {
      code: alert.code,
      title: alert.title,
      severity: alert.severity,
      firstDetectedAt: detectedAt,
      lastDetectedAt: detectedAt,
      occurrenceCount: 1,
      latestValue: alert.value,
      unit: alert.unit ?? '',
      latestMessage: alert.message,
      latestRecommendation: alert.recommendation,
    };
  });
  const trackedSignals = mergeTrackedHealthSignals(existing?.trackedSignals ?? [], args.alerts, args.generatedAt);
  const llmHealthOverview = await summarizeHealthProfileOverview({
    age: args.userProfile?.age,
    gender: args.userProfile?.gender,
    heightCm: args.userProfile?.heightCm,
    weightKg: args.userProfile?.weightKg,
    latestSignals: latestSignals.map(signal => ({
      title: signal.title,
      severity: signal.severity,
      occurrenceCount: signal.occurrenceCount,
      latestMessage: signal.latestMessage,
    })),
    trackedSignals: trackedSignals.map(signal => ({
      title: signal.title,
      severity: signal.severity,
      occurrenceCount: signal.occurrenceCount,
      latestMessage: signal.latestMessage,
    })),
  });

  await UserHealthProfile.findOneAndUpdate(
    { userId: args.userId },
    {
      $set: {
        lastSnapshotId: args.snapshotId,
        lastSnapshotGeneratedAt: args.generatedAt,
        lastSnapshotSource: args.source,
        llmHealthOverview,
        latestSignals,
        trackedSignals,
      },
      $setOnInsert: {
        userId: args.userId,
      },
    },
    {
      upsert: true,
      new: true,
    }
  ).exec();
}

async function syncUserHealthProfileSafely(args: {
  userId: string;
  snapshotId: string;
  source: string;
  generatedAt: Date;
  alerts: HealthRiskAlert[];
  userProfile?: {
    age?: number;
    gender?: string;
    heightCm?: number;
    weightKg?: number;
  } | null;
}): Promise<void> {
  try {
    await syncUserHealthProfile(args);
  } catch (error) {
    console.error('[health] syncUserHealthProfile failed:', error);
  }
}

function getSnapshotPayload(body: unknown): { snapshot: HealthUploadPayload; syncReason: HealthSyncReason } {
  const normalizeSnapshot = (raw: HealthUploadPayloadRaw): HealthUploadPayload => ({
    ...raw,
    source: normalizeHealthSource(raw.source),
  });

  const wrappedParsed = healthUploadBodySchema.safeParse(body);
  if (wrappedParsed.success) {
    return {
      snapshot: normalizeSnapshot(wrappedParsed.data.snapshot),
      syncReason: wrappedParsed.data.syncReason ?? 'manual',
    };
  }
  return {
    snapshot: normalizeSnapshot(healthSnapshotDataSchema.parse(body)),
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
    const user = await User.findById(userId)
      .select('username name email age gender heightCm weightKg experimentConsent createdAt updatedAt')
      .lean()
      .exec();
    const syncedUser = await syncUserRegistrationFromHealthSnapshot({
      userId,
      user,
      snapshot,
    });
    const effectiveUser = syncedUser ?? user;
    const alerts = detectHealthRiskAlerts({
      ...snapshot,
      profile: {
        age: snapshot.profile?.age ?? effectiveUser?.age,
        heightCm: snapshot.profile?.heightCm ?? effectiveUser?.heightCm,
        weightKg:
          snapshot.profile?.weightKg ??
          snapshot.body?.bodyMassKg ??
          effectiveUser?.weightKg,
      },
    });

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
        alerts,
        note: snapshot.note ?? '',
        profile: snapshot.profile,
        activity: snapshot.activity,
        sleep: snapshot.sleep,
        heart: snapshot.heart,
        oxygen: snapshot.oxygen,
        metabolic: snapshot.metabolic,
        environment: snapshot.environment,
        body: snapshot.body,
        huawei: snapshot.huawei,
        workouts: snapshot.workouts ?? [],
      });
      await existingSameSample.save();
      await syncUserHealthProfileSafely({
        userId,
        snapshotId: existingSameSample.id,
        source: snapshot.source,
        generatedAt: generatedAtDate,
        alerts,
        userProfile: effectiveUser,
      });

      void pruneSnapshotsForUser(String(userId), nowMs).catch(error => {
        console.error('[health] prune failed:', error);
      });

      res.status(200).json({
        id: existingSameSample.id,
        uploadedAt: existingSameSample.uploadedAt.toISOString(),
        generatedAt: existingSameSample.generatedAt.toISOString(),
        hasRiskAlerts: alerts.length > 0,
        alerts,
        user: effectiveUser ? toSafeUser(effectiveUser) : undefined,
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
        await syncUserHealthProfileSafely({
          userId,
          snapshotId: String(latest._id),
          source: snapshot.source,
          generatedAt: generatedAtDate,
          alerts,
          userProfile: effectiveUser,
        });
        res.status(200).json({
          id: String(latest._id),
          uploadedAt: new Date(latest.uploadedAt).toISOString(),
          generatedAt: new Date(latest.generatedAt).toISOString(),
          hasRiskAlerts: alerts.length > 0,
          alerts,
          user: effectiveUser ? toSafeUser(effectiveUser) : undefined,
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
      alerts,
      note: snapshot.note ?? '',
      profile: snapshot.profile,
      activity: snapshot.activity,
      sleep: snapshot.sleep,
      heart: snapshot.heart,
      oxygen: snapshot.oxygen,
      metabolic: snapshot.metabolic,
      environment: snapshot.environment,
      body: snapshot.body,
      huawei: snapshot.huawei,
      workouts: snapshot.workouts ?? [],
    });
    await syncUserHealthProfileSafely({
      userId,
      snapshotId: created.id,
      source: snapshot.source,
      generatedAt: generatedAtDate,
      alerts,
      userProfile: effectiveUser,
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
      user: effectiveUser ? toSafeUser(effectiveUser) : undefined,
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
        alerts: latest.alerts ?? [],
        note: latest.note ?? '',
        activity: latest.activity,
        sleep: latest.sleep,
        heart: latest.heart,
        oxygen: latest.oxygen,
        metabolic: latest.metabolic,
        environment: latest.environment,
        body: latest.body,
        huawei: latest.huawei,
        workouts: latest.workouts ?? [],
      },
    });
  } catch (error) {
    console.error('[health] get latest failed:', error);
    res.status(500).json({ message: 'Failed to load latest health snapshot' });
  }
}

export async function getHealthProfile(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const profile = await UserHealthProfile.findOne({ userId: req.auth.userId }).lean().exec();

    if (!profile) {
      res.status(200).json({
        profile: {
          latestSignals: [],
          trackedSignals: [],
          lastSnapshotGeneratedAt: null,
          lastSnapshotSource: '',
          llmHealthOverview: '',
        },
      });
      return;
    }

    res.status(200).json({
      profile: {
        latestSignals: (profile.latestSignals ?? []).map(signal => ({
          code: signal.code,
          title: signal.title,
          severity: signal.severity,
          firstDetectedAt: signal.firstDetectedAt.toISOString(),
          lastDetectedAt: signal.lastDetectedAt.toISOString(),
          occurrenceCount: signal.occurrenceCount,
          latestValue: signal.latestValue,
          unit: signal.unit ?? '',
          latestMessage: signal.latestMessage,
          latestRecommendation: signal.latestRecommendation,
        })),
        trackedSignals: (profile.trackedSignals ?? []).map(signal => ({
          code: signal.code,
          title: signal.title,
          severity: signal.severity,
          firstDetectedAt: signal.firstDetectedAt.toISOString(),
          lastDetectedAt: signal.lastDetectedAt.toISOString(),
          occurrenceCount: signal.occurrenceCount,
          latestValue: signal.latestValue,
          unit: signal.unit ?? '',
          latestMessage: signal.latestMessage,
          latestRecommendation: signal.latestRecommendation,
        })),
        lastSnapshotGeneratedAt: profile.lastSnapshotGeneratedAt
          ? profile.lastSnapshotGeneratedAt.toISOString()
          : null,
        lastSnapshotSource: profile.lastSnapshotSource ?? '',
        llmHealthOverview: profile.llmHealthOverview ?? '',
      },
    });
  } catch (error) {
    console.error('[health] get profile failed:', error);
    res.status(500).json({ message: 'Failed to load health profile' });
  }
}
