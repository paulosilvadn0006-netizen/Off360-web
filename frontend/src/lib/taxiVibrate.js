// Alerta de nova corrida via VIBRAÇÃO nativa do navegador (sem áudio).
// Ciclo: 2s de vibração + 1s de intervalo (navigator.vibrate([2000, 1000])).
// Motorista: repete continuamente até parar. Passageiro: repete 3 vezes.
const VIB_KEY = "off360_taxi_vib";
const stored = typeof localStorage !== "undefined" ? localStorage.getItem(VIB_KEY) : null;
let vibEnabled = stored === null ? true : stored === "1"; // padrão: ligado
let vibTimer = null;
let primed = false;

const CYCLE = [2000, 1000]; // 2s vibra, 1s pausa
const CYCLE_MS = 3000;

function doVibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
}

// Libera a vibração após o primeiro gesto do usuário (restrição dos navegadores mobile).
export function primeVibration() {
  if (primed || typeof document === "undefined") return;
  const unlock = () => {
    try { navigator.vibrate && navigator.vibrate(0); } catch (_) {}
    primed = true;
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("touchstart", unlock, { once: true });
}
// Alias de compatibilidade (o áudio foi removido).
export const primeAudio = primeVibration;

export const isVibEnabled = () => vibEnabled;
export function setVibEnabled(v) {
  vibEnabled = !!v;
  try { localStorage.setItem(VIB_KEY, vibEnabled ? "1" : "0"); } catch (_) {}
  if (!vibEnabled) stop();
}

// MOTORISTA: vibra em ciclos 2s on / 1s off, continuamente até stop().
export function startDriver() {
  if (!vibEnabled || vibTimer) return;
  doVibrate(CYCLE);
  vibTimer = setInterval(() => doVibrate(CYCLE), CYCLE_MS);
}

// PASSAGEIRO: vibra em ciclos 2s on / 1s off, exatamente 3 vezes.
export function startPassenger() {
  if (vibTimer) return;
  let count = 1;
  doVibrate(CYCLE);
  vibTimer = setInterval(() => {
    if (count >= 3) { stop(); return; }
    doVibrate(CYCLE);
    count += 1;
  }, CYCLE_MS);
}

export function stop() {
  if (vibTimer) { clearInterval(vibTimer); vibTimer = null; }
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (_) {}
}

export function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") Notification.requestPermission();
  } catch (_) {}
}
