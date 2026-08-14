// Controlador único e leve de alerta sonoro para novas entregas do entregador.
// Usa Web Audio API (sem arquivos de áudio, sem bibliotecas). Padrão:
// 3 toques (~2s cada, pequeno intervalo) -> pausa 5s -> repete enquanto ativo.
// Respeita a política de autoplay: só toca depois de unlock() disparado por gesto do usuário.

let ctx = null;
let playing = false;
let stopFlag = true;
let timers = [];

const TOQUE_S = 2;      // duração de cada toque (~2s)
const GAP_MS = 250;     // pequeno intervalo entre toques consecutivos
const PAUSA_MS = 5000;  // pausa de 5s após os 3 toques

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

export function isPlaying() {
  return playing;
}

// Deve ser chamado a partir de um gesto do usuário (clique/toque) para liberar o áudio.
export async function unlock() {
  const c = ensureCtx();
  if (!c) return false;
  try { await c.resume(); } catch (e) { /* ignore */ }
  // blip inaudível para destravar em iOS/Safari
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.02);
  } catch (e) { /* ignore */ }
  return c.state === "running";
}

function beep() {
  const c = ensureCtx();
  if (!c || c.state !== "running") return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = 880;
  const t = c.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.05);
  g.gain.setValueAtTime(0.22, t + TOQUE_S - 0.08);
  g.gain.linearRampToValueAtTime(0, t + TOQUE_S);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + TOQUE_S + 0.02);
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function cycle() {
  if (stopFlag) return;
  const toqueMs = TOQUE_S * 1000;
  beep();
  timers.push(setTimeout(() => { if (!stopFlag) beep(); }, toqueMs + GAP_MS));
  timers.push(setTimeout(() => { if (!stopFlag) beep(); }, 2 * (toqueMs + GAP_MS)));
  const total = 3 * toqueMs + 2 * GAP_MS + PAUSA_MS;
  timers.push(setTimeout(() => { if (!stopFlag) cycle(); }, total));
}

// Inicia o loop. Idempotente: nunca sobrepõe áudios (controlador único).
export function start() {
  if (playing) return;
  if (!isRunning()) return; // áudio ainda não liberado pelo usuário
  stopFlag = false;
  playing = true;
  cycle();
}

// Para imediatamente.
export function stop() {
  stopFlag = true;
  playing = false;
  clearTimers();
}
