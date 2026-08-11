from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
import secrets

from core import (db, hash_password, verify_password, create_access_token, create_refresh_token,
                  set_auth_cookies, clear_auth_cookies, get_current_user, new_id, now_iso, now_utc,
                  strip_id, log_activity, create_notification)
from datetime import timedelta

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    phone: str
    password: str
    role: str  # consumer | merchant
    city: Optional[str] = ""
    neighborhood: Optional[str] = ""
    # merchant fields
    fantasy_name: Optional[str] = None
    category_id: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ForgotInput(BaseModel):
    email: EmailStr


class ResetInput(BaseModel):
    token: str
    password: str


async def _check_lock(identifier):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= 5:
        locked_until = rec.get("locked_until")
        if locked_until and locked_until > now_iso():
            raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente em alguns minutos.")


async def _fail(identifier):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    count = (rec.get("count", 0) if rec else 0) + 1
    update = {"count": count}
    if count >= 5:
        update["locked_until"] = (now_utc() + timedelta(minutes=15)).isoformat()
    await db.login_attempts.update_one({"identifier": identifier}, {"$set": {"identifier": identifier, **update}}, upsert=True)


@router.post("/register")
async def register(payload: RegisterInput, response: Response):
    if payload.role not in ("consumer", "merchant"):
        raise HTTPException(status_code=400, detail="Perfil inválido")
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")

    uid = new_id()
    user = {
        "id": uid,
        "role": payload.role,
        "name": payload.name,
        "email": email,
        "phone": payload.phone,
        "password_hash": hash_password(payload.password),
        "photo_url": None,
        "city": payload.city or "",
        "neighborhood": payload.neighborhood or "",
        "account_status": "active",
        "created_at": now_iso(),
        "last_access": now_iso(),
        "last_activity": now_iso(),
        "data_consent": True,
    }
    if payload.role == "consumer":
        user.update({
            "subscription_status": "pending",
            "subscription_start": None,
            "next_due": None,
            "total_saved": 0.0,
            "total_spent": 0.0,
            "ticket_count": 0,
            "favorites": [],
        })
    else:
        user.update({
            "subscription_status": "pending",
            "subscription_start": None,
            "next_due": None,
        })
    await db.users.insert_one(dict(user))

    # NOTE: merchant establishments are NOT auto-created here. After registering,
    # the merchant is guided to complete the full form of the first establishment.

    access = create_access_token(uid, payload.role)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    await log_activity(user, "register", "auth")
    return strip_id(dict(user))


@router.post("/login")
async def login(payload: LoginInput, request: Request, response: Response):
    email = payload.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    await _check_lock(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await _fail(identifier)
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")
    if user.get("account_status") == "suspended":
        raise HTTPException(status_code=403, detail="Conta suspensa. Contate o suporte.")
    await db.login_attempts.delete_one({"identifier": identifier})
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_access": now_iso(), "last_activity": now_iso()}})
    access = create_access_token(user["id"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    await log_activity(user, "login", "auth")
    return strip_id(user)


@router.post("/logout")
async def logout(response: Response, user=Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.post("/forgot-password")
async def forgot(payload: ForgotInput):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "id": new_id(), "token": token, "user_id": user["id"],
            "expires_at": (now_utc() + timedelta(hours=1)).isoformat(),
            "used": False, "created_at": now_iso(),
        })
        print(f"[OFF360] Password reset link: /reset-password?token={token}")
    return {"ok": True, "message": "Se o e-mail existir, um link de recuperação foi enviado."}


class ChangePwInput(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(payload: ChangePwInput, user=Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(payload.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter ao menos 6 caracteres")
    if verify_password(payload.new_password, full.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da atual")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(payload.new_password), "must_change_password": False,
    }})
    return {"ok": True}


@router.post("/reset-password")
async def reset(payload: ResetInput):
    rec = await db.password_reset_tokens.find_one({"token": payload.token})
    if not rec or rec.get("used") or rec.get("expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Token inválido ou expirado")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_password(payload.password)}})
    await db.password_reset_tokens.update_one({"id": rec["id"]}, {"$set": {"used": True}})
    return {"ok": True}
