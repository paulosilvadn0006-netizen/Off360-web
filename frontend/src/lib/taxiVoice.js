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
  if (muted) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance("bi bi bi, cheguei!");
    u.lang = "pt-BR";
    u.rate = 1;
    u.pitch = 1.15;
    synth.speak(u);
  } catch (_) { /* navegador sem suporte: aviso visual cobre */ }
}
