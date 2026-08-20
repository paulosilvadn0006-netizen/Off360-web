// Alerta por vibração: 1s vibrando + 1s de pausa, em loop, respeitando suporte do navegador.
const MUTE = "off360_taxi_vibmute";
let muted = typeof localStorage !== "undefined" && localStorage.getItem(MUTE) === "1";
let timer = null;

export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(MUTE, muted ? "1" : "0"); } catch (_) {}
  if (muted) stop();
}
export function start() {
  if (muted || timer || typeof navigator === "undefined" || !navigator.vibrate) return;
  const cycle = () => { try { navigator.vibrate([1000]); } catch (_) {} };
  cycle();
  timer = setInterval(cycle, 2000); // 1s vibra + 1s pausa
}
export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (_) {}
}
export function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission !== "denied") Notification.requestPermission();
  } catch (_) {}
}
