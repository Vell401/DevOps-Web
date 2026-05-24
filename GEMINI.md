# Task Tracker — DevOps Web Project

A fullstack Task Tracker application (mini-Jira) designed for DevOps practice. It includes a NestJS backend, a React frontend, and a PostgreSQL database, all containerized with Docker.

## Project Overview

- **Backend**: NestJS 10 (TypeScript) with Prisma 5 ORM.
- **Frontend**: React 18 (TypeScript) powered by Vite and styled with TailwindCSS.
- **Database**: PostgreSQL 16.
- **Cache/Rate Limiting**: Redis 7.
- **Architecture**: Modular NestJS backend, SPA React frontend, Nginx as a reverse proxy in production.
- **CI/CD**: GitHub Actions workflows for linting, testing, building Docker images, and deploying to a VPS via SSH.

## Building and Running

### Prerequisites
- Docker and Docker Compose
- Node.js (for local development without Docker)
- Make (optional, but recommended for shortcut commands)

### Local Development (Docker)
1.  **Environment Setup**:
    ```bash
    cp .env.example .env
    ```
2.  **Initialize Database**:
    If this is a fresh start, you must generate the initial migration:
    ```bash
    docker compose up -d postgres
    docker compose run --rm backend npx prisma migrate dev --name init --skip-seed
    ```
3.  **Start the Stack**:
    ```bash
    make up
    ```
    This starts the backend (3000), frontend (5173), postgres, and redis.
4.  **Run Migrations and Seed**:
    ```bash
    make migrate
    make seed
    ```

### Key Commands (via Makefile)
- `make up`: Start dev stack.
- `make down`: Stop dev stack.
- `make logs`: Tail logs from all services.
- `make migrate`: Apply Prisma migrations.
- `make seed`: Seed sample data.
- `make test-backend`: Run backend unit tests.
- `make test-frontend`: Run frontend tests.
- `make shell-backend`: Open shell in backend container.
- `make shell-db`: Open psql in postgres container.

## Project Structure

- `backend/`: NestJS application.
    - `src/`: Application modules (auth, users, projects, tasks, etc.).
    - `prisma/`: Database schema and migrations.
- `frontend/`: React application.
    - `src/`: Pages, components, and API client.
- `deploy/`: Production infrastructure configurations (Nginx).
- `.github/workflows/`: CI/CD pipelines.
- `docker-compose.yml`: Local development configuration.
- `docker-compose.prod.yml`: Production configuration using pre-built images.

## Development Conventions

### Backend
- **Framework**: NestJS with modular architecture.
- **Validation**: Use `class-validator` and `class-transformer` in DTOs.
- **ORM**: Prisma. Always update `schema.prisma` and run `migrate-dev` for schema changes.
- **Logging**: Pino (via `nestjs-pino`). Use structured JSON logging.
- **Auth**: JWT-based with access and rotating refresh tokens.

### Frontend
- **State Management**: React Hooks and Context API for Auth.
- **API Client**: Axios with interceptors for automatic token refresh.
- **Styling**: TailwindCSS.
- **Testing**: Vitest and React Testing Library.

### DevOps & Infrastructure
- **Docker**: Multi-stage builds are used for both backend and frontend.
- **Migrations**: Database migrations are handled by Prisma and applied during deployment.
- **Environment Variables**: Managed via `.env` files. Ensure `.env` is never committed.
- **CI/CD**:
    - `ci.yml`: Lints and tests on every PR.
    - `release.yml`: Builds and pushes Docker images on merge to main.
    - `deploy.yml`: Deploys to VPS via SSH.
