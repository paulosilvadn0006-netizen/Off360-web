import os
from core import db, hash_password, verify_password, new_id, now_iso

CATEGORIES = [
    ("Alimentação", "UtensilsCrossed"), ("Beleza", "Scissors"), ("Saúde", "HeartPulse"),
    ("Academia", "Dumbbell"), ("Serviços", "Wrench"), ("Moda", "Shirt"),
    ("Automóveis", "Car"), ("Educação", "GraduationCap"), ("Lazer", "PartyPopper"),
    ("Empregos", "Briefcase"),
]

# Owner temporary password (forced change on first login). Documented in test_credentials.md.
OWNER_EMAIL = "paulo@off360.com"
OWNER_TEMP_PASSWORD = "Paulo@360"


async def migrate():
    # Ensure establishments carry the structured discount + subscription fields (non-destructive).
    defaults = {
        "discount_configured": False, "payment_method": None, "auto_renew": True, "cancel_date": None,
        "discount_min_purchase": None, "discount_max_cap": None, "discount_participating": "",
        "discount_excluded": "", "discount_valid_days": "", "discount_valid_hours": "",
        "discount_start_date": None, "discount_end_date": None, "discount_cumulative": False,
        "discount_observations": "",
        "validation_mode": "controlled",
    }
    ests = await db.establishments.find({}).to_list(5000)
    for e in ests:
        upd = {k: v for k, v in defaults.items() if k not in e}
        if e.get("subscription_status") is None:
            upd["subscription_status"] = "pending"
        if upd:
            await db.establishments.update_one({"id": e["id"]}, {"$set": upd})


async def seed():
    # ---- Owner (super_admin) — idempotent, never overwritten once created ----
    if not await db.users.find_one({"email": OWNER_EMAIL}):
        await db.users.insert_one({
            "id": new_id(), "role": "super_admin", "name": "Proprietário OFF 360",
            "email": OWNER_EMAIL, "phone": "", "password_hash": hash_password(OWNER_TEMP_PASSWORD),
            "photo_url": None, "account_status": "active", "must_change_password": True,
            "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
        })

    # ---- Legacy env admin (kept for compatibility, not overwritten) ----
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "id": new_id(), "role": "admin", "name": "Administrador OFF 360",
            "email": admin_email, "phone": "", "password_hash": hash_password(admin_password or new_id()),
            "photo_url": None, "account_status": "active", "created_at": now_iso(),
            "last_access": now_iso(), "last_activity": now_iso(),
        })

    # ---- Deactivate the broken demo admin (keep record for audit) ----
    await db.users.update_one({"email": "admin@off360.com"}, {"$set": {"account_status": "suspended"}})

    # ---- Categories (preserved brand data) ----
    if await db.categories.count_documents({}) == 0:
        for i, (name, icon) in enumerate(CATEGORIES):
            await db.categories.insert_one({
                "id": new_id(), "name": name, "icon": icon, "image_url": None,
                "status": "active", "order": i,
            })

    # ---- Global settings (prices intentionally undefined until admin configures) ----
    if await db.settings.find_one({"id": "global"}) is None:
        await db.settings.insert_one({
            "id": "global", "consumer_plan_price": None, "merchant_plan_price": None,
            "ticket_rule_type": "per_confirmed_purchase", "ticket_rule_value": 1,
            "promo_period": None, "coupon": None,
        })
    # NOTE: No demo consumers/merchants/establishments/transactions/stories/tickets are seeded.
