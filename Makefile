.PHONY: up down logs backend frontend migrate migration orval

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

backend:
	docker compose exec backend bash

frontend:
	docker compose exec frontend sh

migrate:
	docker compose exec backend alembic upgrade head

migration:
	@read -p "Migration name: " name; \
	docker compose exec backend alembic revision --autogenerate -m "$$name"

orval:
	cd frontend && npx orval
