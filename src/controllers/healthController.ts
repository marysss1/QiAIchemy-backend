import { Request, Response } from 'express';
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
  })
  .passthrough();

type HealthUploadPayload = z.infer<typeof healthKitAllDataSchema>;

function getSnapshotPayload(body: unknown): HealthUploadPayload {
  const wrappedParsed = healthUploadBodySchema.safeParse(body);
  if (wrappedParsed.success) {
    return wrappedParsed.data.snapshot;
  }
  return healthKitAllDataSchema.parse(body);
}

export async function uploadHealthSnapshot(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const snapshot = getSnapshotPayload(req.body);
    const generatedAtDate = new Date(snapshot.generatedAt);

    if (Number.isNaN(generatedAtDate.getTime())) {
      res.status(400).json({ message: 'Invalid generatedAt datetime' });
      return;
    }

    const created = await HealthSnapshot.create({
      userId: req.auth.userId,
      source: snapshot.source,
      authorized: snapshot.authorized,
      generatedAt: generatedAtDate,
      uploadedAt: new Date(),
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

    res.status(201).json({
      id: created.id,
      uploadedAt: created.uploadedAt.toISOString(),
      generatedAt: created.generatedAt.toISOString(),
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
