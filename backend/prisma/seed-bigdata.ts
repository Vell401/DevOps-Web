/**
 * Load-test data generator. Fills a database with large volumes of synthetic
 * projects / tasks / comments / activity so capacity tests exercise realistic
 * query plans (pagination, board, activity feed, "my tasks").
 *
 * SAFETY — this never touches real data:
 *   - Everything it creates is marked: projects keyed `LT…`, users
 *     `loadtest+N@tracker.local`. `purge` deletes ONLY those rows.
 *   - `seed` refuses to run against a database that already holds non-loadtest
 *     rows (i.e. looks like a real/seeded DB) unless `--force` is passed.
 *   - In practice you point it at the isolated load-test stack's own Postgres
 *     (docker-compose.loadtest.yml), so the real DB is never even reachable.
 *
 * Usage (inside the load-test backend container):
 *   npx ts-node prisma/seed-bigdata.ts seed --users 100 --projects 50 \
 *       --tasks 20000 --comments 50000 --activity 50000
 *   npx ts-node prisma/seed-bigdata.ts stats
 *   npx ts-node prisma/seed-bigdata.ts purge
 */
import { randomUUID } from 'crypto';
import {
  ActivityType,
  Prisma,
  PrismaClient,
  ProjectRole,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PROJECT_PREFIX = 'LT';
const USER_PREFIX = 'loadtest+';
const PASSWORD = process.env.LOADTEST_PASSWORD ?? 'loadtest1234';

const STATUSES = Object.values(TaskStatus);
const PRIORITIES = Object.values(TaskPriority);
const WORDS =
  'deploy pipeline cache index latency rollout metric backlog refactor incident audit schema queue worker probe build release patch token gateway adapter'.split(
    ' ',
  );

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function sentence(n = 8): string {
  return Array.from({ length: n }, () => pick(WORDS)).join(' ');
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface Options {
  users: number;
  projects: number;
  tasks: number;
  comments: number;
  activity: number;
  force: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    users: 100,
    projects: 50,
    tasks: 20000,
    comments: 50000,
    activity: 50000,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => parseInt(argv[++i], 10);
    if (a === '--users') o.users = num();
    else if (a === '--projects') o.projects = num();
    else if (a === '--tasks') o.tasks = num();
    else if (a === '--comments') o.comments = num();
    else if (a === '--activity') o.activity = num();
    else if (a === '--force') o.force = true;
  }
  return o;
}

/** Refuse to seed a DB that holds rows we didn't generate, unless forced. */
async function assertSafe(force: boolean): Promise<void> {
  const [realProjects, realUsers] = await Promise.all([
    prisma.project.count({ where: { NOT: { key: { startsWith: PROJECT_PREFIX } } } }),
    prisma.user.count({ where: { NOT: { email: { startsWith: USER_PREFIX } } } }),
  ]);
  if ((realProjects > 0 || realUsers > 0) && !force) {
    throw new Error(
      `Refusing to seed: database already contains ${realUsers} non-loadtest user(s) ` +
        `and ${realProjects} non-loadtest project(s) — this looks like a real database.\n` +
        `Point this at the isolated load-test Postgres, or pass --force if you are sure.`,
    );
  }
}

async function seed(opts: Options): Promise<void> {
  await assertSafe(opts.force);
  const t0 = Date.now();
  console.log(`[seed] users=${opts.users} projects=${opts.projects} tasks=${opts.tasks} comments=${opts.comments} activity=${opts.activity}`);

  // One shared bcrypt hash for every load-test user (so login works against the
  // real app), computed once instead of N times.
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // --- Users (explicit ids so we can wire relations without re-querying) ---
  const userIds = Array.from({ length: opts.users }, () => randomUUID());
  const userRows = userIds.map((id, i) => ({
    id,
    email: `${USER_PREFIX}${i}@tracker.local`,
    name: `LoadTest User ${i}`,
    passwordHash,
    avatarColor: pick(['gray', 'blue', 'green', 'purple', 'orange']),
  }));
  for (const part of chunk(userRows, 1000)) {
    await prisma.user.createMany({ skipDuplicates: true, data: part });
  }

  // --- Projects (owner = a load-test user) ---
  const projectIds = Array.from({ length: opts.projects }, () => randomUUID());
  await prisma.project.createMany({
    skipDuplicates: true,
    data: projectIds.map((id, i) => ({
      id,
      key: `${PROJECT_PREFIX}${i}`,
      name: `Load Project ${i}`,
      description: sentence(6),
      ownerId: pick(userIds),
    })),
  });

  // --- Memberships: scatter users across projects as EDITORs ---
  const memberships: Prisma.ProjectMemberCreateManyInput[] = [];
  for (const projectId of projectIds) {
    const owner = (await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    }))!.ownerId;
    const count = Math.min(userIds.length - 1, 5 + Math.floor(Math.random() * 10));
    const members = new Set<string>();
    while (members.size < count) {
      const u = pick(userIds);
      if (u !== owner) members.add(u);
    }
    for (const userId of members) {
      memberships.push({ projectId, userId, role: ProjectRole.EDITOR });
    }
  }
  for (const part of chunk(memberships, 5000)) {
    await prisma.projectMember.createMany({ skipDuplicates: true, data: part });
  }

  // --- Tasks: distributed across projects, sequential number per project ---
  const perProject = Math.ceil(opts.tasks / opts.projects);
  const taskIds: string[] = [];
  const taskCounters = new Map<string, number>();
  let made = 0;
  for (const projectId of projectIds) {
    if (made >= opts.tasks) break;
    const n = Math.min(perProject, opts.tasks - made);
    const batch: Prisma.TaskCreateManyInput[] = [];
    for (let i = 1; i <= n; i++) {
      const id = randomUUID();
      taskIds.push(id);
      batch.push({
        id,
        number: i,
        title: `Task ${i}: ${sentence(5)}`,
        description: sentence(20),
        status: pick(STATUSES),
        priority: pick(PRIORITIES),
        position: i,
        dueDate: Math.random() < 0.3 ? new Date(Date.now() + (Math.random() * 14 - 3) * 86400000) : null,
        projectId,
      });
    }
    taskCounters.set(projectId, n);
    for (const part of chunk(batch, 5000)) {
      await prisma.task.createMany({ skipDuplicates: true, data: part });
    }
    made += n;
  }
  // Keep taskCounter in sync so the app's number sequence continues correctly.
  for (const [projectId, c] of taskCounters) {
    await prisma.project.update({ where: { id: projectId }, data: { taskCounter: c } });
  }

  // --- Assignees: link ~half the tasks to a random user via the implicit M2M
  // join table (Prisma orders the relation alphabetically → A=Task, B=User). ---
  const pairs = taskIds
    .filter(() => Math.random() < 0.5)
    .map((taskId) => ({ a: taskId, b: pick(userIds) }));
  for (const part of chunk(pairs, 1000)) {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "_TaskAssignees" ("A","B") VALUES ${Prisma.join(
        part.map((p) => Prisma.sql`(${p.a}, ${p.b})`),
      )} ON CONFLICT DO NOTHING`,
    );
  }

  // --- Comments ---
  const comments: Prisma.CommentCreateManyInput[] = Array.from(
    { length: opts.comments },
    () => ({
      body: sentence(12),
      taskId: pick(taskIds),
      authorId: pick(userIds),
    }),
  );
  for (const part of chunk(comments, 5000)) {
    await prisma.comment.createMany({ data: part });
  }

  // --- Activity ---
  const activityTypes = Object.values(ActivityType);
  const activity: Prisma.ActivityCreateManyInput[] = Array.from(
    { length: opts.activity },
    () => ({
      taskId: pick(taskIds),
      actorId: pick(userIds),
      type: pick(activityTypes),
    }),
  );
  for (const part of chunk(activity, 5000)) {
    await prisma.activity.createMany({ data: part });
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[seed] done in ${secs}s`);
  await stats();
  console.log(
    `\nLogin for tests: ${USER_PREFIX}0..${opts.users - 1}@tracker.local / password "${PASSWORD}"`,
  );
}

async function purge(): Promise<void> {
  // Deleting projects cascades tasks → comments/activity/attachments/
  // notifications and memberships; deleting users cleans up the rest.
  const p = await prisma.project.deleteMany({ where: { key: { startsWith: PROJECT_PREFIX } } });
  const u = await prisma.user.deleteMany({ where: { email: { startsWith: USER_PREFIX } } });
  console.log(`[purge] removed ${p.count} project(s) and ${u.count} user(s) (cascaded children)`);
}

async function stats(): Promise<void> {
  const ltProjects = await prisma.project.findMany({
    where: { key: { startsWith: PROJECT_PREFIX } },
    select: { id: true },
  });
  const ids = ltProjects.map((p) => p.id);
  const [users, tasks, comments, activity] = await Promise.all([
    prisma.user.count({ where: { email: { startsWith: USER_PREFIX } } }),
    ids.length ? prisma.task.count({ where: { projectId: { in: ids } } }) : 0,
    ids.length ? prisma.comment.count({ where: { task: { projectId: { in: ids } } } }) : 0,
    ids.length ? prisma.activity.count({ where: { task: { projectId: { in: ids } } } }) : 0,
  ]);
  console.log(
    `[stats] loadtest data: users=${users} projects=${ltProjects.length} ` +
      `tasks=${tasks} comments=${comments} activity=${activity}`,
  );
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'seed':
      await seed(parseArgs(rest));
      break;
    case 'purge':
      await purge();
      break;
    case 'stats':
      await stats();
      break;
    default:
      console.log('Usage: seed-bigdata.ts <seed|purge|stats> [--users N --projects N --tasks N --comments N --activity N --force]');
      process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
