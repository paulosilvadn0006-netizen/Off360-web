from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
import secrets
import os

from core import (db, hash_password, verify_password, create_access_token, create_refresh_token,
                  set_auth_cookies, clear_auth_cookies, get_current_user, new_id, now_iso, now_utc,
                  strip_id, log_activity, create_notification, normalize_phone,
                  get_jwt_secret, JWT_ALGORITHM)
from emailer import send_email
import jwt as _jwt
from datetime import timedelta

router = APIRouter(prefix="/api/auth", tags=["auth"])
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    phone: str
    password: str
    role: str  # consumer | merchant
    city: Optional[str] = ""
    neighborhood: Optional[str] = ""
    address_street: Optional[str] = ""
    address_number: Optional[str] = ""
    address_neighborhood: Optional[str] = ""
    address_city: Optional[str] = ""
    address_complement: Optional[str] = ""
    # merchant fields
    fantasy_name: Optional[str] = None
    category_id: Optional[str] = None
    # deliverer fields
    vehicle: Optional[str] = None
    works_fixed: Optional[bool] = None
    fixed_establishment_id: Optional[str] = None
    photo_url: Optional[str] = None


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
    if payload.role not in ("consumer", "merchant", "deliverer"):
        raise HTTPException(status_code=400, detail="Perfil inválido")
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    phone = normalize_phone(payload.phone)
    if len(phone) not in (10, 11):
        raise HTTPException(status_code=400, detail="Telefone incompleto. Informe DDD + número, ex: (19) 99999-9999.")

    uid = new_id()
    user = {
        "id": uid,
        "role": payload.role,
        "name": payload.name,
        "email": email,
        "phone": phone,
        "password_hash": hash_password(payload.password),
        "photo_url": None,
        "city": payload.city or payload.address_city or "",
        "neighborhood": payload.neighborhood or payload.address_neighborhood or "",
        "address_street": payload.address_street or "",
        "address_number": payload.address_number or "",
        "address_neighborhood": payload.address_neighborhood or "",
        "address_city": payload.address_city or "",
        "address_complement": payload.address_complement or "",
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
    elif payload.role == "deliverer":
        user.update({
            "vehicle": payload.vehicle or "moto",
            "works_fixed": bool(payload.works_fixed),
            "fixed_establishment_id": payload.fixed_establishment_id if payload.works_fixed else None,
            "photo_url": payload.photo_url,
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


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    tok = request.cookies.get("refresh_token")
    if not tok:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    try:
        payload = _jwt.decode(tok, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Token inválido")
    except _jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    user = await db.users.find_one({"id": payload.get("sub")})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    access = create_access_token(user["id"], user["role"])
    new_refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, new_refresh)
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
        link = f"{FRONTEND_URL}/reset-password?token={token}"
        html = (
            f"<div style=\"font-family:Arial,sans-serif;max-width:520px;margin:auto\">"
            f"<h2 style=\"color:#FF6A00\">OFF360 — Redefinição de senha</h2>"
            f"<p>Olá, {user.get('name') or ''}!</p>"
            f"<p>Recebemos uma solicitação para redefinir a senha da sua conta OFF360. "
            f"Clique no botão abaixo para escolher uma nova senha. O link expira em 1 hora.</p>"
            f"<p style=\"margin:28px 0\"><a href=\"{link}\" "
            f"style=\"background:#FF6A00;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:bold\">Redefinir minha senha</a></p>"
            f"<p style=\"color:#666;font-size:13px\">Se você não solicitou, ignore este e-mail — sua senha continua a mesma.</p>"
            f"<p style=\"color:#999;font-size:12px\">Equipe OFF360</p></div>"
        )
        try:
            await send_email(to=email, subject="Redefinição de senha — OFF360", html=html)
        except Exception:
            pass  # não revela se o e-mail existe nem quebra o fluxo
    return {"ok": True, "message": "Se o e-mail existir, um link de recuperação foi enviado."}


class ChangePwInput(BaseModel):
    current_password: str
    new_password: str


class ResetDirectInput(BaseModel):
    email: str
    current_password: str
    new_password: str


@router.post("/reset-password-direct")
async def reset_direct(payload: ResetDirectInput):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.current_password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="E-mail ou senha atual incorretos")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter ao menos 6 caracteres")
    if verify_password(payload.new_password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da atual")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(payload.new_password), "must_change_password": False,
    }})
    return {"ok": True}


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
