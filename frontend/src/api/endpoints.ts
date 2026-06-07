import { api } from './client';
import type {
  Activity,
  ActivityStats,
  ActivityType,
  AdminStats,
  AdminUser,
  Comment,
  Label,
  LabelColor,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  User,
  UserLite,
} from '../types';

export const authApi = {
  register: (email: string, name: string, password: string) =>
    api.post<{ accessToken: string; refreshToken: string; userId: string }>(
      '/auth/register',
      { email, name, password },
    ),
  login: (email: string, password: string) =>
    api.post<{ accessToken: string; refreshToken: string; userId: string }>(
      '/auth/login',
      { email, password },
    ),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get<User>('/auth/me'),
};

export const projectsApi = {
  list: (opts: { closed?: boolean } = {}) =>
    api.get<Project[]>('/projects', {
      params: opts.closed ? { closed: 'true' } : undefined,
    }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (name: string, description?: string) =>
    api.post<Project>('/projects', { name, description }),
  update: (id: string, body: Partial<Pick<Project, 'name' | 'description'>>) =>
    api.patch<Project>(`/projects/${id}`, body),
  close: (id: string) => api.post<Project>(`/projects/${id}/close`),
  reopen: (id: string) => api.post<Project>(`/projects/${id}/reopen`),
  remove: (id: string) => api.delete(`/projects/${id}`),
  activity: (id: string) => api.get<Activity[]>(`/projects/${id}/activity`),
};

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  q?: string;
  labelIds?: string[];
  topLevel?: boolean;
}

export interface TaskBody {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  position?: number;
  dueDate?: string | null;
  assigneeId?: string | null;
  parentId?: string | null;
  labelIds?: string[];
}

export const tasksApi = {
  list: (projectId: string, filters: TaskFilters = {}) => {
    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    if (filters.q) params.q = filters.q;
    if (filters.labelIds?.length) params.labelIds = filters.labelIds.join(',');
    if (filters.topLevel) params.topLevel = 'true';
    return api.get<Task[]>(`/projects/${projectId}/tasks`, { params });
  },
  get: (id: string) => api.get<Task>(`/tasks/${id}`),
  create: (projectId: string, body: TaskBody) =>
    api.post<Task>(`/projects/${projectId}/tasks`, body),
  update: (id: string, body: TaskBody) => api.patch<Task>(`/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/tasks/${id}`),
  activity: (id: string) => api.get<Activity[]>(`/tasks/${id}/activity`),
};

export const commentsApi = {
  list: (taskId: string) => api.get<Comment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, body: string) =>
    api.post<Comment>(`/tasks/${taskId}/comments`, { body }),
  remove: (id: string) => api.delete(`/comments/${id}`),
};

export const labelsApi = {
  list: (projectId: string) => api.get<Label[]>(`/projects/${projectId}/labels`),
  create: (projectId: string, name: string, color?: LabelColor) =>
    api.post<Label>(`/projects/${projectId}/labels`, { name, color }),
  update: (id: string, body: { name?: string; color?: LabelColor }) =>
    api.patch<Label>(`/labels/${id}`, body),
  remove: (id: string) => api.delete(`/labels/${id}`),
};

export const usersApi = {
  list: () => api.get<UserLite[]>('/users'),
};

export interface ActivityFilters {
  actorId?: string;
  type?: ActivityType;
  projectId?: string;
}

export const activityApi = {
  global: (filters: ActivityFilters = {}) => {
    const params: Record<string, string> = {};
    if (filters.actorId) params.actorId = filters.actorId;
    if (filters.type) params.type = filters.type;
    if (filters.projectId) params.projectId = filters.projectId;
    return api.get<Activity[]>('/activity', { params });
  },
  projectStats: (projectId: string) =>
    api.get<ActivityStats>(`/projects/${projectId}/activity/stats`),
};

export interface AdminUpdateUserBody {
  name?: string;
  isAdmin?: boolean;
  newPassword?: string;
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  listUsers: () => api.get<AdminUser[]>('/admin/users'),
  updateUser: (id: string, body: AdminUpdateUserBody) =>
    api.patch<AdminUser>(`/admin/users/${id}`, body),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
};
