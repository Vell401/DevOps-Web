import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { commentsApi, projectsApi, tasksApi, usersApi } from '../api/endpoints';
import type { Comment, Project, Task, TaskPriority, TaskStatus, User } from '../types';

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('MEDIUM');
  const [newAssignee, setNewAssignee] = useState<string>('');

  async function reload() {
    if (!id) return;
    const [p, t, u] = await Promise.all([
      projectsApi.get(id),
      tasksApi.list(id),
      usersApi.list(),
    ]);
    setProject(p.data);
    setTasks(t.data);
    setUsers(u.data);
  }

  useEffect(() => {
    void reload();
  }, [id]);

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!id || !newTitle.trim()) return;
    await tasksApi.create(id, {
      title: newTitle.trim(),
      priority: newPriority,
      assigneeId: newAssignee || undefined,
    });
    setNewTitle('');
    setNewAssignee('');
    setNewPriority('MEDIUM');
    await reload();
  }

  async function onChangeStatus(task: Task, status: TaskStatus) {
    await tasksApi.update(task.id, { status });
    await reload();
  }

  async function onDeleteTask(task: Task) {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    await tasksApi.remove(task.id);
    if (selectedTask?.id === task.id) setSelectedTask(null);
    await reload();
  }

  if (!project) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/projects" className="text-sm text-slate-500 hover:underline">
          &larr; Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
        {project.description && (
          <p className="text-sm text-slate-500">{project.description}</p>
        )}
      </div>

      <form onSubmit={onCreateTask} className="card flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Task title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          required
          minLength={2}
        />
        <select
          className="input w-32"
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="input w-44"
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn-primary">Add task</button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {STATUSES.map((status) => (
          <div key={status} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {status}
            </h2>
            {tasks
              .filter((t) => t.status === status)
              .map((t) => (
                <div key={t.id} className="card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="text-left font-medium hover:underline"
                      onClick={() => setSelectedTask(t)}
                    >
                      {t.title}
                    </button>
                    <span className="text-xs text-slate-500">{t.priority}</span>
                  </div>
                  {t.assignee && (
                    <p className="text-xs text-slate-500">@ {t.assignee.name}</p>
                  )}
                  <div className="flex gap-1">
                    {STATUSES.filter((s) => s !== t.status).map((s) => (
                      <button
                        key={s}
                        className="btn-secondary text-xs"
                        onClick={() => void onChangeStatus(t, s)}
                      >
                        → {s}
                      </button>
                    ))}
                    <button
                      className="btn-danger text-xs"
                      onClick={() => void onDeleteTask(t)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>

      {selectedTask && (
        <TaskPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');

  async function reload() {
    const { data } = await commentsApi.list(task.id);
    setComments(data);
  }

  useEffect(() => {
    void reload();
  }, [task.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await commentsApi.create(task.id, body.trim());
    setBody('');
    await reload();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{task.title}</h3>
          {task.description && (
            <p className="mt-1 text-sm text-slate-600">{task.description}</p>
          )}
        </div>
        <button className="btn-secondary text-xs" onClick={onClose}>
          Close
        </button>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Comments</h4>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded bg-slate-50 p-2 text-sm">
              <div className="text-xs text-slate-500">
                {c.author?.name ?? 'Unknown'} · {new Date(c.createdAt).toLocaleString()}
              </div>
              {c.body}
            </li>
          ))}
          {comments.length === 0 && (
            <li className="text-sm text-slate-500">No comments yet.</li>
          )}
        </ul>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          className="input"
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="btn-primary">Send</button>
      </form>
    </div>
  );
}
