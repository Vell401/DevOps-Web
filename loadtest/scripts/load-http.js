// Phase 2 — steady, realistic HTTP load.
// Ramps to VUS virtual users. Each VU maps to one seeded account, logs in once
// (token cached for the VU), then loops a weighted mix of reads (70%) and
// writes (30%) with human-like think-time. Reads target exactly the list
// endpoints we worry about under volume.

import { sleep } from 'k6';
import exec from 'k6/execution';

import { cfg, randomBetween, randomInt } from './lib/config.js';
import * as api from './lib/http.js';

export { handleSummary } from './lib/summary.js';

export const options = {
  scenarios: {
    http_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: cfg.ramp, target: cfg.vus },
        { duration: cfg.duration, target: cfg.vus },
        { duration: cfg.ramp, target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:GET /projects}': ['p(95)<800'],
    'http_req_duration{name:GET /tasks/mine}': ['p(95)<800'],
    throttled_429: ['count==0'],
  },
};

export function setup() {
  api.preflightOrAbort();
}

// Per-VU state (each VU is its own JS runtime).
let token = null;
let myProjects = [];

function ensureLoggedIn() {
  if (token) return true;
  const i = (exec.vu.idInTest - 1) % cfg.users;
  const user = api.ensureUser(i);
  if (!user) return false;
  token = user.accessToken;
  const r = api.listProjects(token);
  if (r.status === 200) {
    myProjects = (JSON.parse(r.body).items || []).map((p) => p.id);
  }
  return true;
}

export function httpIteration() {
  if (!ensureLoggedIn()) {
    sleep(1);
    return;
  }

  if (Math.random() < 0.7) {
    // --- reads ---
    const r = api.listProjects(token);
    if (r.status === 401) {
      token = null; // force re-login next iteration
      return;
    }
    api.myTasks(token);
    api.activity(token);
    api.unreadCount(token);
    if (myProjects.length) {
      const pid = myProjects[randomInt(myProjects.length)];
      api.getProject(token, pid);
      api.projectTasks(token, pid);
    }
  } else {
    // --- writes ---
    if (myProjects.length && Math.random() < 0.8) {
      const pid = myProjects[randomInt(myProjects.length)];
      api.createTask(token, pid, { title: `LT task ${Date.now()}` });
    } else {
      const pr = api.createProject(token, `LT proj ${Date.now()}`, 'load');
      if (pr.status === 201) myProjects.push(JSON.parse(pr.body).id);
    }
  }

  sleep(randomBetween(cfg.thinkMin, cfg.thinkMax));
}

export default function () {
  httpIteration();
}
