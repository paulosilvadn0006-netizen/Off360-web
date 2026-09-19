"""Migração: limpa taxi_location de motoristas com a coordenada de teste (-22.7305 / -47.3285)."""
import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
TEST_LAT, TEST_LNG = -22.7305, -47.3285


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    q = {"taxi_location.lat": TEST_LAT, "taxi_location.lng": TEST_LNG}
    before = await db.users.count_documents(q)
    res = await db.users.update_many(q, {"$unset": {"taxi_location": ""}})
    after = await db.users.count_documents(q)
    print(f"encontrados_antes={before} modificados={res.modified_count} restantes_apos={after}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
