// ─── Alert sound ─────────────────────────────────────────────────────────────
// Located at: frontend/src/lib/alert.js
//
// If a custom sound file is uploaded via Settings → Geluid, it is passed in
// as `customUrl` and played via the HTML5 Audio API.
// Otherwise the synthesized fallback below is used.
//
// Synthesizer parameters — change these and redeploy to tweak the default:
const BEEPS     = 3;
const FREQ_HIGH = 1040;
const FREQ_LOW  = 780;
const BEEP_ON   = 0.18;
const BEEP_OFF  = 0.10;
const VOLUME    = 0.55;
const WAVE      = 'square'; // 'sine' | 'square' | 'sawtooth' | 'triangle'

export function playAlertSoft() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.setValueAtTime(0.25, t + 0.15);
    gain.gain.linearRampToValueAtTime(0, t + 0.22);
    osc.start(t);
    osc.stop(t + 0.25);
  } catch { /* AudioContext not available */ }
}

export function playAlert(customUrl = null) {
  // ── Custom uploaded sound ──
  if (customUrl) {
    try {
      const audio = new Audio(customUrl);
      audio.volume = 0.8;
      audio.play().catch(() => playFallback());
      return;
    } catch {
      /* fall through */
    }
  }
  playFallback();
}

function playFallback() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const step = BEEP_ON + BEEP_OFF;

    for (let i = 0; i < BEEPS; i++) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type            = WAVE;
      osc.frequency.value = i % 2 === 0 ? FREQ_HIGH : FREQ_LOW;

      const start = ctx.currentTime + i * step;
      const end   = start + BEEP_ON;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01);
      gain.gain.setValueAtTime(VOLUME, end - 0.04);
      gain.gain.linearRampToValueAtTime(0, end);

      osc.start(start);
      osc.stop(end);
    }
  } catch { /* AudioContext not available */ }
}
