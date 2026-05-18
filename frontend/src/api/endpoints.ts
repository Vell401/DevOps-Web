import { api } from './client';
import type { Comment, Project, Task, User } from '../types';

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
  list: () => api.get<Project[]>('/projects'),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (name: string, description?: string) =>
    api.post<Project>('/projects', { name, description }),
  update: (id: string, body: Partial<Pick<Project, 'name' | 'description'>>) =>
    api.patch<Project>(`/projects/${id}`, body),
  remove: (id: string) => api.delete(`/projects/${id}`),
};

export const tasksApi = {
  list: (projectId: string) => api.get<Task[]>(`/projects/${projectId}/tasks`),
  create: (projectId: string, body: Partial<Task>) =>
    api.post<Task>(`/projects/${projectId}/tasks`, body),
  update: (id: string, body: Partial<Task>) => api.patch<Task>(`/tasks/${id}`, body),
  remove: (id: string) => api.delete(`/tasks/${id}`),
};

export const commentsApi = {
  list: (taskId: string) => api.get<Comment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, body: string) =>
    api.post<Comment>(`/tasks/${taskId}/comments`, { body }),
  remove: (id: string) => api.delete(`/comments/${id}`),
};

export const usersApi = {
  list: () => api.get<User[]>('/users'),
};
