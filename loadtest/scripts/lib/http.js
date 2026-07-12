// Thin wrappers around the Task Tracker REST API with k6 metrics + checks.
// Every request carries a stable `name` tag so k6 groups templated URLs (e.g.
// /tasks/:id) into one metric series instead of exploding cardinality.

import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';

import { cfg, userEmail } from './config.js';

export const throttled = new Counter('throttled_429');
export const authFailures = new Rate('auth_failures');

function params(name, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers, tags: { name }, timeout: cfg.reqTimeout };
}

// Fail fast and loud if the target isn't healthy, instead of letting every VU
// hang on a wedged server. Call from a script's setup(). Checks the edge's own
// healthz (nginx-direct) and the backend liveness probe.
export function preflightOrAbort() {
  const edge = http.get(`${cfg.baseUrl}/edge-healthz`, {
    tags: { name: 'preflight' },
    timeout: '8s',
  });
  if (edge.status !== 200) {
    exec.test.abort(
      `edge не отвечает (status ${edge.status}). На VM: docker compose ps / logs edge — скорее всего стек завис, рестартни его.`,
    );
  }
  const live = http.get(`${cfg.apiBase}/health/live`, {
    tags: { name: 'preflight' },
    timeout: '8s',
  });
  if (live.status !== 200) {
    exec.test.abort(
      `backend /health/live = ${live.status}. На VM: docker compose logs backend — backend не обрабатывает запросы (БД/Redis?).`,
    );
  }
}

function note429(res) {
  if (res.status === 429) throttled.add(1);
  return res;
}

// ---- auth ----

export function register(email, name, password) {
  return note429(
    http.post(
      `${cfg.apiBase}/auth/register`,
      JSON.stringify({ email, name, password }),
      params('POST /auth/register'),
    ),
  );
}

export function login(email, password) {
  const res = note429(
    http.post(
      `${cfg.apiBase}/auth/login`,
      JSON.stringify({ email, password }),
      params('POST /auth/login'),
    ),
  );
  authFailures.add(!check(res, { 'login 200': (r) => r.status === 200 }));
  return res;
}

// Register user <i>, or log in if it already exists (idempotent seeding).
// Returns the parsed { accessToken, refreshToken, userId } or null.
export function ensureUser(i) {
  const email = userEmail(i);
  const r = register(email, `Load User ${i}`, cfg.password);
  if (r.status === 201) return JSON.parse(r.body);
  if (r.status === 409) {
    const l = login(email, cfg.password);
    if (l.status === 200) return JSON.parse(l.body);
  }
  return null; // 429 or unexpected — caller backs off; throttled_429 flags it
}

// ---- projects / tasks ----

export function createProject(token, name, description) {
  return note429(
    http.post(
      `${cfg.apiBase}/projects`,
      JSON.stringify({ name, description }),
      params('POST /projects', token),
    ),
  );
}

export function createTask(token, projectId, payload) {
  return note429(
    http.post(
      `${cfg.apiBase}/projects/${projectId}/tasks`,
      JSON.stringify(payload),
      params('POST /projects/:id/tasks', token),
    ),
  );
}

export function patchTask(token, taskId, patch) {
  return note429(
    http.patch(
      `${cfg.apiBase}/tasks/${taskId}`,
      JSON.stringify(patch),
      params('PATCH /tasks/:id', token),
    ),
  );
}

// ---- reads (the "do the lists hang under volume?" surface) ----

export function listProjects(token, cursor) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return note429(
    http.get(`${cfg.apiBase}/projects${q}`, params('GET /projects', token)),
  );
}

export function getProject(token, id) {
  return note429(
    http.get(`${cfg.apiBase}/projects/${id}`, params('GET /projects/:id', token)),
  );
}

export function projectTasks(token, id, cursor) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return note429(
    http.get(
      `${cfg.apiBase}/projects/${id}/tasks${q}`,
      params('GET /projects/:id/tasks', token),
    ),
  );
}

export function myTasks(token) {
  return note429(http.get(`${cfg.apiBase}/tasks/mine`, params('GET /tasks/mine', token)));
}

export function activity(token) {
  return note429(http.get(`${cfg.apiBase}/activity`, params('GET /activity', token)));
}

export function unreadCount(token) {
  return note429(
    http.get(
      `${cfg.apiBase}/notifications/unread-count`,
      params('GET /notifications/unread-count', token),
    ),
  );
}
