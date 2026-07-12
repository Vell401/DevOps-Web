// Phase 1 — fill the DB realistically through the public API.
// Registers USERS accounts; each creates PROJECTS_PER_USER projects with
// TASKS_PER_PROJECT tasks. Idempotent: an existing account logs in instead of
// re-registering, so you can re-run to top up.
//
// NOTE on throttling: auth (register/login) is per-IP. If the VM's auth
// throttle is NOT relaxed, keep SEED_VUS small (<=5) — otherwise registrations
// hit 429 and users are skipped (visible as throttled_429 > 0).

import exec from 'k6/execution';

import { cfg, randomInt } from './lib/config.js';
import * as api from './lib/http.js';

export { handleSummary } from './lib/summary.js';

export const options = {
  scenarios: {
    seed: {
      executor: 'shared-iterations',
      vus: cfg.seedVus,
      iterations: cfg.users,
      maxDuration: '2h',
    },
  },
  thresholds: {
    // If this trips, the auth throttle wasn't relaxed — see README.
    throttled_429: ['count==0'],
  },
};

export function setup() {
  api.preflightOrAbort();
}

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export default function () {
  const i = exec.scenario.iterationInTest; // unique 0..USERS-1
  const user = api.ensureUser(i);
  if (!user) return; // throttled / failed — threshold reports it
  const token = user.accessToken;

  for (let p = 0; p < cfg.projectsPerUser; p++) {
    const pr = api.createProject(token, `LP ${i}-${p}`, 'load seed project');
    if (pr.status !== 201) continue;
    const projectId = JSON.parse(pr.body).id;

    for (let t = 0; t < cfg.tasksPerProject; t++) {
      api.createTask(token, projectId, {
        title: `Task ${i}-${p}-${t}`,
        description: 'seeded by load test',
        status: STATUSES[randomInt(STATUSES.length)],
      });
    }
  }
}
