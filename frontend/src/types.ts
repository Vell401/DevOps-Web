export type TaskStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'BLOCKED'
  | 'DONE';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type LabelColor =
  | 'GRAY'
  | 'BROWN'
  | 'ORANGE'
  | 'YELLOW'
  | 'GREEN'
  | 'BLUE'
  | 'PURPLE'
  | 'PINK'
  | 'RED';

export type ActivityType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ASSIGNEE_ADDED'
  | 'ASSIGNEE_REMOVED'
  | 'PRIORITY_CHANGED'
  | 'TITLE_CHANGED'
  | 'DESCRIPTION_CHANGED'
  | 'DUE_DATE_CHANGED'
  | 'LABEL_ADDED'
  | 'LABEL_REMOVED'
  | 'PARENT_CHANGED'
  | 'COMMENT_ADDED';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor?: string;
  isAdmin?: boolean;
  createdAt: string;
}

export interface AdminUser extends User {
  updatedAt: string;
  blocked: boolean;
  lastLoginAt: string | null;
  stats: { projects: number; tasks: number; comments: number };
}

export interface LoginEvent {
  id: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminMetrics {
  realtime: { connections: number; onlineUsers: number };
  sessions: number;
  storage: { totalBytes: number; fileCount: number };
  slowQueries: { model: string; action: string; durationMs: number; at: string }[];
  slowQueryThresholdMs: number;
  rateLimit: { total: number; byRoute: { route: string; count: number }[] };
}

export interface AdminStats {
  users: number;
  admins: number;
  projects: number;
  tasks: number;
  comments: number;
  tasksByStatus: { status: TaskStatus; count: number }[];
  recentSignups: Pick<User, 'id' | 'email' | 'name' | 'avatarColor' | 'createdAt'>[];
}

export interface UserLite {
  id: string;
  name: string;
  email: string;
  avatarColor?: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  ownerId: string;
  taskCounter: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: { total: number; done: number };
  // Present on the list endpoint (GET /projects); omitted by GET /projects/:id.
  owner?: UserLite;
  members?: UserLite[];
}

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
  projectId: string;
  createdAt: string;
}

export interface TaskRef {
  id: string;
  number: number;
  title: string;
}

export interface Task {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueDate: string | null;
  projectId: string;
  assignees: UserLite[];
  parentId: string | null;
  parent?: TaskRef | null;
  labels: Label[];
  _count?: { subtasks: number; comments: number };
  subtasks?: Task[];
  createdAt: string;
  updatedAt: string;
  project?: { id: string; key: string; name: string; ownerId: string };
}

export interface Comment {
  id: string;
  body: string;
  taskId: string;
  authorId: string;
  author?: UserLite;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  uploaderId: string;
  uploader?: UserLite;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Activity {
  id: string;
  taskId: string;
  actorId: string;
  actor?: UserLite;
  type: ActivityType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  task?: {
    id: string;
    title: string;
    number: number;
    project?: { id: string; key: string; name: string };
  };
}

export interface ActivityStats {
  last30Days: { date: string; count: number }[];
  topContributors: { userId: string; name: string; avatarColor?: string; count: number }[];
  mostActiveTasks: { taskId: string; number: number; title: string; count: number }[];
  totalEvents30d: number;
}
