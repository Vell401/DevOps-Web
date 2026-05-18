# Convenience targets. On Windows, run from Git Bash (not cmd.exe).
SHELL := /usr/bin/env bash

COMPOSE       ?= docker compose
COMPOSE_PROD  ?= docker compose -f docker-compose.prod.yml --env-file .env

.DEFAULT_GOAL := help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Local dev ---

up: ## Start dev stack (build if needed)
	$(COMPOSE) up -d --build

down: ## Stop dev stack
	$(COMPOSE) down

logs: ## Tail logs from all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show running containers
	$(COMPOSE) ps

migrate: ## Apply Prisma migrations inside the backend container
	$(COMPOSE) exec backend npx prisma migrate deploy

migrate-dev: ## Create and apply a new migration (dev only)
	$(COMPOSE) exec backend npx prisma migrate dev

seed: ## Seed sample data
	$(COMPOSE) exec backend npm run prisma:seed

shell-backend: ## Open shell in backend container
	$(COMPOSE) exec backend sh

shell-db: ## Open psql in postgres container
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-tracker} -d $${POSTGRES_DB:-tracker}

# --- Tests ---

test-backend: ## Run backend unit tests
	$(COMPOSE) exec backend npm test

test-frontend: ## Run frontend tests
	$(COMPOSE) exec frontend npm test

# --- Production (run on the VPS) ---

prod-pull: ## Pull production images from Docker Hub
	$(COMPOSE_PROD) pull

prod-up: ## Start production stack
	$(COMPOSE_PROD) up -d

prod-down: ## Stop production stack
	$(COMPOSE_PROD) down

prod-migrate: ## Apply migrations in prod
	$(COMPOSE_PROD) exec backend npx prisma migrate deploy

prod-logs: ## Tail prod logs
	$(COMPOSE_PROD) logs -f --tail=200
