import { Request } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
  workspaceId?: string;
  userRole?: string;
  isAdmin?: boolean;
}

export interface ApiResponse<T = any> {
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

export type Platform = 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'youtube' | 'threads' | 'newsletter' | 'blog';

export interface PlatformConfig {
  id: Platform;
  name: string;
  icon: string;
  enabled: boolean;
}

export const PLATFORMS: PlatformConfig[] = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', enabled: true },
  { id: 'x', name: 'X', icon: '𝕏', enabled: true },
  { id: 'instagram', name: 'Instagram', icon: '📸', enabled: true },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', enabled: true },
  { id: 'youtube', name: 'YouTube', icon: '▶️', enabled: true },
  { id: 'threads', name: 'Threads', icon: '🧵', enabled: true },
  { id: 'newsletter', name: 'Newsletter', icon: '📧', enabled: true },
  { id: 'blog', name: 'Blog', icon: '✍️', enabled: true },
];

export interface PlanLimits {
  projectsPerMonth: number;
  maxFileSize: number; // MB
  supportedPlatforms: Platform[];
  transcriptionMinutes: number;
  brandVoices: number;
  campaigns: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    projectsPerMonth: 3,
    maxFileSize: 100,
    supportedPlatforms: ['linkedin', 'x', 'instagram'],
    transcriptionMinutes: 30,
    brandVoices: 1,
    campaigns: 0,
  },
  creator: {
    projectsPerMonth: 30,
    maxFileSize: 500,
    supportedPlatforms: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'threads', 'newsletter', 'blog'],
    transcriptionMinutes: 300,
    brandVoices: 3,
    campaigns: 10,
  },
  pro: {
    projectsPerMonth: 100,
    maxFileSize: 1000,
    supportedPlatforms: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'threads', 'newsletter', 'blog'],
    transcriptionMinutes: 1000,
    brandVoices: 10,
    campaigns: 50,
  },
  agency: {
    projectsPerMonth: 500,
    maxFileSize: 2000,
    supportedPlatforms: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'threads', 'newsletter', 'blog'],
    transcriptionMinutes: 5000,
    brandVoices: -1, // unlimited
    campaigns: -1,
  },
};
