import { Document, Schema, Types, model } from 'mongoose';
import { HEALTH_RISK_ALERT_CODES, type HealthRiskAlertCode } from '../services/health/healthRisk';

export interface ChatSessionCitation {
  label: string;
  sourceTitle: string;
  sectionTitle?: string;
}

export interface ChatSessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatSessionCitation[];
  createdAt: Date;
}

export interface ChatSessionDocument extends Document {
  userId: Types.ObjectId;
  sessionId: number;
  sessionType: 'manual' | 'login_health_review';
  title: string;
  summary: string;
  riskAlertCodes: HealthRiskAlertCode[];
  messages: ChatSessionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const citationSchema = new Schema<ChatSessionCitation>(
  {
    label: {
      type: String,
      trim: true,
      required: true,
    },
    sourceTitle: {
      type: String,
      trim: true,
      required: true,
    },
    sectionTitle: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    _id: false,
  }
);

const messageSchema = new Schema<ChatSessionMessage>(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    citations: {
      type: [citationSchema],
      default: undefined,
    },
    createdAt: {
      type: Date,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const chatSessionSchema = new Schema<ChatSessionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: Number,
      required: true,
      min: 1,
    },
    sessionType: {
      type: String,
      enum: ['manual', 'login_health_review'],
      default: 'manual',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: '',
    },
    summary: {
      type: String,
      trim: true,
      default: '',
    },
    riskAlertCodes: {
      type: [
        {
          type: String,
          enum: HEALTH_RISK_ALERT_CODES,
        },
      ],
      default: [],
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

chatSessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
chatSessionSchema.index({ userId: 1, updatedAt: -1 });

export const ChatSession = model<ChatSessionDocument>('ChatSession', chatSessionSchema);
