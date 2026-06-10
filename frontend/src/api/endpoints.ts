import { api } from './client';
import type {
  Activity,
  ActivityStats,
  ActivityType,
  AdminMetrics,
  AdminStats,
  AdminUser,
  Attachment,
  LoginEvent,
  Comment,
  Label,
  LabelColor,
  Paginated,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  User,
  UserLite,
} from '../types';

// Safety valve for "fetch everything" helpers: 50 pages × 100 items. The board
// and sidebar genuinely need the full list; anything bigger than this is a bug.
const MAX_PAGES = 50;

/** Walk a cursor-paginated endpoint to the end and concatenate the pages. */
async function fetchAllPages<T>(
  fetchPage: (cursor?: string) => Promise<Paginated<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

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
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch<{ accessToken: string; refreshToken: string }>(
      '/auth/me/password',
      { currentPassword, newPassword },
    ),
};

export const projectsApi = {
  /** Resolves with ALL accessible projects (pages through the cursor API). */
  list: (opts: { closed?: boolean } = {}) =>
    fetchAllPages<Project>(async (cursor) => {
      const { data } = await api.get<Paginated<Project>>('/projects', {
        params: {
          ...(opts.closed ? { closed: 'true' } : {}),
          ...(cursor ? { cursor } : {}),
        },
      });
      return data;
    }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (name: string, description?: string) =>
    api.post<Project>('/projects', { name, description }),
  update: (id: string, body: Partial<Pick<Project, 'name' | 'description'>>) =>
    api.patch<Project>(`/projects/${id}`, body),
  close: (id: string) => api.post<Project>(`/projects/${id}/close`),
  reopen: (id: string) => api.post<Project>(`/projects/${id}/reopen`),
  remove: (id: string) => api.delete(`/projects/${id}`),
  /** First page (newest 100 events) — enough for the project dashboard feed. */
  activity: async (id: string) => {
    const { data } = await api.get<Paginated<Activity>>(`/projects/${id}/activity`);
    return data.items;
  },
  listMembers: (id: string) => api.get<UserLite[]>(`/projects/${id}/members`),
  addMember: (id: string, userId: string) =>
    api.post<UserLite[]>(`/projects/${id}/members`, { userId }),
  removeMember: (id: string, memberId: string) =>
    api.delete<UserLite[]>(`/projects/${id}/members/${memberId}`),
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
  assigneeIds?: string[];
  parentId?: string | null;
  labelIds?: string[];
}

export const tasksApi = {
  /** Resolves with ALL matching tasks — the board renders every column in full. */
  list: (projectId: string, filters: TaskFilters = {}) => {
    const params: Record<string, string> = {};
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    if (filters.q) params.q = filters.q;
    if (filters.labelIds?.length) params.labelIds = filters.labelIds.join(',');
    if (filters.topLevel) params.topLevel = 'true';
    return fetchAllPages<Task>(async (cursor) => {
      const { data } = await api.get<Paginated<Task>>(
        `/projects/${projectId}/tasks`,
        { params: cursor ? { ...params, cursor } : params },
      );
      return data;
    });
  },
  get: (id: string) => api.get<Task>(`/tasks/${id}`),
  create: (projectId: string, body: TaskBody) =>
    api.post<Task>(`/projects/${projectId}/tasks`, body),
  update: (id: string, body: TaskBody) => api.patch<Task>(`/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/tasks/${id}`),
  /** First page (newest 100 events) — enough for the drawer's activity tab. */
  activity: async (id: string) => {
    const { data } = await api.get<Paginated<Activity>>(`/tasks/${id}/activity`);
    return data.items;
  },
};

export const commentsApi = {
  list: (taskId: string) => api.get<Comment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, body: string) =>
    api.post<Comment>(`/tasks/${taskId}/comments`, { body }),
  remove: (id: string) => api.delete(`/comments/${id}`),
};

export const attachmentsApi = {
  list: (taskId: string) =>
    api.get<Attachment[]>(`/tasks/${taskId}/attachments`),
  upload: (taskId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    // Let the browser set the multipart boundary — don't force Content-Type.
    return api.post<Attachment>(`/tasks/${taskId}/attachments`, fd);
  },
  remove: (id: string) => api.delete(`/attachments/${id}`),
  download: (id: string) =>
    api.get<Blob>(`/attachments/${id}`, { responseType: 'blob' }),
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
  /** One page of the global inbox; pass the previous page's cursor to continue. */
  global: async (filters: ActivityFilters = {}, cursor?: string) => {
    const params: Record<string, string> = {};
    if (filters.actorId) params.actorId = filters.actorId;
    if (filters.type) params.type = filters.type;
    if (filters.projectId) params.projectId = filters.projectId;
    if (cursor) params.cursor = cursor;
    const { data } = await api.get<Paginated<Activity>>('/activity', { params });
    return data;
  },
  projectStats: (projectId: string) =>
    api.get<ActivityStats>(`/projects/${projectId}/activity/stats`),
};

export interface AdminUpdateUserBody {
  name?: string;
  isAdmin?: boolean;
  blocked?: boolean;
  newPassword?: string;
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  metrics: () => api.get<AdminMetrics>('/admin/metrics'),
  listUsers: () => api.get<AdminUser[]>('/admin/users'),
  userLogins: (id: string) => api.get<LoginEvent[]>(`/admin/users/${id}/logins`),
  updateUser: (id: string, body: AdminUpdateUserBody) =>
    api.patch<AdminUser>(`/admin/users/${id}`, body),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
};
