// Shared config + small helpers. All knobs come from container env (passed via
// env_file in docker-compose.yml) and have safe defaults, so a bare run works.

function str(name, def) {
  const v = __ENV[name];
  return v === undefined || v === '' ? def : v;
}
function int(name, def) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : def;
}
function num(name, def) {
  const v = parseFloat(__ENV[name]);
  return Number.isFinite(v) ? v : def;
}

const baseUrl = str('BASE_URL', 'http://localhost').replace(/\/+$/, '');
const wsUrl = str('WS_URL', baseUrl.replace(/^http/, 'ws')).replace(/\/+$/, '');

export const cfg = {
  baseUrl,
  wsUrl,
  apiBase: `${baseUrl}/api`,
  password: str('LOAD_PASSWORD', 'Loadtest12345'),
  users: int('USERS', 300),
  emailPrefix: str('EMAIL_PREFIX', 'loadtest'),
  emailDomain: str('EMAIL_DOMAIN', 'example.com'),
  projectsPerUser: int('PROJECTS_PER_USER', 5),
  tasksPerProject: int('TASKS_PER_PROJECT', 20),
  seedVus: int('SEED_VUS', 20),
  vus: int('VUS', 300),
  duration: str('DURATION', '5m'),
  ramp: str('RAMP', '1m'),
  socketHold: str('SOCKET_HOLD', '60s'),
  // Per-request timeout. Short by design: a hung target should fail fast, not
  // tie up an nginx connection for k6's 60s default (which can wedge the edge).
  reqTimeout: str('REQ_TIMEOUT', '15s'),
  thinkMin: num('THINK_MIN', 1),
  thinkMax: num('THINK_MAX', 4),
};

export function userEmail(i) {
  return `${cfg.emailPrefix}+${i}@${cfg.emailDomain}`;
}

export function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomInt(n) {
  return Math.floor(Math.random() * n);
}

// Parse a duration like "60s" / "2m" into milliseconds (for ws hold timers).
export function durationToMs(s) {
  const m = /^(\d+)\s*(ms|s|m)?$/.exec(String(s).trim());
  if (!m) return 60000;
  const n = parseInt(m[1], 10);
  if (m[2] === 'ms') return n;
  if (m[2] === 'm') return n * 60000;
  return n * 1000; // default seconds
}
