import uuid
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Header, Query, Response
from core import (db, get_current_user, new_id, now_iso, strip_id)
from storage import put_object, get_object, APP_NAME, MIME_TYPES

router = APIRouter(prefix="/api", tags=["common"])


@router.get("/categories")
async def list_categories():
    cats = await db.categories.find({"status": "active"}).sort("order", 1).to_list(100)
    return [strip_id(c) for c in cats]


@router.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "bin"
    content_type = MIME_TYPES.get(ext, file.content_type or "application/octet-stream")
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, content_type)
    rec_id = new_id()
    await db.files.insert_one({
        "id": rec_id, "storage_path": result["path"], "original_filename": file.filename,
        "content_type": content_type, "size": result.get("size"),
        "owner_id": user["id"], "is_deleted": False, "created_at": now_iso(),
    })
    return {"id": rec_id, "path": result["path"], "url": f"/api/files/{result['path']}"}


@router.get("/files/{path:path}")
async def download(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    data, content_type = get_object(path)
    return Response(content=data, media_type=record.get("content_type", content_type),
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/notifications")
async def notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"recipient_id": user["id"]}).sort("created_at", -1).to_list(100)
    unread = sum(1 for i in items if not i.get("read"))
    return {"items": [strip_id(i) for i in items], "unread": unread}


@router.post("/notifications/{nid}/read")
async def read_notification(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "recipient_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"recipient_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.get("/raffles/current")
async def current_raffle():
    r = await db.raffles.find_one({"status": "active"})
    return strip_id(r) if r else None


@router.get("/raffles/previous")
async def previous_raffles():
    items = await db.raffles.find({"status": "finished"}).sort("draw_date", -1).to_list(50)
    return [strip_id(i) for i in items]
