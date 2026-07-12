// Sanity check before scaling: one user does the full journey end to end.
// register -> login -> create project -> create task -> read the lists ->
// one Socket.IO round-trip. If anything here is red (or throttled_429 > 0),
// fix the target / throttle BEFORE running the heavier scenarios.

import { check, sleep } from 'k6';

import { cfg } from './lib/config.js';
import * as api from './lib/http.js';
import { runSocket } from './lib/socketio.js';

export { handleSummary } from './lib/summary.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'],
    throttled_429: ['count==0'],
  },
};

export function setup() {
  // Bail out early (and clearly) if the target is wedged.
  api.preflightOrAbort();
}

export default function () {
  // Unique email so a smoke run never collides with seeded users.
  const email = `smoke+${Date.now()}@${cfg.emailDomain}`;

  const reg = api.register(email, 'Smoke Test', cfg.password);
  check(reg, { 'register 201': (r) => r.status === 201 });
  const tokens = reg.status === 201 ? JSON.parse(reg.body) : null;
  if (!tokens) throw new Error(`auth failed: ${reg.status} ${reg.body}`);
  const token = tokens.accessToken;

  const proj = api.createProject(token, `Smoke ${Date.now()}`, 'smoke project');
  check(proj, { 'create project 201': (r) => r.status === 201 });
  const projectId = JSON.parse(proj.body).id;

  const task = api.createTask(token, projectId, { title: 'Smoke task one' });
  check(task, { 'create task 201': (r) => r.status === 201 });

  check(api.listProjects(token), { 'list projects 200': (r) => r.status === 200 });
  check(api.myTasks(token), { 'my tasks 200': (r) => r.status === 200 });
  check(api.activity(token), { 'activity 200': (r) => r.status === 200 });
  check(api.projectTasks(token, projectId), {
    'project tasks 200': (r) => r.status === 200,
  });

  // One realtime round-trip: connect, subscribe, hold briefly.
  runSocket(token, projectId, 3000);
  sleep(1);
}
