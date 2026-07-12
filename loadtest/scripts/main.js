// Combined run — HTTP load and live Socket.IO connections at the same time, so
// the board receives realtime events while the API is under load. Reuses the
// iteration functions from the standalone scripts via k6 scenarios `exec`.

import { cfg } from './lib/config.js';
import { httpIteration } from './load-http.js';
import { wsIteration } from './load-socketio.js';
import { preflightOrAbort } from './lib/http.js';

export { handleSummary } from './lib/summary.js';

export function setup() {
  preflightOrAbort();
}

// k6 resolves scenario `exec` names against this module's exports.
export { httpIteration, wsIteration };

export const options = {
  scenarios: {
    http_load: {
      executor: 'ramping-vus',
      exec: 'httpIteration',
      startVUs: 0,
      stages: [
        { duration: cfg.ramp, target: cfg.vus },
        { duration: cfg.duration, target: cfg.vus },
        { duration: cfg.ramp, target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    sockets: {
      executor: 'constant-vus',
      exec: 'wsIteration',
      vus: Math.max(1, Math.floor(cfg.vus / 3)),
      duration: cfg.duration,
      startTime: cfg.ramp, // let the HTTP ramp begin first
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    throttled_429: ['count==0'],
    ws_errors: ['count==0'],
  },
};
