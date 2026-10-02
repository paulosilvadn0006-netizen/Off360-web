from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
import secrets
import os
import requests

from core import (db, hash_password, verify_password, create_access_token, create_refresh_token,
                  set_auth_cookies, clear_auth_cookies, get_current_user, new_id, now_iso, now_utc,
                  strip_id, log_activity, create_notification, normalize_phone,
                  get_jwt_secret, JWT_ALGORITHM)
from emailer import send_email
import jwt as _jwt
from datetime import timedelta, datetime, timezone

router = APIRouter(prefix="/api/auth", tags=["auth"])
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    password: str
    role: str  # consumer | merchant
    cpf: Optional[str] = None
    city: Optional[str] = ""
    neighborhood: Optional[str] = ""
    address_street: Optional[str] = ""
    address_number: Optional[str] = ""
    address_neighborhood: Optional[str] = ""
    address_city: Optional[str] = ""
    address_complement: Optional[str] = ""
    address_uf: Optional[str] = ""
    cep: Optional[str] = ""
    birth_date: Optional[str] = ""
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


def valid_cpf(cpf):
    d = "".join(ch for ch in (cpf or "") if ch.isdigit())
    if len(d) != 11 or d == d[0] * 11:
        return False
    for i in (9, 10):
        s = sum(int(d[j]) * ((i + 1) - j) for j in range(i))
        r = (s * 10) % 11
        if r == 10:
            r = 0
        if r != int(d[i]):
            return False
    return True


@router.post("/register")
async def register(payload: RegisterInput, response: Response):
    if payload.role not in ("consumer", "merchant", "deliverer"):
        raise HTTPException(status_code=400, detail="Perfil inválido")
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    phone = normalize_phone(payload.phone) if payload.phone else ""
    if payload.role != "merchant" and len(phone) not in (10, 11):
        raise HTTPException(status_code=400, detail="Telefone incompleto. Informe DDD + número, ex: (19) 99999-9999.")
    if payload.role == "merchant" and payload.phone and len(phone) not in (10, 11):
        raise HTTPException(status_code=400, detail="Telefone inválido. Informe DDD + número.")
    cpf_digits = ""
    if payload.role == "consumer":
        if not valid_cpf(payload.cpf):
            raise HTTPException(status_code=400, detail="CPF inválido. Verifique os 11 dígitos.")
        cpf_digits = "".join(ch for ch in payload.cpf if ch.isdigit())
    elif payload.role == "merchant" and payload.cpf:
        if not valid_cpf(payload.cpf):
            raise HTTPException(status_code=400, detail="CPF inválido. Verifique os 11 dígitos.")
        cpf_digits = "".join(ch for ch in payload.cpf if ch.isdigit())

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
        "address_uf": (payload.address_uf or "").upper()[:2],
        "cep": "".join(ch for ch in (payload.cep or "") if ch.isdigit()),
        "birth_date": payload.birth_date or "",
        "account_status": "active",
        "cpf": cpf_digits,
        "created_at": now_iso(),
        "last_access": now_iso(),
        "last_activity": now_iso(),
        "data_consent": True,
        "email_verified": payload.role != "merchant",
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

    # Verificação de e-mail obrigatória para empresário (e-mail/senha)
    if payload.role == "merchant":
        token = secrets.token_urlsafe(32)
        await db.users.update_one({"id": uid}, {"$set": {"email_verify_token": token, "email_verify_sent_at": now_iso()}})
        try:
            link = f"{FRONTEND_URL}/verify-email?token={token}"
            await send_email(to=email, subject="Confirme seu e-mail — OFF360",
                             html=_verify_email_html(payload.name, link))
        except Exception:
            pass

    access = create_access_token(uid, payload.role)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    await log_activity(user, "register", "auth")
    return strip_id(dict(user))


def _verify_email_html(name, link):
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0b1220">'
        '<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;border:1px solid #eee;border-radius:16px;overflow:hidden">'
        '<tr><td style="background:#FF7A00;padding:20px 24px;color:#fff"><h1 style="margin:0;font-size:20px">Bem-vindo à OFF360!</h1></td></tr>'
        '<tr><td style="padding:24px">'
        f'<p style="margin:0 0 10px">Olá, {name or "empresário"}!</p>'
        '<p style="margin:0 0 16px">Sua conta foi criada. Para ativar o acesso ao painel, confirme seu e-mail clicando no botão abaixo.</p>'
        f'<p style="margin:0 0 8px"><a href="{link}" style="display:inline-block;background:#FF7A00;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:bold">Confirmar meu e-mail</a></p>'
        '<p style="margin:16px 0 0;font-size:12px;color:#888">Se você não criou esta conta, ignore este e-mail. Nunca pedimos sua senha por e-mail.</p>'
        '</td></tr></table></td></tr></table>'
    )


class GoogleSessionInput(BaseModel):
    session_id: str
    role: Optional[str] = "consumer"


@router.post("/google/session")
async def google_session(payload: GoogleSessionInput, response: Response):
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    try:
        r = requests.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                         headers={"X-Session-ID": payload.session_id}, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception:
        raise HTTPException(status_code=401, detail="Falha ao validar a sessão do Google.")
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Sessão do Google inválida.")
    user = await db.users.find_one({"email": email})
    if not user:
        role = payload.role if payload.role in ("consumer", "merchant", "deliverer") else "consumer"
        uid = new_id()
        user = {
            "id": uid, "role": role, "name": data.get("name") or email.split("@")[0],
            "email": email, "phone": "", "password_hash": "", "photo_url": data.get("picture"),
            "auth_provider": "google", "city": "", "neighborhood": "", "address_street": "",
            "address_number": "", "address_neighborhood": "", "address_city": "", "address_complement": "",
            "address_uf": "", "cep": "", "birth_date": "", "cpf": "", "account_status": "active",
            "email_verified": True,
            "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(), "data_consent": True,
        }
        if role in ("consumer", "merchant"):
            user.update({"subscription_status": "pending", "subscription_start": None, "next_due": None})
        if role == "consumer":
            user.update({"total_saved": 0.0, "total_spent": 0.0, "ticket_count": 0, "favorites": []})
        if role == "deliverer":
            user.update({"vehicle": "moto", "works_fixed": False, "fixed_establishment_id": None})
        await db.users.insert_one(dict(user))
        await log_activity(user, "register_google", "auth")
    if user.get("account_status") == "suspended":
        raise HTTPException(status_code=403, detail="Conta suspensa. Contate o suporte.")
    access = create_access_token(user["id"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_access": now_iso()}})
    return strip_id(dict(user))


class VerifyEmailInput(BaseModel):
    token: str


def _is_expired(sent_at):
    if not sent_at:
        return False
    try:
        sent_dt = datetime.fromisoformat(str(sent_at).replace("Z", "+00:00"))
        if sent_dt.tzinfo is None:
            sent_dt = sent_dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - sent_dt > timedelta(hours=24)
    except Exception:
        return False


@router.post("/verify-email")
async def verify_email(payload: VerifyEmailInput, response: Response):
    user = await db.users.find_one({"email_verify_token": payload.token})
    if not user:
        raise HTTPException(status_code=400, detail="invalid")
    if _is_expired(user.get("email_verify_sent_at")):
        raise HTTPException(status_code=410, detail="expired")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}, "$unset": {"email_verify_token": "", "email_verify_sent_at": ""}})
    # Loga o usuário automaticamente para seguir ao painel
    access = create_access_token(user["id"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    user["email_verified"] = True
    return strip_id(dict(user))


@router.post("/resend-verification")
async def resend_verification(user=Depends(get_current_user)):
    if user.get("email_verified"):
        return {"ok": True, "already": True}
    token = secrets.token_urlsafe(32)
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verify_token": token, "email_verify_sent_at": now_iso()}})
    try:
        link = f"{FRONTEND_URL}/verify-email?token={token}"
        await send_email(to=user["email"], subject="Confirme seu e-mail — OFF360",
                         html=_verify_email_html(user.get("name"), link))
    except Exception:
        pass
    return {"ok": True}


class ResendByTokenInput(BaseModel):
    token: str


@router.post("/resend-verification-token")
async def resend_verification_token(payload: ResendByTokenInput):
    user = await db.users.find_one({"email_verify_token": payload.token})
    if not user:
        raise HTTPException(status_code=400, detail="Não foi possível identificar sua conta. Faça login para reenviar o e-mail.")
    if user.get("email_verified"):
        return {"ok": True, "already": True}
    token = secrets.token_urlsafe(32)
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verify_token": token, "email_verify_sent_at": now_iso()}})
    try:
        link = f"{FRONTEND_URL}/verify-email?token={token}"
        await send_email(to=user["email"], subject="Confirme seu e-mail — OFF360",
                         html=_verify_email_html(user.get("name"), link))
    except Exception:
        pass
    return {"ok": True}


class CompleteProfileInput(BaseModel):
    cpf: str
    phone: str
    cep: Optional[str] = ""
    address_street: Optional[str] = ""
    address_neighborhood: Optional[str] = ""
    address_city: Optional[str] = ""
    address_uf: Optional[str] = ""
    address_number: Optional[str] = ""
    address_complement: Optional[str] = ""


@router.post("/complete-profile")
async def complete_profile(payload: CompleteProfileInput, user=Depends(get_current_user)):
    if not valid_cpf(payload.cpf):
        raise HTTPException(status_code=400, detail="CPF inválido. Verifique os 11 dígitos.")
    phone = normalize_phone(payload.phone)
    if len(phone) not in (10, 11):
        raise HTTPException(status_code=400, detail="Telefone incompleto. Informe DDD + número.")
    if not (payload.cep or payload.address_street or payload.address_city):
        raise HTTPException(status_code=400, detail="Informe o endereço (CEP ou logradouro/cidade).")
    upd = {
        "cpf": "".join(ch for ch in payload.cpf if ch.isdigit()),
        "phone": phone,
        "cep": "".join(ch for ch in (payload.cep or "") if ch.isdigit()),
        "address_street": payload.address_street or "",
        "address_neighborhood": payload.address_neighborhood or "",
        "address_city": payload.address_city or "",
        "address_uf": (payload.address_uf or "").upper()[:2],
        "address_number": payload.address_number or "",
        "address_complement": payload.address_complement or "",
        "city": payload.address_city or user.get("city") or "",
        "profile_completed": True,
    }
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    fresh = await db.users.find_one({"id": user["id"]})
    return strip_id(dict(fresh))


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
            "expires_at": (now_utc() + timedelta(hours=24)).isoformat(),
            "used": False, "created_at": now_iso(),
        })
        link = f"{FRONTEND_URL}/reset-password?token={token}"
        html = (
            f"<div style=\"font-family:Arial,sans-serif;max-width:520px;margin:auto\">"
            f"<h2 style=\"color:#FF6A00\">OFF360 — Redefinição de senha</h2>"
            f"<p>Olá, {user.get('name') or ''}!</p>"
            f"<p>Recebemos uma solicitação para redefinir a senha da sua conta OFF360. "
            f"Clique no botão abaixo para escolher uma nova senha. O link expira em 24 horas.</p>"
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
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="invalid")
    if rec.get("expires_at", "") < now_iso():
        raise HTTPException(status_code=410, detail="expired")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_password(payload.password)}})
    await db.password_reset_tokens.update_one({"id": rec["id"]}, {"$set": {"used": True}})
    return {"ok": True}
