import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projectsApi } from '../api/endpoints';
import type { Project } from '../types';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    const { data } = await projectsApi.list();
    setProjects(data);
  }

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await projectsApi.create(name.trim(), description.trim() || undefined);
    setName('');
    setDescription('');
    await reload();
  }

  async function onDelete(id: string) {
    if (!confirm('Delete project and all its tasks?')) return;
    await projectsApi.remove(id);
    await reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-slate-500">Create a project to start tracking tasks.</p>
      </div>

      <form onSubmit={onCreate} className="card space-y-2">
        <input
          className="input"
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <input
          className="input"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="btn-primary">Create project</button>
      </form>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-slate-500">No projects yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id} className="card flex items-start justify-between">
              <div>
                <Link to={`/projects/${p.id}`} className="font-medium hover:underline">
                  {p.name}
                </Link>
                {p.description && (
                  <p className="mt-1 text-sm text-slate-500">{p.description}</p>
                )}
              </div>
              <button className="btn-danger text-xs" onClick={() => void onDelete(p.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
