import { PrismaClient, TaskPriority, TaskStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Simple test accounts for quick logins. All share the password `12345678`,
// which satisfies the API validation (valid email + min length 8) so no DTO
// changes are needed. Do NOT use these in production.
const TEST_PASSWORD = '12345678';

const TEST_USERS = [
  { email: '1@1.com', name: 'User One' },
  { email: '2@2.com', name: 'User Two' },
  { email: '3@3.com', name: 'User Three' },
];

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const [userOne, userTwo, userThree] = await Promise.all(
    TEST_USERS.map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: { email: u.email, name: u.name, passwordHash },
      }),
    ),
  );

  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      description: 'Seeded sample project',
      ownerId: userOne.id,
      tasks: {
        create: [
          {
            title: 'Set up CI pipeline',
            description: 'GitHub Actions to run tests + lint on PR',
            status: TaskStatus.IN_PROGRESS,
            priority: TaskPriority.HIGH,
            assigneeId: userOne.id,
          },
          {
            title: 'Write Dockerfile',
            status: TaskStatus.TODO,
            priority: TaskPriority.MEDIUM,
            assigneeId: userTwo.id,
          },
          {
            title: 'Configure Postgres backups',
            status: TaskStatus.TODO,
            priority: TaskPriority.LOW,
            assigneeId: userThree.id,
          },
        ],
      },
    },
  });

  console.log(
    `Seeded: project ${project.id}, users ${userOne.email}, ${userTwo.email}, ${userThree.email} (password: ${TEST_PASSWORD})`,
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
