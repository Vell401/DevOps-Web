import { PrismaClient, TaskPriority, TaskStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: { email: 'alice@example.com', name: 'Alice', passwordHash },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: { email: 'bob@example.com', name: 'Bob', passwordHash },
  });

  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      description: 'Seeded sample project',
      ownerId: alice.id,
      tasks: {
        create: [
          {
            title: 'Set up CI pipeline',
            description: 'GitHub Actions to run tests + lint on PR',
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            assigneeId: alice.id,
          },
          {
            title: 'Write Dockerfile',
            status: TaskStatus.TODO,
            priority: TaskPriority.MEDIUM,
            assigneeId: bob.id,
          },
          {
            title: 'Configure Postgres backups',
            status: TaskStatus.TODO,
            priority: TaskPriority.LOW,
          },
        ],
      },
    },
  });

  console.log(`Seeded: project ${project.id}, users alice=${alice.id}, bob=${bob.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
