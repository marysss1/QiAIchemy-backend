import { Document, Schema, model } from 'mongoose';

export type YouthWellnessArticleBlock =
  | {
      kind: 'paragraph';
      text: string;
    }
  | {
      kind: 'image';
      imageUrl: string;
      caption?: string;
    };

export interface YouthWellnessArticleDocument extends Document {
  slug: string;
  title: string;
  summary: string;
  author?: string;
  sourceName: string;
  sourceSection: string;
  sourceDomain: string;
  sourceUrl: string;
  publishedAt?: Date;
  coverImageUrl?: string;
  contentBlocks: YouthWellnessArticleBlock[];
  tags: string[];
  fetchedAt: Date;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const articleBlockSchema = new Schema<YouthWellnessArticleBlock>(
  {
    kind: {
      type: String,
      enum: ['paragraph', 'image'],
      required: true,
    },
    text: {
      type: String,
      trim: true,
      default: undefined,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: undefined,
    },
    caption: {
      type: String,
      trim: true,
      default: undefined,
    },
  },
  {
    _id: false,
  }
);

const youthWellnessArticleSchema = new Schema<YouthWellnessArticleDocument>(
  {
    slug: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      required: true,
    },
    summary: {
      type: String,
      trim: true,
      required: true,
    },
    author: {
      type: String,
      trim: true,
      default: '',
    },
    sourceName: {
      type: String,
      trim: true,
      required: true,
    },
    sourceSection: {
      type: String,
      trim: true,
      required: true,
    },
    sourceDomain: {
      type: String,
      trim: true,
      required: true,
    },
    sourceUrl: {
      type: String,
      trim: true,
      required: true,
      unique: true,
    },
    publishedAt: {
      type: Date,
      default: undefined,
    },
    coverImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    contentBlocks: {
      type: [articleBlockSchema],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    fetchedAt: {
      type: Date,
      required: true,
    },
    syncedAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

youthWellnessArticleSchema.index({ publishedAt: -1, updatedAt: -1 });

export const YouthWellnessArticle = model<YouthWellnessArticleDocument>(
  'YouthWellnessArticle',
  youthWellnessArticleSchema
);
