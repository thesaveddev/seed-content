import mongoose, { Schema } from 'mongoose';
import { isUsingInMemory, getCollection } from '../config/database';

// Wrap every model method to dispatch at call time (not import time)
function wrapMethods(collName: string, schema: any) {
  function inMemory() {
    const coll = getCollection(collName);
    return {
      find: (q: any = {}) => {
        const chain: any = {
          _q: q, _sort: null, _skip: 0, _lim: 0,
          sort(s: any) { this._sort = s; return this; },
          skip(n: number) { this._skip = n; return this; },
          limit(n: number) { this._lim = n; return this; },
          lean() { return this; },
          select(_s: string) { return this; },
          populate(_s: any) { return this; },
          async then(resolve: any, reject: any) {
            try {
              let results = await coll.find(this._q);
              if (this._sort) {
                const key = Object.keys(this._sort)[0];
                const dir = this._sort[key];
                results.sort((a: any, b: any) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0));
              }
              if (this._skip) results = results.slice(this._skip);
              if (this._lim) results = results.slice(0, this._lim);
              resolve(results);
            } catch (err) {
              reject(err);
            }
          },
        };
        return chain;
      },
      findOne: (q: any, _o?: any) => {
        const chain: any = {
          _q: q, _selectFields: null,
          select(s: string) { this._selectFields = s; return this; },
          populate(_s: any) { return this; },
          lean() { return this; },
          async then(resolve: any, reject: any) {
            try {
              const doc = await coll.findOne(this._q);
              resolve(doc);
            } catch (err) {
              reject(err);
            }
          },
        };
        return chain;
      },
      findById: (id: any) => {
        const chain: any = {
          _q: { _id: id }, _selectFields: null,
          select(s: string) { this._selectFields = s; return this; },
          populate(_s: any) { return this; },
          lean() { return this; },
          async then(resolve: any, reject: any) {
            try {
              const doc = await coll.findOne(this._q);
              resolve(doc);
            } catch (err) {
              reject(err);
            }
          },
        };
        return chain;
      },
      findOneAndUpdate: (q: any, u: any, o?: any) => {
        const chain: any = {
          _q: q, _u: u, _o: o || {},
          select(_s: string) { return this; },
          populate(_s: any) { return this; },
          lean() { return this; },
          async then(resolve: any, reject: any) { try { resolve(await coll.findOneAndUpdate(this._q, this._u, this._o)); } catch (e) { reject(e); } },
        };
        return chain;
      },
      findByIdAndUpdate: (id: any, u: any, o?: any) => {
        const chain: any = {
          _q: { _id: id }, _u: u, _o: o || {},
          select(_s: string) { return this; },
          populate(_s: any) { return this; },
          lean() { return this; },
          async then(resolve: any, reject: any) { try { resolve(await coll.findOneAndUpdate(this._q, this._u, this._o)); } catch (e) { reject(e); } },
        };
        return chain;
      },
      findOneAndDelete: (q: any) => {
        const chain: any = {
          _q: q,
          select(_s: string) { return this; },
          populate(_s: any) { return this; },
          async then(resolve: any, reject: any) { try { resolve(await coll.findOneAndDelete(this._q)); } catch (e) { reject(e); } },
        };
        return chain;
      },
      create: (d: any) => coll.create(d),
      deleteMany: (q: any) => coll.deleteMany(q),
      updateMany: (q: any, u: any) => coll.updateMany(q, u),
      countDocuments: (q?: any) => coll.countDocuments(q || {}),
      aggregate: (p: any[]) => coll.aggregate(p),
    };
  }

  let mongooseModel: any = null;
  function realModel() {
    if (!mongooseModel) {
      // Reuse an already-compiled model (module re-imports in tests / hot reload)
      mongooseModel = (mongoose as any).models[collName] || mongoose.model(collName, schema);
    }
    return mongooseModel;
  }

  // Return an object whose methods dispatch at call-time
  const mem = () => inMemory();
  const rm = () => realModel();
  const pick = () => isUsingInMemory() ? mem() : rm();
  return {
    find: (...a: any[]) => pick().find(...a),
    findOne: (...a: any[]) => pick().findOne(...a),
    findById: (...a: any[]) => pick().findById(...a),
    findOneAndUpdate: (...a: any[]) => pick().findOneAndUpdate(...a),
    findByIdAndUpdate: (...a: any[]) => pick().findByIdAndUpdate(...a),
    findOneAndDelete: (...a: any[]) => pick().findOneAndDelete(...a),
    // Common aliases: findByIdAndDelete(id) and deleteOne(query)
    findByIdAndDelete: async (...a: any[]) => {
      const id = a[0];
      const q = typeof id === 'object' && id !== null ? id : { _id: id };
      return pick().findOneAndDelete(q);
    },
    deleteOne: async (...a: any[]) => {
      const r = await pick().findOneAndDelete(a[0]);
      return { deletedCount: r ? 1 : 0, acknowledged: true };
    },
    create: (...a: any[]) => pick().create(...a),
    deleteMany: (...a: any[]) => pick().deleteMany(...a),
    updateMany: (...a: any[]) => pick().updateMany(...a),
    countDocuments: (...a: any[]) => pick().countDocuments(...a),
    aggregate: (...a: any[]) => pick().aggregate(...a),
  } as any;
}

// ===== Schemas =====

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true },
  avatar: String,
  onboardingCompleted: { type: Boolean, default: false },
  onboardingData: { role: String, platforms: [String], audience: String, topics: String, tones: [String], brandDescription: String },
  openaiApiKey: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  // Platform administration
  isAdmin: { type: Boolean, default: false, select: false },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
}, { timestamps: true });

const workspaceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['free', 'creator', 'pro', 'agency'], default: 'free' },
  stripeCustomerId: { type: String, select: false },
  stripeSubscriptionId: { type: String, select: false },
  stripePriceId: { type: String, select: false },
  currentPeriodEnd: { type: Date },
  cancelAtPeriodEnd: { type: Boolean, default: false },
}, { timestamps: true });

const workspaceMemberSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member', 'viewer'], default: 'member' },
}, { timestamps: true });

const brandVoiceSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  samples: [{ type: String }],
  tone: [{ type: String }],
  audience: { type: String, default: '' },
  avoidWords: [{ type: String }],
  preferredWords: [{ type: String }],
}, { timestamps: true });

const contentProjectSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'Untitled Content' },
  sourceType: { type: String, enum: ['video', 'audio', 'text', 'url'], required: true },
  sourceUrl: String,
  sourceFile: String,
  transcript: String,
  transcriptLanguage: String,
  analysis: Schema.Types.Mixed,
  goal: { type: String, enum: ['reach', 'authority', 'conversion', 'auto'], default: 'auto' },
  status: { type: String, default: 'draft' },
  jobId: String,
  errorMessage: String,
  brandVoiceId: { type: Schema.Types.ObjectId, ref: 'BrandVoice' },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  selectedPlatforms: [{ type: String }],
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const generatedContentSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'ContentProject', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  platform: { type: String, required: true },
  type: { type: String, required: true },
  content: { type: Schema.Types.Mixed, required: true },
  qualityScore: Number,
  qualityIssues: [{ type: String }],
  qualitySuggestions: [{ type: String }],
  status: { type: String, enum: ['generating', 'ready', 'failed', 'edited'], default: 'generating' },
}, { timestamps: true });

const campaignSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true });

const contentIdeaSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  platform: { type: String, default: '' },
  goal: { type: String, default: '' },
  status: { type: String, enum: ['idea', 'planned', 'creating', 'created', 'published'], default: 'idea' },
}, { timestamps: true });

const integrationSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  provider: { type: String, required: true },
  status: { type: String, enum: ['connected', 'disconnected', 'error'], default: 'disconnected' },
  credentials: { type: Schema.Types.Mixed, default: {} },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const usageSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  month: { type: String, required: true },
  minutesProcessed: { type: Number, default: 0 },
  generations: { type: Number, default: 0 },
  projects: { type: Number, default: 0 },
  exports: { type: Number, default: 0 },
  aiTokens: { type: Number, default: 0 },
}, { timestamps: true });

export const User = wrapMethods('User', userSchema);
export const Workspace = wrapMethods('Workspace', workspaceSchema);
export const WorkspaceMember = wrapMethods('WorkspaceMember', workspaceMemberSchema);
export const BrandVoice = wrapMethods('BrandVoice', brandVoiceSchema);
export const ContentProject = wrapMethods('ContentProject', contentProjectSchema);
export const GeneratedContent = wrapMethods('GeneratedContent', generatedContentSchema);
export const Campaign = wrapMethods('Campaign', campaignSchema);
export const ContentIdea = wrapMethods('ContentIdea', contentIdeaSchema);
export const Integration = wrapMethods('Integration', integrationSchema);
export const Usage = wrapMethods('Usage', usageSchema);

const notificationSchema = new Schema({
  userId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true },
  type: { type: String, enum: ['content_ready', 'content_failed', 'info', 'warning'], default: 'info' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  projectId: { type: String },
  read: { type: Boolean, default: false },
}, { timestamps: true });

export const Notification = wrapMethods('Notification', notificationSchema);

const scheduledPostSchema = new Schema({
  workspaceId: { type: String, required: true },
  projectId: { type: String, required: true },
  generatedContentId: { type: String, required: true },
  platform: { type: String, required: true },
  scheduledAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ['scheduled', 'published', 'cancelled', 'failed'],
    default: 'scheduled',
  },
  notes: { type: String, default: '' },
  publishedAt: { type: Date },
  errorMessage: String,
  externalUrl: String,
}, { timestamps: true });

export const ScheduledPost = wrapMethods('ScheduledPost', scheduledPostSchema);

const inviteSchema = new Schema({
  workspaceId: { type: String, required: true },
  token: { type: String, required: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  invitedBy: { type: String, required: true },
  acceptedAt: { type: Date },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

export const Invite = wrapMethods('Invite', inviteSchema);
