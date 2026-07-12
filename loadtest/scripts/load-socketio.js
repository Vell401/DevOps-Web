// Phase 3 — hold many live Socket.IO connections.
// Ramps to VUS virtual users; each logs in (HTTP), opens a Socket.IO connection
// the way the frontend does, subscribes to one of its projects, and keeps the
// socket open for SOCKET_HOLD while receiving any broadcast events. Run this
// alongside load-http.js (or use main.js) so there are real mutations to push.

import { sleep } from 'k6';
import exec from 'k6/execution';

import { cfg, durationToMs } from './lib/config.js';
import * as api from './lib/http.js';
import { runSocket } from './lib/socketio.js';

export { handleSummary } from './lib/summary.js';

export const options = {
  scenarios: {
    sockets: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: cfg.ramp, target: cfg.vus },
        { duration: cfg.duration, target: cfg.vus },
        { duration: cfg.ramp, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    ws_errors: ['count==0'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  api.preflightOrAbort();
}

// Per-VU identity + a project to subscribe to.
let token = null;
let projectId = null;

function ensure() {
  if (token && projectId) return true;
  const i = (exec.vu.idInTest - 1) % cfg.users;
  const user = api.ensureUser(i);
  if (!user) return false;
  token = user.accessToken;

  const r = api.listProjects(token);
  if (r.status === 200) {
    const items = JSON.parse(r.body).items || [];
    if (items.length) projectId = items[0].id;
  }
  if (!projectId) {
    // user has no project yet — make one so there's a room to subscribe to
    const pr = api.createProject(token, `WS ${exec.vu.idInTest}`, 'ws');
    if (pr.status === 201) projectId = JSON.parse(pr.body).id;
  }
  return !!projectId;
}

export function wsIteration() {
  if (!ensure()) {
    sleep(2);
    return;
  }
  runSocket(token, projectId, durationToMs(cfg.socketHold));
}

export default function () {
  wsIteration();
}
