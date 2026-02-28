import { Document, Schema, Types, model } from 'mongoose';

export type HealthSleepStage =
  | 'inBed'
  | 'asleepUnspecified'
  | 'awake'
  | 'asleepCore'
  | 'asleepDeep'
  | 'asleepREM'
  | 'unknown';

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

export interface HealthSnapshotDocument extends Document {
  userId: Types.ObjectId;
  source: 'healthkit' | 'mock';
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
      enum: ['healthkit', 'mock'],
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
