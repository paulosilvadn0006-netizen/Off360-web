from datetime import timedelta
from core import db, hash_password, new_id, now_iso, now_utc

CATEGORIES = [
    ("Alimentação", "UtensilsCrossed"), ("Beleza", "Scissors"), ("Saúde", "HeartPulse"),
    ("Academia", "Dumbbell"), ("Serviços", "Wrench"), ("Moda", "Shirt"),
    ("Automóveis", "Car"), ("Educação", "GraduationCap"), ("Lazer", "PartyPopper"),
    ("Empregos", "Briefcase"),
]

DEMO_ESTS = [
    ("Cafeteria Grão Nobre", "Alimentação", 15, "Café especial e brunch artesanal no coração do bairro.", "Centro"),
    ("Barbearia Navalha de Ouro", "Beleza", 20, "Cortes modernos, barba e cuidados masculinos.", "Jardim América"),
    ("Academia PowerFit", "Academia", 25, "Musculação, cross e aulas coletivas.", "Vila Nova"),
    ("Farmácia Vida Plena", "Saúde", 10, "Medicamentos e produtos de saúde com desconto.", "Centro"),
    ("Boutique Estilo Urbano", "Moda", 18, "Moda masculina e feminina com peças exclusivas.", "Jardim América"),
    ("Auto Center Turbo", "Automóveis", 12, "Troca de óleo, revisão e mecânica geral.", "Industrial"),
]


async def seed():
    # Admin is seeded in server startup via env. Seed demo data if empty.
    import os
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "id": new_id(), "role": "admin", "name": "Administrador OFF 360",
            "email": admin_email, "phone": "", "password_hash": hash_password(admin_password),
            "photo_url": None, "account_status": "active", "created_at": now_iso(),
            "last_access": now_iso(), "last_activity": now_iso(),
        })

    # Dedicated DEMO admin account (non-personal, temporary password, forced change on first login)
    demo_admin_email = "admin@off360.com"
    if not await db.users.find_one({"email": demo_admin_email}):
        await db.users.insert_one({
            "id": new_id(), "role": "admin", "name": "Admin Demonstração",
            "email": demo_admin_email, "phone": "", "password_hash": hash_password("OffAdmin@Temp1"),
            "photo_url": None, "account_status": "active", "must_change_password": True,
            "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
        })

    if await db.categories.count_documents({}) == 0:
        for i, (name, icon) in enumerate(CATEGORIES):
            await db.categories.insert_one({
                "id": new_id(), "name": name, "icon": icon, "image_url": None,
                "status": "active", "order": i,
            })

    if await db.settings.find_one({"id": "global"}) is None:
        await db.settings.insert_one({
            "id": "global", "consumer_plan_price": None, "merchant_plan_price": None,
            "ticket_rule_type": "per_confirmed_purchase", "ticket_rule_value": 1,
            "promo_period": None, "coupon": None,
        })

    if await db.raffles.count_documents({}) == 0:
        await db.raffles.insert_one({
            "id": new_id(), "name": "Sorteio de R$ 200 do bairro", "prize": "R$ 200 em compras",
            "draw_date": (now_utc() + timedelta(days=20)).isoformat(),
            "rules": "Cada compra confirmada gera 1 bilhete. (DEMONSTRAÇÃO - editável pelo admin)",
            "status": "active", "created_at": now_iso(), "winner": None,
        })

    # Test consumer
    consumer = await db.users.find_one({"email": "consumidor@off360.com"})
    if not consumer:
        cid = new_id()
        await db.users.insert_one({
            "id": cid, "role": "consumer", "name": "Consumidor Demonstração",
            "email": "consumidor@off360.com", "phone": "+5511999990001",
            "password_hash": hash_password("senha123"), "photo_url": None,
            "city": "São Paulo", "neighborhood": "Centro", "account_status": "active",
            "subscription_status": "active", "subscription_start": now_iso(),
            "next_due": (now_utc() + timedelta(days=25)).isoformat(),
            "total_saved": 0.0, "total_spent": 0.0, "ticket_count": 0, "favorites": [],
            "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
            "data_consent": True,
        })
        consumer = await db.users.find_one({"id": cid})

    cats = await db.categories.find({}).to_list(100)
    cat_by_name = {c["name"]: c for c in cats}

    # Test merchant (first demo establishment owner) + demo establishments
    if await db.establishments.count_documents({}) == 0:
        for idx, (fname, cat, disc, desc, hood) in enumerate(DEMO_ESTS):
            if idx == 0:
                email = "empresario@off360.com"
                pwd = "senha123"
                owner_name = "Empresário Demonstração"
                sub = "active"
            else:
                email = f"parceiro{idx}@off360.com"
                pwd = "senha123"
                owner_name = f"Responsável {fname}"
                sub = "active"
            owner_id = new_id()
            await db.users.insert_one({
                "id": owner_id, "role": "merchant", "name": owner_name, "email": email,
                "phone": f"+55119888800{idx}", "password_hash": hash_password(pwd),
                "photo_url": None, "city": "São Paulo", "neighborhood": hood,
                "account_status": "active", "subscription_status": sub,
                "subscription_start": now_iso(),
                "next_due": (now_utc() + timedelta(days=25)).isoformat(),
                "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
                "data_consent": True,
            })
            c = cat_by_name.get(cat)
            eid = new_id()
            await db.establishments.insert_one({
                "id": eid, "owner_id": owner_id, "responsible_name": owner_name,
                "phone": f"+55119888800{idx}", "email": email, "fantasy_name": fname,
                "category_id": c["id"] if c else None, "category_name": cat,
                "description": desc, "logo_url": None, "cover_url": None, "gallery": [],
                "address": f"Rua Exemplo, {100+idx} - {hood}", "neighborhood": hood, "city": "São Paulo",
                "lat": -23.55 + idx * 0.01, "lng": -46.63 + idx * 0.01,
                "hours": "Seg-Sáb 09:00-19:00", "whatsapp": f"55119888800{idx}",
                "instagram": f"@{fname.lower().replace(' ', '')}", "discount_percent": disc,
                "discount_rules": "Válido para pagamentos à vista. Não cumulativo.",
                "qr_token": new_id(), "approval_status": "approved", "subscription_status": sub,
                "subscription_start": now_iso(), "next_due": (now_utc() + timedelta(days=25)).isoformat(),
                "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
            })
            # a demo story for first few
            if idx < 3:
                await db.stories.insert_one({
                    "id": new_id(), "establishment_id": eid, "establishment_name": fname,
                    "category": "offer", "title": "Oferta do dia!",
                    "text": f"Aproveite {disc}% de desconto hoje na {fname}. (DEMONSTRAÇÃO)",
                    "media_url": None, "media_type": "image", "whatsapp_link": None,
                    "created_at": now_iso(), "expires_at": (now_utc() + timedelta(hours=24)).isoformat(),
                    "status": "active", "views": idx * 3,
                })

    # Demo confirmed transactions for the test consumer at first establishment
    if await db.transactions.count_documents({}) == 0 and consumer:
        est = await db.establishments.find_one({"fantasy_name": "Cafeteria Grão Nobre"})
        if est:
            for i, gross in enumerate([50.0, 80.0, 35.0]):
                disc = round(gross * est["discount_percent"] / 100, 2)
                final = round(gross - disc, 2)
                ts = (now_utc() - timedelta(days=i * 3)).isoformat()
                await db.transactions.insert_one({
                    "id": new_id(), "consumer_id": consumer["id"], "consumer_name": consumer["name"],
                    "consumer_photo": None, "establishment_id": est["id"],
                    "establishment_name": est["fantasy_name"], "merchant_owner_id": est["owner_id"],
                    "gross_amount": gross, "discount_percent": est["discount_percent"],
                    "discount_amount": disc, "saved_amount": disc, "final_amount": final,
                    "created_at": ts, "status": "confirmed", "confirmed_by": est["owner_id"],
                    "confirmed_at": ts, "transaction_code": f"OFF-DEMO{i}", "validation_token": None,
                    "token_expires_at": ts, "device": "web",
                })
            await db.users.update_one({"id": consumer["id"]}, {"$set": {
                "total_saved": round(sum([50, 80, 35][j] * est["discount_percent"] / 100 for j in range(3)), 2),
                "total_spent": round(sum([50, 80, 35][j] * (1 - est["discount_percent"] / 100) for j in range(3)), 2),
                "ticket_count": 3,
            }})
            raffle = await db.raffles.find_one({"status": "active"})
            for i in range(3):
                await db.tickets.insert_one({
                    "id": new_id(), "consumer_id": consumer["id"], "transaction_id": "demo",
                    "campaign": raffle["name"] if raffle else "Sorteio", "number": f"DEMO-{1000+i}",
                    "created_at": now_iso(), "status": "valid",
                })
