// Captura de uma "fala" (utterance) com detecção de silêncio (VAD simples via Web Audio).
// Resolve quando o usuário para de falar, quando há silêncio prolongado (inatividade),
// ao atingir a duração máxima, ou quando getActive() retorna false (encerramento externo).
export async function recordUtterance({ getActive, silenceMs = 800, inactivityMs = 9000, maxMs = 15000, minSpeechMs = 300 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mr = new MediaRecorder(stream);
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const srcNode = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  srcNode.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  const start = Date.now();
  let speechStarted = false;
  let lastSpeech = Date.now();
  let reason = "speech";
  const THRESH = 10; // amplitude (0-128) acima da qual consideramos "fala"

  return await new Promise((resolve) => {
    let poll = null;
    const cleanup = () => {
      try { if (poll) clearInterval(poll); } catch (e) { /* noop */ }
      try { srcNode.disconnect(); } catch (e) { /* noop */ }
      try { ac.close(); } catch (e) { /* noop */ }
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
    };
    let resolved = false;
    const done = (blob, r) => { if (resolved) return; resolved = true; cleanup(); resolve({ blob, reason: r }); };

    mr.onstop = () => done(new Blob(chunks, { type: "audio/webm" }), reason);

    const safeStop = () => {
      try { if (mr.state !== "inactive") mr.stop(); else done(new Blob(chunks, { type: "audio/webm" }), reason); }
      catch (e) { done(null, "error"); }
    };

    poll = setInterval(() => {
      if (getActive && !getActive()) { reason = "aborted"; safeStop(); return; }
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128); if (v > peak) peak = v; }
      const now = Date.now();
      if (peak > THRESH) { speechStarted = true; lastSpeech = now; }
      if (!speechStarted && now - start > inactivityMs) { reason = "inactivity"; safeStop(); return; }
      if (speechStarted && now - lastSpeech > silenceMs && now - start > minSpeechMs) { reason = "speech"; safeStop(); return; }
      if (now - start > maxMs) { reason = speechStarted ? "speech" : "inactivity"; safeStop(); return; }
    }, 120);

    try { mr.start(); } catch (e) { done(null, "error"); }
  });
}

const STOP_WORDS = ["encerrar", "pode encerrar", "pode fechar", "fechar copiloto", "fecha copiloto",
  "obrigado, tchau", "obrigada, tchau", "obrigado tchau", "obrigada tchau", "tchau", "até logo", "ate logo",
  "parar", "pare", "desligar", "sair do modo voz"];

export function isStopCommand(text) {
  const s = (text || "").toLowerCase().trim();
  return STOP_WORDS.some((w) => s === w || s.includes(w));
}
