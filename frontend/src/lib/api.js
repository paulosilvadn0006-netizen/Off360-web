import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Recupera a sessão automaticamente quando o token de acesso expira (usa o refresh de 7 dias),
// evitando logouts inesperados por expiração ou blips transitórios do backend.
let _refreshing = null;
// Endpoints que NÃO devem disparar refresh (evita loop). /auth/me PRECISA renovar.
const NO_REFRESH = ["/auth/refresh", "/auth/login", "/auth/register", "/auth/logout"];
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const orig = error?.config || {};
    const status = error?.response?.status;
    const url = orig?.url || "";
    const skip = NO_REFRESH.some((p) => url.includes(p));
    if (status === 401 && !orig._retry && !skip) {
      orig._retry = true;
      try {
        _refreshing = _refreshing || api.post("/auth/refresh");
        await _refreshing;
        _refreshing = null;
        return api(orig);
      } catch (e) {
        _refreshing = null;
      }
    }
    return Promise.reject(error);
  }
);

export function formatApiError(err, fallback) {
  // Detalhe técnico completo apenas no log interno (console), nunca na tela.
  try { console.error("[OFF360 API error]", err?.response?.status, err?.response?.data ?? err?.message); } catch (_) {}
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  // Mensagens amigáveis vindas do backend (pt-BR) chegam como string em detail.
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const s = detail.map((e) => (e && typeof e.msg === "string" ? e.msg : "")).filter(Boolean).join(" ");
    if (s) return s;
  }
  if (detail && typeof detail.msg === "string") return detail.msg;
  // Sem detail: nunca expor mensagens técnicas do Axios.
  if (err && err.response === undefined)
    return fallback || "Não foi possível conectar ao servidor. Seus dados foram preservados. Verifique sua conexão e tente novamente.";
  if (status === 404) return fallback || "Registro não encontrado. Atualize a página e tente novamente.";
  if (status >= 500) return fallback || "Ocorreu um erro no servidor. Seus dados foram preservados. Tente novamente.";
  return fallback || "Não foi possível concluir a ação. Seus dados foram preservados. Tente novamente.";
}

export function fileUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${BACKEND_URL}${url}`;
}

export async function uploadFile(file) {
  // Cria o FormData a cada tentativa (evita corpo consumido em retry) e tolera blips de rede.
  const doUpload = async () => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
    return data;
  };
  try {
    return await doUpload();
  } catch (err) {
    // Sem resposta do servidor (Network Error / blip de sessão): tenta 1x novamente.
    if (err && err.response === undefined) {
      await new Promise((r) => setTimeout(r, 1200));
      return await doUpload();
    }
    throw err;
  }
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
