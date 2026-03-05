import { Document, Schema, Types, model } from 'mongoose';

export type HealthSleepStage =
  | 'inBed'
  | 'asleepUnspecified'
  | 'awake'
  | 'asleepCore'
  | 'asleepDeep'
  | 'asleepREM'
  | 'unknown';

export type HealthSnapshotSource = 'healthkit' | 'huawei_health' | 'mock';

export interface HealthTrendPoint {
  timestamp: Date;
  value: number;
  unit: string;
}

export interface HealthSleepSample {
  value: number;
  stage: HealthSleepStage;
  startDate: Date;
  endDate: Date;
  sourceName?: string;
  sourceBundleId?: string;
}

export interface HealthSleepStageMinutes {
  inBedMinutes?: number;
  asleepUnspecifiedMinutes?: number;
  awakeMinutes?: number;
  asleepCoreMinutes?: number;
  asleepDeepMinutes?: number;
  asleepREMMinutes?: number;
}

export type HealthSleepApneaRiskLevel = 'none' | 'watch' | 'high' | 'unknown';

export interface HealthSleepApneaData {
  eventCountLast30d?: number;
  durationMinutesLast30d?: number;
  latestEventAt?: Date;
  riskLevel?: HealthSleepApneaRiskLevel;
  reminder?: string;
}

export interface HealthWorkoutRecord {
  activityTypeCode?: number;
  activityTypeName?: string;
  startDate?: Date;
  endDate?: Date;
  durationMinutes?: number;
  totalEnergyKcal?: number;
  totalDistanceKm?: number;
  averageHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  sourceDevice?: string;
}

export interface HealthActivityData {
  stepsToday?: number;
  distanceWalkingRunningKmToday?: number;
  activeEnergyKcalToday?: number;
  basalEnergyKcalToday?: number;
  flightsClimbedToday?: number;
  exerciseMinutesToday?: number;
  standHoursToday?: number;
  stepsHourlySeriesToday?: HealthTrendPoint[];
  activeEnergyHourlySeriesToday?: HealthTrendPoint[];
  exerciseMinutesHourlySeriesToday?: HealthTrendPoint[];
}

export interface HealthSleepData {
  inBedMinutesLast36h?: number;
  asleepMinutesLast36h?: number;
  awakeMinutesLast36h?: number;
  sampleCountLast36h?: number;
  sleepScore?: number;
  stageMinutesLast36h?: HealthSleepStageMinutes;
  samplesLast36h?: HealthSleepSample[];
  apnea?: HealthSleepApneaData;
}

export interface HealthHeartData {
  latestHeartRateBpm?: number;
  restingHeartRateBpm?: number;
  walkingHeartRateAverageBpm?: number;
  heartRateVariabilityMs?: number;
  vo2MaxMlKgMin?: number;
  atrialFibrillationBurdenPercent?: number;
  systolicBloodPressureMmhg?: number;
  diastolicBloodPressureMmhg?: number;
  heartRateSeriesLast24h?: HealthTrendPoint[];
  heartRateVariabilitySeriesLast7d?: HealthTrendPoint[];
}

export interface HealthOxygenData {
  bloodOxygenPercent?: number;
  bloodOxygenSeriesLast24h?: HealthTrendPoint[];
}

export interface HealthMetabolicData {
  bloodGlucoseMgDl?: number;
  bloodGlucoseSeriesLast7d?: HealthTrendPoint[];
}

export interface HealthEnvironmentData {
  daylightMinutesToday?: number;
  daylightSeriesLast7d?: HealthTrendPoint[];
}

export interface HealthBodyData {
  respiratoryRateBrpm?: number;
  bodyTemperatureCelsius?: number;
  bodyMassKg?: number;
  respiratoryRateSeriesLast7d?: HealthTrendPoint[];
  bodyTemperatureSeriesLast7d?: HealthTrendPoint[];
  bodyMassSeriesLast30d?: HealthTrendPoint[];
}

export type HuaweiSleepStage = 'deep' | 'light' | 'rem' | 'awake' | 'nap' | 'unknown';

export interface HuaweiSleepSegment {
  stage: HuaweiSleepStage;
  startDate: Date;
  endDate: Date;
  durationMinutes?: number;
}

export interface HuaweiBloodPressurePoint {
  timestamp: Date;
  systolicMmhg: number;
  diastolicMmhg: number;
  unit?: string;
}

export interface HealthHuaweiActivityData {
  stepsToday?: number;
  distanceKmToday?: number;
  caloriesKcalToday?: number;
  floorsClimbedToday?: number;
  activeMinutesToday?: number;
  moderateToVigorousMinutesToday?: number;
  standingHoursToday?: number;
  stepsSeriesToday?: HealthTrendPoint[];
  caloriesSeriesToday?: HealthTrendPoint[];
  activeMinutesSeriesToday?: HealthTrendPoint[];
}

export interface HealthHuaweiSleepData {
  asleepMinutesLast24h?: number;
  deepSleepMinutesLast24h?: number;
  lightSleepMinutesLast24h?: number;
  remSleepMinutesLast24h?: number;
  awakeMinutesLast24h?: number;
  napMinutesLast24h?: number;
  sleepScore?: number;
  bedTime?: Date;
  wakeTime?: Date;
  sleepSegmentsLast24h?: HuaweiSleepSegment[];
}

export interface HealthHuaweiHeartData {
  latestHeartRateBpm?: number;
  restingHeartRateBpm?: number;
  maxHeartRateBpmLast24h?: number;
  minHeartRateBpmLast24h?: number;
  heartRateWarning?: string;
  heartRateSeriesLast24h?: HealthTrendPoint[];
}

export interface HealthHuaweiOxygenData {
  latestSpO2Percent?: number;
  minSpO2PercentLast24h?: number;
  spO2SeriesLast24h?: HealthTrendPoint[];
}

export interface HealthHuaweiStressData {
  latestStressScore?: number;
  averageStressScoreToday?: number;
  hrvMs?: number;
  stressSeriesLast24h?: HealthTrendPoint[];
}

export interface HealthHuaweiBodyData {
  weightKg?: number;
  bmi?: number;
  bodyFatPercent?: number;
  skeletalMuscleKg?: number;
  bodyWaterPercent?: number;
  visceralFatLevel?: number;
}

export interface HealthHuaweiBloodPressureData {
  latestSystolicMmhg?: number;
  latestDiastolicMmhg?: number;
  bloodPressureSeriesLast30d?: HuaweiBloodPressurePoint[];
}

export interface HealthHuaweiData {
  deviceModel?: string;
  appVersion?: string;
  dataWindowStart?: Date;
  dataWindowEnd?: Date;
  activity?: HealthHuaweiActivityData;
  sleep?: HealthHuaweiSleepData;
  heart?: HealthHuaweiHeartData;
  oxygen?: HealthHuaweiOxygenData;
  stress?: HealthHuaweiStressData;
  body?: HealthHuaweiBodyData;
  bloodPressure?: HealthHuaweiBloodPressureData;
  workouts?: HealthWorkoutRecord[];
}

export interface HealthSnapshotDocument extends Document {
  userId: Types.ObjectId;
  source: HealthSnapshotSource;
  authorized: boolean;
  syncReason?: 'manual' | 'auto' | 'chat';
  generatedAt: Date;
  uploadedAt: Date;
  snapshotDigest?: string;
  payloadBytes?: number;
  note?: string;
  activity?: HealthActivityData;
  sleep?: HealthSleepData;
  heart?: HealthHeartData;
  oxygen?: HealthOxygenData;
  metabolic?: HealthMetabolicData;
  environment?: HealthEnvironmentData;
  body?: HealthBodyData;
  huawei?: HealthHuaweiData;
  workouts: HealthWorkoutRecord[];
  createdAt: Date;
  updatedAt: Date;
}

const workoutSchema = new Schema<HealthWorkoutRecord>(
  {
    activityTypeCode: Number,
    activityTypeName: String,
    startDate: Date,
    endDate: Date,
    durationMinutes: Number,
    totalEnergyKcal: Number,
    totalDistanceKm: Number,
    averageHeartRateBpm: Number,
    maxHeartRateBpm: Number,
    sourceDevice: String,
  },
  { _id: false }
);

const trendPointSchema = new Schema<HealthTrendPoint>(
  {
    timestamp: Date,
    value: Number,
    unit: String,
  },
  { _id: false }
);

const sleepSampleSchema = new Schema<HealthSleepSample>(
  {
    value: Number,
    stage: {
      type: String,
      enum: ['inBed', 'asleepUnspecified', 'awake', 'asleepCore', 'asleepDeep', 'asleepREM', 'unknown'],
    },
    startDate: Date,
    endDate: Date,
    sourceName: String,
    sourceBundleId: String,
  },
  { _id: false }
);

const sleepStageMinutesSchema = new Schema<HealthSleepStageMinutes>(
  {
    inBedMinutes: Number,
    asleepUnspecifiedMinutes: Number,
    awakeMinutes: Number,
    asleepCoreMinutes: Number,
    asleepDeepMinutes: Number,
    asleepREMMinutes: Number,
  },
  { _id: false }
);

const sleepApneaSchema = new Schema<HealthSleepApneaData>(
  {
    eventCountLast30d: Number,
    durationMinutesLast30d: Number,
    latestEventAt: Date,
    riskLevel: {
      type: String,
      enum: ['none', 'watch', 'high', 'unknown'],
    },
    reminder: String,
  },
  { _id: false }
);

const huaweiSleepSegmentSchema = new Schema<HuaweiSleepSegment>(
  {
    stage: {
      type: String,
      enum: ['deep', 'light', 'rem', 'awake', 'nap', 'unknown'],
    },
    startDate: Date,
    endDate: Date,
    durationMinutes: Number,
  },
  { _id: false }
);

const huaweiBloodPressurePointSchema = new Schema<HuaweiBloodPressurePoint>(
  {
    timestamp: Date,
    systolicMmhg: Number,
    diastolicMmhg: Number,
    unit: String,
  },
  { _id: false }
);

const healthSnapshotSchema = new Schema<HealthSnapshotDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['healthkit', 'huawei_health', 'mock'],
      required: true,
    },
    authorized: {
      type: Boolean,
      required: true,
    },
    syncReason: {
      type: String,
      enum: ['manual', 'auto', 'chat'],
      default: 'manual',
    },
    generatedAt: {
      type: Date,
      required: true,
    },
    uploadedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    snapshotDigest: {
      type: String,
      trim: true,
      default: '',
    },
    payloadBytes: {
      type: Number,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    activity: {
      stepsToday: Number,
      distanceWalkingRunningKmToday: Number,
      activeEnergyKcalToday: Number,
      basalEnergyKcalToday: Number,
      flightsClimbedToday: Number,
      exerciseMinutesToday: Number,
      standHoursToday: Number,
      stepsHourlySeriesToday: {
        type: [trendPointSchema],
        default: undefined,
      },
      activeEnergyHourlySeriesToday: {
        type: [trendPointSchema],
        default: undefined,
      },
      exerciseMinutesHourlySeriesToday: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    sleep: {
      inBedMinutesLast36h: Number,
      asleepMinutesLast36h: Number,
      awakeMinutesLast36h: Number,
      sampleCountLast36h: Number,
      sleepScore: Number,
      stageMinutesLast36h: {
        type: sleepStageMinutesSchema,
        default: undefined,
      },
      samplesLast36h: {
        type: [sleepSampleSchema],
        default: undefined,
      },
      apnea: {
        type: sleepApneaSchema,
        default: undefined,
      },
    },
    heart: {
      latestHeartRateBpm: Number,
      restingHeartRateBpm: Number,
      walkingHeartRateAverageBpm: Number,
      heartRateVariabilityMs: Number,
      vo2MaxMlKgMin: Number,
      atrialFibrillationBurdenPercent: Number,
      systolicBloodPressureMmhg: Number,
      diastolicBloodPressureMmhg: Number,
      heartRateSeriesLast24h: {
        type: [trendPointSchema],
        default: undefined,
      },
      heartRateVariabilitySeriesLast7d: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    oxygen: {
      bloodOxygenPercent: Number,
      bloodOxygenSeriesLast24h: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    metabolic: {
      bloodGlucoseMgDl: Number,
      bloodGlucoseSeriesLast7d: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    environment: {
      daylightMinutesToday: Number,
      daylightSeriesLast7d: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    body: {
      respiratoryRateBrpm: Number,
      bodyTemperatureCelsius: Number,
      bodyMassKg: Number,
      respiratoryRateSeriesLast7d: {
        type: [trendPointSchema],
        default: undefined,
      },
      bodyTemperatureSeriesLast7d: {
        type: [trendPointSchema],
        default: undefined,
      },
      bodyMassSeriesLast30d: {
        type: [trendPointSchema],
        default: undefined,
      },
    },
    huawei: {
      deviceModel: String,
      appVersion: String,
      dataWindowStart: Date,
      dataWindowEnd: Date,
      activity: {
        stepsToday: Number,
        distanceKmToday: Number,
        caloriesKcalToday: Number,
        floorsClimbedToday: Number,
        activeMinutesToday: Number,
        moderateToVigorousMinutesToday: Number,
        standingHoursToday: Number,
        stepsSeriesToday: {
          type: [trendPointSchema],
          default: undefined,
        },
        caloriesSeriesToday: {
          type: [trendPointSchema],
          default: undefined,
        },
        activeMinutesSeriesToday: {
          type: [trendPointSchema],
          default: undefined,
        },
      },
      sleep: {
        asleepMinutesLast24h: Number,
        deepSleepMinutesLast24h: Number,
        lightSleepMinutesLast24h: Number,
        remSleepMinutesLast24h: Number,
        awakeMinutesLast24h: Number,
        napMinutesLast24h: Number,
        sleepScore: Number,
        bedTime: Date,
        wakeTime: Date,
        sleepSegmentsLast24h: {
          type: [huaweiSleepSegmentSchema],
          default: undefined,
        },
      },
      heart: {
        latestHeartRateBpm: Number,
        restingHeartRateBpm: Number,
        maxHeartRateBpmLast24h: Number,
        minHeartRateBpmLast24h: Number,
        heartRateWarning: String,
        heartRateSeriesLast24h: {
          type: [trendPointSchema],
          default: undefined,
        },
      },
      oxygen: {
        latestSpO2Percent: Number,
        minSpO2PercentLast24h: Number,
        spO2SeriesLast24h: {
          type: [trendPointSchema],
          default: undefined,
        },
      },
      stress: {
        latestStressScore: Number,
        averageStressScoreToday: Number,
        hrvMs: Number,
        stressSeriesLast24h: {
          type: [trendPointSchema],
          default: undefined,
        },
      },
      body: {
        weightKg: Number,
        bmi: Number,
        bodyFatPercent: Number,
        skeletalMuscleKg: Number,
        bodyWaterPercent: Number,
        visceralFatLevel: Number,
      },
      bloodPressure: {
        latestSystolicMmhg: Number,
        latestDiastolicMmhg: Number,
        bloodPressureSeriesLast30d: {
          type: [huaweiBloodPressurePointSchema],
          default: undefined,
        },
      },
      workouts: {
        type: [workoutSchema],
        default: undefined,
      },
    },
    workouts: {
      type: [workoutSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

healthSnapshotSchema.index({ userId: 1, uploadedAt: -1 });
healthSnapshotSchema.index({ userId: 1, generatedAt: -1 });
healthSnapshotSchema.index({ userId: 1, source: 1, generatedAt: -1 });
healthSnapshotSchema.index({ userId: 1, snapshotDigest: 1, uploadedAt: -1 });

export const HealthSnapshot = model<HealthSnapshotDocument>('HealthSnapshot', healthSnapshotSchema);
