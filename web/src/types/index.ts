export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  onboardingCompleted: boolean;
  onboardingData?: OnboardingData;
}

export interface OnboardingData {
  role?: string;
  platforms?: string[];
  audience?: string;
  topics?: string;
  tones?: string[];
  brandDescription?: string;
}

export interface Workspace {
  id: string;
  name: string;
  plan: 'free' | 'creator' | 'pro' | 'agency';
  ownerId: string;
}

export interface ContentProject {
  _id: string;
  workspaceId: string;
  createdBy: string;
  title: string;
  sourceType: 'video' | 'audio' | 'text' | 'url';
  sourceUrl?: string;
  sourceFile?: string;
  transcript?: string;
  analysis?: ContentAnalysis;
  goal: 'reach' | 'authority' | 'conversion' | 'auto';
  status: ContentStatus;
  selectedPlatforms: string[];
  brandVoiceId?: string;
  campaignId?: string;
  metadata: Record<string, any>;
  generatedCount?: number;
  platforms?: string[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export type ContentStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'transcribing'
  | 'analysing'
  | 'generating'
  | 'quality_check'
  | 'ready'
  | 'failed'
  | 'archived';

export interface ContentAnalysis {
  title: string;
  summary: string;
  mainTopic: string;
  keyPoints: string[];
  hook: string;
  audience: string;
  painPoints: string[];
  insights: string[];
  story: string;
  tone: string;
  cta: string;
  contentType: string;
  keywords: string[];
  entities: string[];
  claims: string[];
  suggestedAngles: string[];
}

export interface GeneratedContent {
  _id: string;
  projectId: string;
  workspaceId: string;
  platform: string;
  type: string;
  content: any;
  qualityScore?: number;
  qualityIssues: string[];
  qualitySuggestions: string[];
  status: 'generating' | 'ready' | 'failed' | 'edited';
  createdAt: string;
  updatedAt: string;
}

export interface BrandVoice {
  _id: string;
  workspaceId: string;
  name: string;
  description: string;
  samples: string[];
  tone: string[];
  audience: string;
  avoidWords: string[];
  preferredWords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  _id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  contentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentIdea {
  _id: string;
  workspaceId: string;
  title: string;
  description: string;
  platform: string;
  goal: string;
  status: 'idea' | 'planned' | 'creating' | 'created' | 'published';
  createdAt: string;
  updatedAt: string;
}

export interface Integration {
  _id: string;
  workspaceId: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  contentCreated: number;
  piecesGenerated: number;
  campaignsCreated: number;
  contentPublished: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  pages: number;
}
