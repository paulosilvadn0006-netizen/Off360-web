// Alerta de nova corrida: som de gongo de boxe (arquivo livre) + vibração opcional.
// Motorista: gongo repetido a cada 60s. Passageiro: gongo a cada 3s ao ser aceito.
const VIB_KEY = "off360_taxi_vib";
let vibEnabled = typeof localStorage !== "undefined" && localStorage.getItem(VIB_KEY) === "1";
let soundTimer = null;
let audio = null;
let primed = false;

function getAudio() {
  if (!audio && typeof Audio !== "undefined") {
    audio = new Audio("/sounds/gong.mp3");
    audio.preload = "auto";
  }
  return audio;
}

// Libera o áudio no primeiro gesto do usuário (autoplay policy dos navegadores).
export function primeAudio() {
  if (primed || typeof document === "undefined") return;
  const unlock = () => {
    const a = getAudio();
    if (a) { a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; primed = true; }).catch(() => { a.muted = false; }); }
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

export const isVibEnabled = () => vibEnabled;
export function setVibEnabled(v) {
  vibEnabled = !!v;
  try { localStorage.setItem(VIB_KEY, vibEnabled ? "1" : "0"); } catch (_) {}
  if (!vibEnabled) { try { navigator.vibrate && navigator.vibrate(0); } catch (_) {} }
}

export function playGong() {
  const a = getAudio();
  if (!a) return;
  try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}

function buzz() {
  if (vibEnabled) { try { navigator.vibrate && navigator.vibrate([400, 150, 400]); } catch (_) {} }
}

// MOTORISTA: gongo + vibração agora e a cada 60s.
export function startDriver() {
  if (soundTimer) return;
  playGong(); buzz();
  soundTimer = setInterval(() => { playGong(); buzz(); }, 60000);
}

// PASSAGEIRO: gongo a cada 3s (sem vibração), avisando que um motorista aceitou.
export function startPassenger() {
  if (soundTimer) return;
  playGong();
  soundTimer = setInterval(playGong, 3000);
}

export function stop() {
  if (soundTimer) { clearInterval(soundTimer); soundTimer = null; }
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (_) {}
}

export function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") Notification.requestPermission();
  } catch (_) {}
}
