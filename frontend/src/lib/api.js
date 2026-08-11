import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Algo deu errado. Tente novamente.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function fileUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${BACKEND_URL}${url}`;
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export function readImageMeta(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Validates type/size/min-dimensions, then uploads. Throws Error with a friendly message.
export async function uploadImageValidated(file, { maxMB = 5, minW = 0, minH = 0 } = {}) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Formato inválido. Envie PNG, JPG, JPEG ou WebP.");
  if (file.size > maxMB * 1024 * 1024) throw new Error(`Imagem muito grande. Limite de ${maxMB} MB.`);
  const meta = await readImageMeta(file);
  if (meta && (meta.w < minW || meta.h < minH)) throw new Error(`Resolução baixa. Mínimo ${minW} × ${minH} px.`);
  return uploadFile(file);
}
