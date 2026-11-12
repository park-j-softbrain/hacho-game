import { useEffect, useRef, useState } from "preact/hooks";
import type { TableRow, View } from "../shared/game";
import { serverNow } from "./net";
import { play } from "./sound";

// The projector's reveal, played as a little show when it happens live:
// a drumroll, then the answer line swings in, then the results. A page opened
// in the middle of a reveal just shows the results.
export const DRUM_MS = 1600;
export const SWEEP_MS = 2000; // matches .target-sweep in style.css
const SHOW_MS = DRUM_MS + SWEEP_MS;
// After the results show, the tables band drops its bars at +1.8 s and settles
// the ranks at +3.6 s (style.css); the HP sounds follow those.
const BARS_MS = 1800;
const SETTLED_MS = 3400;
const CLOSE = 5; // a miss this small counts as a hit for the "correct" sound

export type Stage = "drum" | "sweep" | "done";

export function useReveal(view: View | null) {
  const [, bump] = useState(0);
  const prev = useRef<{ phase?: string; qid?: string | null }>({});
  const start = useRef<number | null>(null);
  // The totals as they stood before this reveal, shown until the results do.
  const before = useRef<TableRow[]>([]);

  if (view) {
    const p = prev.current;
    if (view.phase !== p.phase || view.qid !== p.qid) {
      const live = view.phase === "reveal" && (p.phase === "open" || p.phase === "closed") && view.qid === p.qid;
      start.current = live ? Date.now() : view.phase === "reveal" ? start.current : null;
      prev.current = { phase: view.phase, qid: view.qid };
    }
    if (view.phase !== "reveal") before.current = view.tables;
  }

  const at = start.current;
  useEffect(() => {
    if (at == null) return;
    play("drumroll");
    const timers = [
      setTimeout(() => {
        play("needle_sweep");
        bump((x) => x + 1);
      }, DRUM_MS),
      setTimeout(() => bump((x) => x + 1), SHOW_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [at]);

  const elapsed = at == null ? Infinity : Date.now() - at;
  const stage: Stage = elapsed < DRUM_MS ? "drum" : elapsed < SHOW_MS ? "sweep" : "done";
  return { stage, before: before.current, live: at != null };
}

// The other sounds, keyed off changes in what the server sends.
export function useScreenSounds(view: View | null, stage: Stage, live: boolean, hp: boolean) {
  const last = useRef<{ phase?: string; qid?: string | null; online?: number }>({});
  const timeUp = useRef<string | null>(null);

  // phase changes: a new question, answering closed, a table joining (the finale plays its own)
  useEffect(() => {
    if (!view) return;
    const p = last.current;
    const online = view.tables.filter((t) => t.online).length;
    if (p.phase !== undefined) {
      if (view.phase === "open" && (p.phase !== "open" || p.qid !== view.qid)) play("question_start");
      if (view.phase === "closed" && p.phase === "open" && timeUp.current !== view.qid) {
        timeUp.current = view.qid;
        play("time_up");
      }
      if (view.phase === "lobby" && p.online !== undefined && online > p.online) play("join");
    }
    last.current = { phase: view.phase, qid: view.qid, online };
  });

  // the last ten seconds tick, then time is up
  const open = view?.phase === "open" ? view : null;
  useEffect(() => {
    if (!open) return;
    let shown = Math.ceil((open.deadline - serverNow()) / 1000);
    const t = setInterval(() => {
      const secs = Math.ceil((open.deadline - serverNow()) / 1000);
      if (secs === shown) return;
      shown = secs;
      if (secs >= 1 && secs <= 10) play("tick");
      if (secs === 0 && timeUp.current !== open.qid) {
        timeUp.current = open.qid;
        play("time_up");
      }
    }, 100);
    return () => clearInterval(t);
  }, [open?.qid, open?.deadline]);

  // the results: correct or wrong, then the healthbars
  const done = live && stage === "done" ? view?.qid : null;
  useEffect(() => {
    const result = view?.result;
    if (!view || !done || !result) return;
    const misses = Object.keys(result.ranks).map((n) => result.points[Number(n)] ?? Infinity);
    play(misses.length && Math.min(...misses) <= CLOSE ? "correct" : "incorrect");
    if (!hp) return;
    const max = Math.max(1, view.qCount) * 100;
    const low = view.tables.some((t) => {
      const was = max - (t.score - (result.points[t.n] ?? 0));
      const now = max - t.score;
      return now / max < 0.2 && was / max >= 0.2;
    });
    const timers = [setTimeout(() => play("hp_down"), BARS_MS)];
    if (low) timers.push(setTimeout(() => play("hp_low"), SETTLED_MS));
    return () => timers.forEach(clearTimeout);
  }, [done]);
}
