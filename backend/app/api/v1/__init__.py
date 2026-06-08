from fastapi import APIRouter

from app.api.v1 import auth, availability, calendar, contracts, health, organizations, preferences, role_groups, schedules, skills, store_config, stores, users

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(organizations.router)
api_router.include_router(stores.router)
api_router.include_router(role_groups.router)
api_router.include_router(availability.router)
api_router.include_router(preferences.router)
api_router.include_router(store_config.router)
api_router.include_router(schedules.router)
api_router.include_router(calendar.router)
api_router.include_router(contracts.router)
api_router.include_router(skills.router)
