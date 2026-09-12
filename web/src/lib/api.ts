const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
    ...options,
  };

  // Don't set Content-Type for FormData
  if (options.body instanceof FormData) {
    delete (config.headers as any)['Content-Type'];
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

// Auth
export const auth = {
  register: (body: { email: string; password: string; name: string }) =>
    request<any>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<any>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () =>
    request<any>('/auth/logout', { method: 'POST' }),
  me: () =>
    request<any>('/auth/me'),
  forgotPassword: (email: string) =>
    request<any>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<any>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  updateOnboarding: (data: any) =>
    request<any>('/auth/onboarding', { method: 'PUT', body: JSON.stringify(data) }),
};

// Content
export const content = {
  list: (params?: { page?: number; limit?: number; status?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.search) searchParams.set('search', params.search);
    return request<any>(`/content?${searchParams.toString()}`);
  },
  get: (id: string) =>
    request<any>(`/content/${id}`),
  getStatus: (id: string) =>
    request<any>(`/content/${id}/status`),
  create: (formData: FormData) =>
    request<any>('/content', { method: 'POST', body: formData }),
  createFromText: (body: { title: string; text: string; goal: string; selectedPlatforms: string[]; brandVoiceId?: string }) =>
    request<any>('/content/text', { method: 'POST', body: JSON.stringify(body) }),
  createFromUrl: (body: { title?: string; url: string; goal: string; selectedPlatforms: string[]; brandVoiceId?: string }) =>
    request<any>('/content/url', { method: 'POST', body: JSON.stringify(body) }),
  export: (id: string, format: string) =>
    request<any>(`/content/${id}/export`, { method: 'POST', body: JSON.stringify({ format }) }),
  generate: (id: string) =>
    request<any>(`/content/${id}/generate`, { method: 'POST' }),
  regenerate: (id: string, platform: string) =>
    request<any>(`/content/${id}/regenerate/${platform}`, { method: 'POST' }),
  updateTranscript: (id: string, transcript: string) =>
    request<any>(`/content/${id}/transcript`, { method: 'PUT', body: JSON.stringify({ transcript }) }),
  updateGenerated: (generatedId: string, content: any) =>
    request<any>(`/content/${generatedId}/content`, { method: 'PUT', body: JSON.stringify({ content }) }),
  rewrite: (id: string, generatedId: string, instruction: string) =>
    request<any>(`/content/${id}/rewrite`, { method: 'POST', body: JSON.stringify({ generatedId, instruction }) }),
  delete: (id: string) =>
    request<any>(`/content/${id}`, { method: 'DELETE' }),
};

// Workspaces
export const workspaces = {
  list: () => request<any>('/workspaces'),
  current: () => request<any>('/workspaces/current'),
  update: (data: { name: string }) =>
    request<any>('/workspaces/current', { method: 'PUT', body: JSON.stringify(data) }),
};

// Brand Voices
export const brandVoices = {
  list: () => request<any>('/brand-voices'),
  create: (data: any) =>
    request<any>('/brand-voices', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/brand-voices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<any>(`/brand-voices/${id}`, { method: 'DELETE' }),
};

// Campaigns
export const campaigns = {
  list: () => request<any>('/campaigns'),
  create: (data: any) =>
    request<any>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<any>(`/campaigns/${id}`, { method: 'DELETE' }),
};

// Ideas
export const ideas = {
  list: (status?: string) =>
    request<any>(`/ideas${status ? `?status=${status}` : ''}`),
  create: (data: any) =>
    request<any>('/ideas', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/ideas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<any>(`/ideas/${id}`, { method: 'DELETE' }),
};

// Stats
export const stats = {
  get: () => request<any>('/stats'),
};

// Billing
export const billing = {
  plans: () => request<any>('/billing/plans'),
  usage: () => request<any>('/billing/usage'),
  subscription: () => request<any>('/billing/subscription'),
  checkout: (planId: string) =>
    request<any>('/billing/checkout', { method: 'POST', body: JSON.stringify({ planId }) }),
  portal: () =>
    request<any>('/billing/portal', { method: 'POST' }),
  cancel: () =>
    request<any>('/billing/cancel', { method: 'POST' }),
  uncancel: () =>
    request<any>('/billing/uncancel', { method: 'POST' }),
};

// Integrations
export const integrations = {
  list: () => request<any>('/integrations'),
  connect: (provider: string, data: any) =>
    request<any>(`/integrations/${provider}/connect`, { method: 'POST', body: JSON.stringify(data) }),
  disconnect: (provider: string) =>
    request<any>(`/integrations/${provider}`, { method: 'DELETE' }),
  oauthStartUrl: (provider: string) => `/integrations/${provider}/oauth/start`,
};

// Notifications
export const notifications = {
  list: (params?: { limit?: number; unread?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.unread) searchParams.set('unread', 'true');
    return request<any>(`/notifications?${searchParams.toString()}`);
  },
  unreadCount: () => request<any>('/notifications/unread-count'),
  markRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () =>
    request<any>('/notifications/read-all', { method: 'PUT' }),
  delete: (id: string) =>
    request<any>(`/notifications/${id}`, { method: 'DELETE' }),
  clearAll: () =>
    request<any>('/notifications', { method: 'DELETE' }),
};

// Scheduler
export const scheduler = {
  list: (params?: { from?: string; to?: string; status?: string; platform?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.platform) searchParams.set('platform', params.platform);
    return request<any>(`/scheduler?${searchParams.toString()}`);
  },
  get: (id: string) =>
    request<any>(`/scheduler/${id}`),
  create: (data: {
    projectId: string;
    generatedContentId: string;
    platform: string;
    scheduledAt: string;
    notes?: string;
  }) =>
    request<any>('/scheduler', { method: 'POST', body: JSON.stringify(data) }),
  reschedule: (id: string, scheduledAt: string) =>
    request<any>(`/scheduler/${id}`, { method: 'PUT', body: JSON.stringify({ scheduledAt }) }),
  updateNotes: (id: string, notes: string) =>
    request<any>(`/scheduler/${id}`, { method: 'PUT', body: JSON.stringify({ notes }) }),
  cancel: (id: string) =>
    request<any>(`/scheduler/${id}/cancel`, { method: 'PUT' }),
  retry: (id: string) =>
    request<any>(`/scheduler/${id}/retry`, { method: 'PUT' }),
  markPublished: (id: string) =>
    request<any>(`/scheduler/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'published' }) }),
  delete: (id: string) =>
    request<any>(`/scheduler/${id}`, { method: 'DELETE' }),
};

// Team
export const team = {
  members: () =>
    request<any>('/team/members'),
  invites: () =>
    request<any>('/team/invites'),
  invite: (email: string, role?: string) =>
    request<any>('/team/invite', { method: 'POST', body: JSON.stringify({ email, role }) }),
  acceptInvite: (token: string) =>
    request<any>('/team/accept-invite', { method: 'POST', body: JSON.stringify({ token }) }),
  updateRole: (memberId: string, role: string) =>
    request<any>(`/team/members/${memberId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeMember: (memberId: string) =>
    request<any>(`/team/members/${memberId}`, { method: 'DELETE' }),
  revokeInvite: (inviteId: string) =>
    request<any>(`/team/invites/${inviteId}`, { method: 'DELETE' }),
  leave: () =>
    request<any>('/team/leave', { method: 'POST' }),
};

// Settings
export const settings = {
  getApiKey: () => request<any>('/settings/api-key'),
  saveApiKey: (apiKey: string) =>
    request<any>('/settings/api-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  removeApiKey: () =>
    request<any>('/settings/api-key', { method: 'PUT', body: JSON.stringify({ remove: true }) }),
  updateProfile: (data: { name?: string; email?: string }) =>
    request<any>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<any>('/settings/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
};

// Admin (platform administration — server enforces isAdmin on every call)
export const adminApi = {
  overview: () => request<any>('/admin/overview'),
  users: (params: { page?: number; limit?: number; search?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any>(`/admin/users${suffix}`);
  },
  userDetail: (id: string) => request<any>(`/admin/users/${id}`),
  setStatus: (id: string, status: 'active' | 'disabled') =>
    request<any>(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  setAdmin: (id: string, isAdmin: boolean) =>
    request<any>(`/admin/users/${id}/admin`, { method: 'PUT', body: JSON.stringify({ isAdmin }) }),
  workspaces: (params: { page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any>(`/admin/workspaces${suffix}`);
  },
};
