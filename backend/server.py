from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
import os
import logging

from core import db, hash_password, verify_password, now_iso
from storage import init_storage
from seed import seed, migrate
import routes_auth, routes_common, routes_consumer, routes_merchant, routes_admin, routes_requests, routes_boosts, routes_delivery, routes_taxi, routes_payments, routes_taxi_pay

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("off360")

app = FastAPI(title="OFF 360 API")

app.include_router(routes_auth.router)
app.include_router(routes_common.router)
app.include_router(routes_consumer.router)
app.include_router(routes_merchant.router)
app.include_router(routes_admin.router)
app.include_router(routes_requests.router)
app.include_router(routes_boosts.router)
app.include_router(routes_delivery.router)
app.include_router(routes_taxi.router)
app.include_router(routes_payments.router)
app.include_router(routes_taxi_pay.router)


@app.exception_handler(Exception)
async def _unhandled_exception(request, exc):
    from fastapi.responses import JSONResponse
    import logging as _logging
    _logging.getLogger("off360").exception("Unhandled error on %s", getattr(request, "url", ""))
    return JSONResponse(status_code=500, content={"detail": "Erro interno do servidor. Tente novamente."})


@app.get("/api/")
async def root():
    return {"message": "OFF 360 API", "status": "ok"}


@app.get("/api/health")
async def health():
    return {"status": "healthy"}


origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    # indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.establishments.create_index("qr_token")
        await db.establishments.create_index("owner_id")
        await db.transactions.create_index("consumer_id")
        await db.transactions.create_index("establishment_id")
        await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning(f"Index setup warning: {e}")
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await seed()
    await migrate()
    logger.info("Seed complete")


@app.on_event("shutdown")
async def shutdown():
    from core import client
    client.close()
