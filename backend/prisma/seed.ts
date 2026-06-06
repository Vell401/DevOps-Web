import {
  ActivityType,
  LabelColor,
  PrismaClient,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TEST_PASSWORD = '12345678';

const TEST_USERS = [
  { email: '1@1.com', name: 'Anya Petrova', avatarColor: 'green' },
  { email: '2@2.com', name: 'Mark Sokolov', avatarColor: 'orange' },
  { email: '3@3.com', name: 'Lena Volkova', avatarColor: 'purple' },
];

async function clearExisting() {
  // Idempotent reseed for the seeded demo project — keeps test users.
  await prisma.activity.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.label.deleteMany({});
  await prisma.project.deleteMany({});
}

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const users = await Promise.all(
    TEST_USERS.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, avatarColor: u.avatarColor },
        create: {
          email: u.email,
          name: u.name,
          passwordHash,
          avatarColor: u.avatarColor,
        },
      }),
    ),
  );
  const [anya, mark, lena] = users;

  await clearExisting();

  const platform = await prisma.project.create({
    data: {
      key: 'PLAT',
      name: 'Platform DevOps',
      description: 'Infrastructure, CI/CD and observability for the product team.',
      ownerId: anya.id,
    },
  });

  const customers = await prisma.project.create({
    data: {
      key: 'CUST',
      name: 'Customer Portal',
      description: 'Self-serve area where customers manage subscriptions.',
      ownerId: anya.id,
    },
  });

  const labelSpec = [
    { project: platform.id, name: 'infra', color: LabelColor.BLUE },
    { project: platform.id, name: 'ci/cd', color: LabelColor.PURPLE },
    { project: platform.id, name: 'observability', color: LabelColor.GREEN },
    { project: platform.id, name: 'security', color: LabelColor.RED },
    { project: platform.id, name: 'docs', color: LabelColor.GRAY },
    { project: customers.id, name: 'frontend', color: LabelColor.ORANGE },
    { project: customers.id, name: 'backend', color: LabelColor.YELLOW },
    { project: customers.id, name: 'bug', color: LabelColor.RED },
    { project: customers.id, name: 'feature', color: LabelColor.GREEN },
  ];
  const labels = await Promise.all(
    labelSpec.map((l) =>
      prisma.label.create({
        data: { name: l.name, color: l.color, projectId: l.project },
      }),
    ),
  );
  const L = (project: string, name: string) =>
    labels.find((x) => x.projectId === project && x.name === name)!;

  interface TaskSpec {
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    project: { id: string; key: string };
    labels: string[];
    subtasks?: Omit<TaskSpec, 'project' | 'subtasks'>[];
  }

  const platformTasks: TaskSpec[] = [
    {
      title: 'Migrate CI pipeline to GitHub Actions',
      description:
        'Move all Jenkins jobs to GitHub Actions, parametrise runners, cache deps. Reduce build time by 40%.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      assigneeId: anya.id,
      project: platform,
      labels: ['ci/cd', 'infra'],
      subtasks: [
        {
          title: 'Audit existing Jenkins jobs',
          status: TaskStatus.DONE,
          priority: TaskPriority.MEDIUM,
          assigneeId: anya.id,
          labels: ['ci/cd'],
        },
        {
          title: 'Bootstrap reusable Actions workflows',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.HIGH,
          assigneeId: anya.id,
          labels: ['ci/cd'],
        },
        {
          title: 'Document migration runbook',
          status: TaskStatus.TODO,
          priority: TaskPriority.LOW,
          assigneeId: lena.id,
          labels: ['docs'],
        },
      ],
    },
    {
      title: 'Roll out staging Kubernetes cluster',
      description: 'Provision EKS with autoscaling, ingress and Cert-manager.',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
      assigneeId: mark.id,
      project: platform,
      labels: ['infra'],
    },
    {
      title: 'Switch logs to Loki + Grafana',
      description: 'Replace ELK with Loki for cost; keep Grafana dashboards.',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.MEDIUM,
      assigneeId: lena.id,
      project: platform,
      labels: ['observability'],
    },
    {
      title: 'Patch CVE-2026-7741 in api image',
      description: 'Critical container CVE; bump base image and re-test.',
      status: TaskStatus.BLOCKED,
      priority: TaskPriority.URGENT,
      assigneeId: anya.id,
      project: platform,
      labels: ['security', 'infra'],
    },
    {
      title: 'Backups verified weekly via runbook',
      description: 'Add automated restore test for Postgres backups.',
      status: TaskStatus.BACKLOG,
      priority: TaskPriority.MEDIUM,
      assigneeId: null,
      project: platform,
      labels: ['infra'],
    },
    {
      title: 'Decommission old monitoring stack',
      status: TaskStatus.DONE,
      priority: TaskPriority.LOW,
      assigneeId: lena.id,
      project: platform,
      labels: ['observability'],
    },
  ];

  const customerTasks: TaskSpec[] = [
    {
      title: 'Subscription management dashboard',
      description: 'Allow users to upgrade, pause and cancel from one screen.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      assigneeId: mark.id,
      project: customers,
      labels: ['feature', 'frontend'],
      subtasks: [
        {
          title: 'Design upgrade flow mockups',
          status: TaskStatus.DONE,
          priority: TaskPriority.MEDIUM,
          assigneeId: lena.id,
          labels: ['frontend'],
        },
        {
          title: 'Implement billing API endpoints',
          status: TaskStatus.IN_PROGRESS,
          priority: TaskPriority.HIGH,
          assigneeId: anya.id,
          labels: ['backend'],
        },
      ],
    },
    {
      title: 'Empty state on /invoices is broken',
      description: 'Page crashes when user has zero invoices.',
      status: TaskStatus.TODO,
      priority: TaskPriority.HIGH,
      assigneeId: mark.id,
      project: customers,
      labels: ['bug', 'frontend'],
    },
    {
      title: 'Add SSO via Google',
      status: TaskStatus.BACKLOG,
      priority: TaskPriority.MEDIUM,
      assigneeId: null,
      project: customers,
      labels: ['feature', 'backend'],
    },
    {
      title: 'Migrate Stripe webhooks to v2',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.MEDIUM,
      assigneeId: anya.id,
      project: customers,
      labels: ['backend'],
    },
    {
      title: 'Onboarding tour for first-time users',
      status: TaskStatus.DONE,
      priority: TaskPriority.LOW,
      assigneeId: lena.id,
      project: customers,
      labels: ['feature', 'frontend'],
    },
  ];

  let counterPlatform = 0;
  let counterCustomers = 0;
  const nextNumber = (projectId: string) => {
    if (projectId === platform.id) return ++counterPlatform;
    return ++counterCustomers;
  };

  async function createTaskWithLog(spec: TaskSpec, parentId: string | null) {
    const number = nextNumber(spec.project.id);
    const task = await prisma.task.create({
      data: {
        number,
        title: spec.title,
        description: spec.description,
        status: spec.status,
        priority: spec.priority,
        assigneeId: spec.assigneeId,
        projectId: spec.project.id,
        parentId,
        labels: {
          connect: spec.labels.map((name) => ({ id: L(spec.project.id, name).id })),
        },
      },
    });
    await prisma.activity.create({
      data: {
        taskId: task.id,
        actorId: spec.assigneeId ?? anya.id,
        type: ActivityType.CREATED,
      },
    });
    if (spec.status !== TaskStatus.TODO) {
      await prisma.activity.create({
        data: {
          taskId: task.id,
          actorId: spec.assigneeId ?? anya.id,
          type: ActivityType.STATUS_CHANGED,
          fromValue: TaskStatus.TODO,
          toValue: spec.status,
        },
      });
    }
    return task;
  }

  const allTasks: TaskSpec[] = [...platformTasks, ...customerTasks];
  for (const spec of allTasks) {
    const parent = await createTaskWithLog(spec, null);
    if (spec.subtasks?.length) {
      for (const sub of spec.subtasks) {
        const subSpec: TaskSpec = { ...sub, project: spec.project };
        await createTaskWithLog(subSpec, parent.id);
      }
    }
  }

  await prisma.project.update({
    where: { id: platform.id },
    data: { taskCounter: counterPlatform },
  });
  await prisma.project.update({
    where: { id: customers.id },
    data: { taskCounter: counterCustomers },
  });

  // a couple of seed comments
  const firstTask = await prisma.task.findFirst({
    where: { projectId: platform.id, parentId: null },
    orderBy: { number: 'asc' },
  });
  if (firstTask) {
    await prisma.comment.create({
      data: {
        body: 'Kicking this off — pipeline draft is in the runbooks branch.',
        taskId: firstTask.id,
        authorId: anya.id,
      },
    });
    await prisma.activity.create({
      data: {
        taskId: firstTask.id,
        actorId: anya.id,
        type: ActivityType.COMMENT_ADDED,
        toValue: 'Kicking this off — pipeline draft is in the runbooks branch.',
      },
    });
    await prisma.comment.create({
      data: {
        body: 'Reviewed the caching strategy, looks solid. +1',
        taskId: firstTask.id,
        authorId: mark.id,
      },
    });
    await prisma.activity.create({
      data: {
        taskId: firstTask.id,
        actorId: mark.id,
        type: ActivityType.COMMENT_ADDED,
        toValue: 'Reviewed the caching strategy, looks solid. +1',
      },
    });
  }

  console.log(
    `Seeded: ${platform.key}, ${customers.key}; users ${TEST_USERS.map((u) => u.email).join(', ')} (password: ${TEST_PASSWORD})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
