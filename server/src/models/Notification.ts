import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  workspaceId: string;
  type: 'content_ready' | 'content_failed' | 'info' | 'warning';
  title: string;
  message: string;
  projectId?: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true },
    type: { type: String, enum: ['content_ready', 'content_failed', 'info', 'warning'], default: 'info' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    projectId: { type: String },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
