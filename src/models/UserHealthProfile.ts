import { Document, Schema, Types, model } from 'mongoose';
import {
  HEALTH_RISK_ALERT_CODES,
  HEALTH_RISK_ALERT_SEVERITIES,
  type UserHealthSignal,
} from '../services/health/healthRisk';

export interface UserHealthProfileDocument extends Document {
  userId: Types.ObjectId;
  lastSnapshotId?: Types.ObjectId;
  lastSnapshotGeneratedAt?: Date;
  lastSnapshotSource?: string;
  llmHealthOverview?: string;
  latestSignals: UserHealthSignal[];
  trackedSignals: UserHealthSignal[];
  createdAt: Date;
  updatedAt: Date;
}

const healthSignalSchema = new Schema<UserHealthSignal>(
  {
    code: {
      type: String,
      enum: HEALTH_RISK_ALERT_CODES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      enum: HEALTH_RISK_ALERT_SEVERITIES,
      required: true,
    },
    firstDetectedAt: {
      type: Date,
      required: true,
    },
    lastDetectedAt: {
      type: Date,
      required: true,
    },
    occurrenceCount: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    latestValue: Number,
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    latestMessage: {
      type: String,
      trim: true,
      default: '',
    },
    latestRecommendation: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    _id: false,
  }
);

const userHealthProfileSchema = new Schema<UserHealthProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    lastSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'HealthSnapshot',
      default: undefined,
    },
    lastSnapshotGeneratedAt: {
      type: Date,
      default: undefined,
    },
    lastSnapshotSource: {
      type: String,
      trim: true,
      default: '',
    },
    llmHealthOverview: {
      type: String,
      trim: true,
      default: '',
    },
    latestSignals: {
      type: [healthSignalSchema],
      default: [],
    },
    trackedSignals: {
      type: [healthSignalSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const UserHealthProfile = model<UserHealthProfileDocument>('UserHealthProfile', userHealthProfileSchema);
