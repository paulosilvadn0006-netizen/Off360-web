"""Migração: renomeia taxi_categories.*.up_to_2km -> up_to_3km no documento de settings."""
import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    changed = 0
    async for s in db.settings.find({}):
        cats = s.get("taxi_categories")
        if not isinstance(cats, dict):
            continue
        touched = False
        for c, v in cats.items():
            if isinstance(v, dict) and "up_to_2km" in v:
                v["up_to_3km"] = v.pop("up_to_2km")
                touched = True
        if touched:
            await db.settings.update_one({"_id": s["_id"]}, {"$set": {"taxi_categories": cats}})
            changed += 1
    print(f"settings_migrados={changed}")
    # verificação
    remaining = 0
    async for s in db.settings.find({}):
        cats = s.get("taxi_categories") or {}
        for v in cats.values():
            if isinstance(v, dict) and "up_to_2km" in v:
                remaining += 1
    print(f"restantes_com_up_to_2km={remaining}")


if __name__ == "__main__":
    asyncio.run(main())
