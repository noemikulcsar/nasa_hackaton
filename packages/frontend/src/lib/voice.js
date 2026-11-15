/**
 * Voice alerts.
 *
 * A short two-tone attention signal, then the computer's own speech engine says the crew member's
 * name and the problem ("Critical alert. Amara Okafor. Blood oxygen critically low."). Speech runs
 * on the device (no internet), so it works on board. Word-boundary events let the screen highlight
 * each word as it is spoken.
 *
 * Browsers allow sound only after the user has interacted with the page once, so `unlock()` is
 * called on the first click or key press.
 */

let ctx = null;
let unlocked = false;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(unlocked));
export const onUnlockChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const isUnlocked = () => unlocked;
export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function unlock() {
  if (unlocked) return;
  try {
    ctx = ctx ?? new (window.AudioContext || window.webkitAudioContext)();
    void ctx.resume();
  } catch { /* no Web Audio: the voice still works */ }
  if (speechSupported()) {
    // An empty utterance inside the user gesture unlocks speech for later.
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
  unlocked = true;
  notify();
}

/** Two descending tones, 0.6 s in total. */
function chime() {
  return new Promise((resolve) => {
    if (!ctx) return resolve();
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [660, 0.22], [880, 0.44]].forEach(([f, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.22);
    });
    setTimeout(resolve, 720);
  });
}

/** Prefers an English voice that runs on the device (works without internet). */
function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return en.find((v) => v.localService && /en-(GB|US)/i.test(v.lang)) ?? en.find((v) => v.localService) ?? en[0] ?? null;
}

/**
 * Plays the attention signal and speaks the text.
 * onWord(charIndex) is called as each word starts; resolves when speech ends.
 */
export async function announce(text, { onWord, onStart, onEnd } = {}) {
  if (!unlocked) return false;
  onStart?.();
  await chime();
  if (!speechSupported()) { onEnd?.(); return true; }
  await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-GB';
    u.rate = 0.92;
    u.pitch = 1;
    u.volume = 1;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    u.onboundary = (e) => { if (e.name === 'word' || e.name === undefined) onWord?.(e.charIndex); };
    u.onend = finish;
    u.onerror = finish;
    // Some engines never fire `end`: stop waiting after a generous estimate.
    setTimeout(finish, 1500 + text.split(' ').length * 550);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
  onEnd?.();
  return true;
}

export const alertSentence = (a) => (a.repeats > 0
  ? `Critical alert, still active. ${a.name}. ${a.condition}.`
  : `Critical alert. ${a.name}. ${a.condition}.`);
/** "Heart rate critically high" → "Update. Elena Voss. Heart rate back within range." */
export const recoverySentence = (a) => `Update. ${a.name}. ${a.condition.replace(/\s+(critically|slightly)?\s*(high|low)$/i, '')} back within range.`;
