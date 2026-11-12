import { useEffect, useState } from "preact/hooks";

// Game sound effects (CC0, from Openverse; see public/sfx/CREDITS.md).
// Browsers only allow sound after someone has clicked or tapped the page, so
// nothing plays until the first click; the projector shows a hint until then.
export type Sfx =
  | "question_start"
  | "tick"
  | "time_up"
  | "submit"
  | "join"
  | "drumroll"
  | "needle_sweep"
  | "correct"
  | "incorrect"
  | "hp_down"
  | "hp_low"
  | "fanfare"
  | "fanfare_first"; // 1位: the fanfare twice, higher, longer and louder

const VOLUME: Partial<Record<Sfx, number>> = { tick: 0.5, join: 0.6, hp_low: 0.7 };
const KEY = "sound-on";

let ctx: AudioContext | null = null;
const buffers = new Map<Sfx, Promise<AudioBuffer | null>>();
const listeners = new Set<() => void>();
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "0";
  } catch {
    return false;
  }
})();

const notify = () => listeners.forEach((f) => f());

function load(name: Sfx): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    const c = ctx!;
    p = fetch(`/sfx/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => c.decodeAudioData(b))
      .catch(() => null); // a missing sound just stays silent
    buffers.set(name, p);
  }
  return p;
}

// Call from a click or tap. Creates the audio context and fetches the sounds.
export function unlockSound(preload: readonly Sfx[]) {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    ctx.onstatechange = notify;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  preload.forEach(load);
  notify();
}

// rate > 1 plays higher and faster (2位 uses the 3位 fanfare at 1.12).
export function play(name: Sfx, rate = 1) {
  if (muted || !ctx || ctx.state !== "running") return;
  const c = ctx;
  load(name).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    const gain = c.createGain();
    gain.gain.value = VOLUME[name] ?? 1;
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(gain).connect(c.destination);
    src.start();
  });
}

// The phone's needle click: a short beep, made here instead of loaded, and a
// little lower and louder on every 10. Fast drags are thinned out so the
// clicks don't run together into a buzz.
let lastClick = 0;
export function click(strong = false) {
  if (muted || !ctx || ctx.state !== "running") return;
  const c = ctx;
  const t = c.currentTime;
  if (t - lastClick < 0.018) return;
  lastClick = t;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = strong ? 1920 : 2400;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 5000;
  const gain = c.createGain();
  gain.gain.setValueAtTime(strong ? 0.19 : 0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.02);
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "0" : "1");
  } catch {
    // private window: the choice lasts until reload
  }
  notify();
}

// Unlocks on the first click or key press anywhere on the page, and re-renders
// when sound becomes available or is muted.
export function useSound(preload: readonly Sfx[]) {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((x) => x + 1);
    listeners.add(on);
    const first = () => unlockSound(preload);
    window.addEventListener("pointerdown", first);
    window.addEventListener("keydown", first);
    return () => {
      listeners.delete(on);
      window.removeEventListener("pointerdown", first);
      window.removeEventListener("keydown", first);
    };
  }, []);
  return { ready: !!ctx && ctx.state === "running", muted };
}
