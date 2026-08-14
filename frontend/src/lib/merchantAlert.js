// Aviso sonoro CURTO (one-shot) de "Novo pedido OFF360" para o empresário.
// Web Audio API, sem arquivos e sem bibliotecas. Toca poucos toques e para.
// Respeita a política de autoplay: só toca após unlock() disparado por gesto do usuário.

let ctx = null;
let timers = [];

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function isRunning() {
  return !!ctx && ctx.state === "running";
}

export async function unlock() {
  const c = ensureCtx();
  if (!c) return false;
  try { await c.resume(); } catch (e) { /* ignore */ }
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.02);
  } catch (e) { /* ignore */ }
  return c.state === "running";
}

function beep(freq, dur) {
  const c = ensureCtx();
  if (!c || c.state !== "running") return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  const t = c.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.02);
  g.gain.setValueAtTime(0.25, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// Toca um aviso curto (2 toques ascendentes ~0.6s no total) e para. NÃO fica em loop.
export function playChime() {
  if (!isRunning()) return;
  stop();
  beep(660, 0.22);
  timers.push(setTimeout(() => beep(880, 0.28), 260));
}

export function stop() {
  timers.forEach(clearTimeout);
  timers = [];
}
