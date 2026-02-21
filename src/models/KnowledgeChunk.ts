import { Document, Schema, model } from 'mongoose';

export interface KnowledgeChunkDocument extends Document {
  sourceId: string;
  sourceTitle: string;
  sourcePath?: string;
  sectionTitle?: string;
  chunkIndex: number;
  text: string;
  charCount: number;
  embedding: number[];
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeChunkSchema = new Schema<KnowledgeChunkDocument>(
  {
    sourceId: {
      type: String,
      required: true,
      trim: true,
    },
    sourceTitle: {
      type: String,
      required: true,
      trim: true,
    },
    sourcePath: {
      type: String,
      trim: true,
      default: '',
    },
    sectionTitle: {
      type: String,
      trim: true,
      default: '',
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    charCount: {
      type: Number,
      required: true,
      min: 1,
    },
    embedding: {
      type: [Number],
      default: [],
    },
    keywords: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

knowledgeChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
knowledgeChunkSchema.index({ sourceTitle: 'text', sectionTitle: 'text', text: 'text' });
knowledgeChunkSchema.index({ keywords: 1 });

export const KnowledgeChunk = model<KnowledgeChunkDocument>('KnowledgeChunk', knowledgeChunkSchema);
