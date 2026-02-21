import { Document, Schema, Types, model } from 'mongoose';

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
}

export interface HealthSleepData {
  inBedMinutesLast36h?: number;
  asleepMinutesLast36h?: number;
  awakeMinutesLast36h?: number;
  sampleCountLast36h?: number;
  sleepScore?: number;
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
}

export interface HealthOxygenData {
  bloodOxygenPercent?: number;
}

export interface HealthMetabolicData {
  bloodGlucoseMgDl?: number;
}

export interface HealthEnvironmentData {
  daylightMinutesToday?: number;
}

export interface HealthBodyData {
  respiratoryRateBrpm?: number;
  bodyTemperatureCelsius?: number;
  bodyMassKg?: number;
}

export interface HealthSnapshotDocument extends Document {
  userId: Types.ObjectId;
  source: 'healthkit' | 'mock';
  authorized: boolean;
  generatedAt: Date;
  uploadedAt: Date;
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
    generatedAt: {
      type: Date,
      required: true,
    },
    uploadedAt: {
      type: Date,
      required: true,
      default: Date.now,
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
    },
    sleep: {
      inBedMinutesLast36h: Number,
      asleepMinutesLast36h: Number,
      awakeMinutesLast36h: Number,
      sampleCountLast36h: Number,
      sleepScore: Number,
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
    },
    oxygen: {
      bloodOxygenPercent: Number,
    },
    metabolic: {
      bloodGlucoseMgDl: Number,
    },
    environment: {
      daylightMinutesToday: Number,
    },
    body: {
      respiratoryRateBrpm: Number,
      bodyTemperatureCelsius: Number,
      bodyMassKg: Number,
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

export const HealthSnapshot = model<HealthSnapshotDocument>('HealthSnapshot', healthSnapshotSchema);
