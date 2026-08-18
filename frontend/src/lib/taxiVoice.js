// Anúncio de chegada por voz do navegador (pt-BR). Sem dependência de arquivo de áudio.
const MUTE_KEY = "off360_taxi_mute";

let muted = typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (_) {}
}

export function announceArrival() {
  // Áudio de chegada removido a pedido do produto. O aviso visual cobre a chegada.
  // (A vibração é tratada por taxiVibrate.js e permanece inalterada.)
}
