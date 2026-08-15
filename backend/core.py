import os
import jwt
import bcrypt
import uuid
import secrets
from pathlib import Path
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from fastapi import Request, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------- MongoDB ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------- JWT / Auth ----------------
JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response, access_token: str, refresh_token: str):
    response.set_cookie(key="access_token", value=access_token, httponly=True,
                        secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True,
                        secure=True, samesite="none", max_age=604800, path="/")


def clear_auth_cookies(response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


# ---------------- Utils ----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def gen_code(prefix: str = "OFF") -> str:
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def strip_id(doc):
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def public_user(u):
    if not u:
        return u
    return {
        "id": u.get("id"),
        "name": u.get("name"),
        "photo_url": u.get("photo_url"),
        "role": u.get("role"),
        "subscription_status": u.get("subscription_status"),
    }


# ---------------- Auth dependencies ----------------
async def _resolve_user(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


async def get_current_user(request: Request):
    user = await _resolve_user(request)
    # update last activity (best-effort)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_activity": now_iso()}})
    return strip_id(user)


def require_role(*roles):
    async def _dep(request: Request):
        user = await _resolve_user(request)
        allowed = set(roles)
        if "admin" in allowed:
            allowed.add("super_admin")  # super_admin satisfies any admin-guarded route
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Acesso negado para este perfil")
        await db.users.update_one({"id": user["id"]}, {"$set": {"last_activity": now_iso()}})
        return strip_id(user)
    return _dep


# ---------------- Domain helpers ----------------
async def log_activity(user, action: str, screen: str, device: str = "web"):
    try:
        await db.activity_logs.insert_one({
            "id": new_id(),
            "user_type": user.get("role"),
            "user_id": user.get("id"),
            "action": action,
            "screen": screen,
            "created_at": now_iso(),
            "session": user.get("id"),
            "device": device,
            "last_activity": now_iso(),
        })
    except Exception:
        pass


async def create_notification(recipient_id, recipient_role, ntype, title, message, link=None, establishment_id=None):
    await db.notifications.insert_one({
        "id": new_id(),
        "recipient_id": recipient_id,
        "recipient_role": recipient_role,
        "type": ntype,
        "title": title,
        "message": message,
        "establishment_id": establishment_id,
        "created_at": now_iso(),
        "read": False,
        "link": link,
    })


async def create_audit(actor, action_type, record, before, after):
    await db.audit_logs.insert_one({
        "id": new_id(),
        "actor_id": actor.get("id") if actor else None,
        "actor_name": actor.get("name") if actor else "system",
        "action_type": action_type,
        "record": record,
        "before": before,
        "after": after,
        "created_at": now_iso(),
    })


async def get_settings():
    s = await db.settings.find_one({"id": "global"})
    if not s:
        s = {
            "id": "global",
            "consumer_plan_price": None,
            "merchant_plan_price": None,
            "ticket_rule_type": "per_confirmed_purchase",
            "ticket_rule_value": 1,
            "promo_period": None,
            "coupon": None,
        }
        await db.settings.insert_one(dict(s))
    return strip_id(s)


import re as _re_phone
def normalize_phone(s):
    """Remove tudo que não é dígito e o código do país 55 (quando presente). Retorna só DDD+número."""
    d = _re_phone.sub(r"\D", "", s or "")
    if len(d) > 11 and d.startswith("55"):
        d = d[2:]
    return d
