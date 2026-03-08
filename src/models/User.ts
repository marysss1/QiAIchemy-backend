import { Document, Schema, model } from 'mongoose';

export const USER_GENDERS = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const;
export type UserGender = (typeof USER_GENDERS)[number];

export interface UserDocument extends Document {
  username?: string;
  email: string;
  name?: string;
  age?: number;
  gender?: UserGender;
  heightCm?: number;
  weightKg?: number;
  experimentConsent: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    username: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 24,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    age: {
      type: Number,
      min: 1,
      max: 120,
      default: undefined,
    },
    gender: {
      type: String,
      enum: USER_GENDERS,
      default: undefined,
    },
    heightCm: {
      type: Number,
      min: 50,
      max: 250,
      default: undefined,
    },
    weightKg: {
      type: Number,
      min: 20,
      max: 300,
      default: undefined,
    },
    experimentConsent: {
      type: Boolean,
      required: true,
      default: false,
    },
    passwordHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ username: 1 }, { unique: true, sparse: true });

export const User = model<UserDocument>('User', userSchema);
