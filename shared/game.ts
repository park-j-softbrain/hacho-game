// Game rules and state. The Worker owns the state and applies these functions;
// the pages only render the View built for them, so the target never reaches a
// phone or the projector before the reveal.

import { colorEnds, colorPosition, makeBand, parseColor } from "./color";

export type Question = {
  id: string;
  prompt: string; // お題
  left: string; // 左端のラベル。数字で始まれば範囲の下限 ("0m")
  right: string; // 右端のラベル。数字で始まれば範囲の上限 ("5,000m")
  target: number; // 正解、問題の単位で (0〜5000m の問題なら 3776)
  comment?: string; // 正解発表で表示する解説
  seconds: number; // 回答時間
  worth: number; // 配点: 範囲の端から端までずれたときの点数
  step?: number; // 針の刻み、問題の単位で。なければ範囲の約1%
  color?: string; // 色の問題（左右が色コード）の正解の色 "#BC002D"。target はその帯の上の位置 0〜100
};

// seconds and worth may be left out: they fall back to DEFAULT_SECONDS and DEFAULT_WORTH.
export type QuestionInput = Omit<Question, "id" | "seconds" | "worth"> & { seconds?: number; worth?: number };

export const DEFAULT_WORTH = 100;
export const MAX_WORTH = 100000;
export const MAX_STEPS = 1000; // the finest step: 1/1000 of the range

// ---- the dial's range ----
// When both end labels start with a number ("0m" and "5,000m"), the dial runs
// between them in that unit. Otherwise it is the plain 0–100 scale.

// band: a colour question's dial, one colour per position 0–100 (see color.ts).
export type Scale = { min: number; max: number; unit: string; step: number; band?: string[] };

export function halfWidth(raw: string): string {
  return raw
    .replace(/[０-９．，＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－]/g, "-");
}

// "5,000m" -> { n: 5000, unit: "m" }; "−30℃" -> { n: -30, unit: "℃" }; "ナシ" -> null
export function parseLabel(label: string): { n: number; unit: string } | null {
  const m = /^([-+]?\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(halfWidth(label).trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? { n, unit: m[2].trim() } : null;
}

export function rangeOf(left: string, right: string): { min: number; max: number; unit: string } {
  if (colorEnds(left, right)) return { min: 0, max: 100, unit: "" };
  const a = parseLabel(left);
  const b = parseLabel(right);
  if (!a || !b || a.n === b.n) return { min: 0, max: 100, unit: "" };
  return { min: a.n, max: b.n, unit: b.unit || a.unit };
}

// About 1% of the range, rounded down to 1, 2 or 5 × a power of ten (5000 -> 50, 125 -> 1).
export function defaultStep(width: number): number {
  const x = Math.abs(width) / 100;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return round6((f >= 5 ? 5 : f >= 2 ? 2 : 1) * p);
}

function stepOk(step: unknown, width: number): step is number {
  return typeof step === "number" && Number.isFinite(step) && step > 0 && step <= Math.abs(width) && Math.abs(width) / step <= MAX_STEPS;
}

export function scaleOf(q: { left: string; right: string; step?: number; color?: string }): Scale {
  const r = rangeOf(q.left, q.right);
  const width = r.max - r.min;
  const sc: Scale = { ...r, step: stepOk(q.step, width) ? q.step : defaultStep(width) };
  const ends = colorEnds(q.left, q.right);
  if (ends) {
    const at = colorTarget(q);
    const hex = q.color ? parseColor(q.color)?.hex : undefined;
    sc.band = makeBand(ends.left, ends.right, hex && at !== null ? { hex, at } : undefined);
  }
  return sc;
}

// A colour question's answer position: its colour placed by brightness between
// the ends, then put on the needle's step grid so a perfect answer is possible.
// null when the question has no answer colour or the colour is out of range.
export function colorTarget(q: { left: string; right: string; step?: number; color?: string }): number | null {
  const ends = colorEnds(q.left, q.right);
  const c = q.color ? parseColor(q.color) : null;
  if (!ends || !c) return null;
  const at = colorPosition(ends.left, ends.right, c.hex);
  if (at === null) return null;
  const width = 100;
  const step = stepOk(q.step, width) ? q.step : defaultStep(width);
  // inside the ends, so the band still runs 左 → 正解 → 右
  return round6(Math.min(100 - step, Math.max(step, Math.round(at / step) * step)));
}

// The nearest needle position: on the step grid counted from the left end, inside the range.
export function snap(sc: Scale, v: number): number {
  const lo = Math.min(sc.min, sc.max);
  const hi = Math.max(sc.min, sc.max);
  const dir = sc.max >= sc.min ? 1 : -1;
  const x = sc.min + dir * Math.round(((v - sc.min) * dir) / sc.step) * sc.step;
  return round6(Math.min(hi, Math.max(lo, x)));
}

// Where v sits along the dial: 0 at the left end, 1 at the right end.
export function fractionOf(sc: Scale, v: number): number {
  return Math.min(1, Math.max(0, (v - sc.min) / (sc.max - sc.min)));
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// "3,776m", "-12.5℃": the number the way the projector and phones show it.
export function formatValue(v: number, unit = ""): string {
  return v.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) + unit;
}

export const DEFAULT_SECONDS = 60;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600;

export type Phase = "lobby" | "open" | "closed" | "reveal" | "scores" | "finale";

export type Answer = { v: number; submitted: boolean };

export type RoundResult = {
  answers: Record<number, number>;
  points: Record<number, number>;
};

export type GameState = {
  title: string;
  tableCount: number;
  seconds: number; // unused since answer times moved onto each question; kept so saved state still loads
  questions: Question[];
  nextId: number;
  names: Record<number, string>;
  adjust: Record<number, number>; // manual bonus / penalty per table
  results: Record<string, RoundResult>; // by question id, written at reveal
  played: string[]; // question ids in the order they were revealed (last = latest)
  phase: Phase;
  qid: string | null; // current question
  startedAt: number;
  deadline: number;
  answers: Record<number, Answer>; // current round, by table
  shown: number; // finale: how many podium places are out (0 = the "全問終了" screen)
  version?: number; // 2: targets and answers are in each question's own units (before: 0–100)
};

export const STATE_VERSION = 2;

// Accept answers that were in flight when the clock ran out.
export const GRACE_MS = 1000;
export const MAX_TABLES = 100;
export const MAX_QUESTIONS = 200;

// Scoring is the miss as a share of the range, times the question's worth:
// |正解 − 回答| × 配点 ÷ 範囲の幅. A perfect answer scores 0 and missing by the
// whole range scores the worth. The lowest total wins. A table that gave no
// answer scores the miss to the farther end, so skipping can never beat guessing.
type Scored = { left: string; right: string; target: number; worth: number };

export function pointsFor(q: Scored, guess: number): number {
  const r = rangeOf(q.left, q.right);
  return round1((Math.abs(guess - q.target) * q.worth) / Math.abs(r.max - r.min));
}

export function missPenalty(q: Scored): number {
  const r = rangeOf(q.left, q.right);
  return Math.max(pointsFor(q, r.min), pointsFor(q, r.max));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Every table's miss for one question, from the answers that were in when it closed.
function scoreRound(s: GameState, q: Question, answers: Record<number, number>): Record<number, number> {
  const points: Record<number, number> = {};
  for (const n of tableNumbers(s)) points[n] = n in answers ? pointsFor(q, answers[n]) : missPenalty(q);
  return points;
}

// Competition ranks among the tables that answered: the closest is 1st, equal misses share a rank.
export function roundRanks(r: RoundResult): Record<number, number> {
  const rows = Object.keys(r.answers).map((k) => ({ n: Number(k), p: r.points[Number(k)] ?? 0 }));
  rows.sort((a, b) => a.p - b.p || a.n - b.n);
  const ranks: Record<number, number> = {};
  rows.forEach((row, i) => (ranks[row.n] = i > 0 && row.p === rows[i - 1].p ? ranks[rows[i - 1].n] : i + 1));
  return ranks;
}

export function initialState(questions: QuestionInput[]): GameState {
  const s: GameState = {
    title: "波長あわせゲーム",
    tableCount: 20,
    seconds: DEFAULT_SECONDS,
    questions: [],
    nextId: 1,
    names: {},
    adjust: {},
    results: {},
    played: [],
    phase: "lobby",
    qid: null,
    startedAt: 0,
    deadline: 0,
    answers: {},
    shown: 0,
    version: STATE_VERSION,
  };
  setQuestions(s, questions);
  return s;
}

export function defaultName(n: number): string {
  return `テーブル${n}`;
}

export function nameOf(s: GameState, n: number): string {
  return s.names[n] ?? defaultName(n);
}

export function tableNumbers(s: GameState): number[] {
  return Array.from({ length: s.tableCount }, (_, i) => i + 1);
}

export function scoreOf(s: GameState, n: number): number {
  let total = s.adjust[n] ?? 0;
  for (const r of Object.values(s.results)) total += r.points[n] ?? 0;
  return round1(total);
}

export type Standing = { n: number; name: string; score: number; rank: number };

// Competition ranking, lowest score first: equal scores share a rank (1, 1, 3).
export function standings(s: GameState): Standing[] {
  const rows = tableNumbers(s).map((n) => ({ n, name: nameOf(s, n), score: scoreOf(s, n), rank: 0 }));
  rows.sort((a, b) => a.score - b.score || a.n - b.n);
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.score === rows[i - 1].score ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

// The finale's podium, revealed 3位 → 2位 → 1位. A place nobody holds (two
// tables tied for 2位 leave no 3位) is skipped.
export type Place = { rank: number; tables: { n: number; name: string; score: number }[] };

export function podium(s: GameState): Place[] {
  const rows = standings(s);
  return [3, 2, 1]
    .map((rank) => ({ rank, tables: rows.filter((r) => r.rank === rank).map(({ n, name, score }) => ({ n, name, score })) }))
    .filter((p) => p.tables.length > 0);
}

export function currentQuestion(s: GameState): Question | null {
  return s.questions.find((q) => q.id === s.qid) ?? null;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// ---- messages ----

export type TableMsg =
  | { t: "name"; name: string }
  | { t: "move"; v: number }
  | { t: "submit"; v: number }
  | { t: "unsubmit" };

export type AdminMsg =
  | { t: "start"; qid: string }
  | { t: "close" }
  | { t: "reveal" }
  | { t: "scores" }
  | { t: "lobby" }
  | { t: "finale" } // the "全問終了" screen; phones wait for the results
  | { t: "finaleNext" } // the next podium place
  | { t: "addTime"; seconds: number }
  | { t: "settings"; title?: string; tableCount?: number }
  | { t: "rename"; n: number; name: string }
  | { t: "adjust"; n: number; delta: number }
  | { t: "questions"; questions: QuestionInput[] }
  | { t: "addQuestion"; question: QuestionInput }
  | { t: "updateQuestion"; id: string; question: QuestionInput }
  | { t: "deleteQuestion"; id: string }
  | { t: "moveQuestion"; id: string; by: number } // by -1: one place up, 1: one place down
  | { t: "reset" };

const CLOSED = "回答の受付は終了しました";

// Each apply* mutates the state and returns an error message to show the sender, or nothing.
export function applyTable(s: GameState, n: number, m: TableMsg, now: number): string | undefined {
  switch (m?.t) {
    case "name":
      setName(s, n, m.name);
      return;
    case "move":
    case "submit": {
      const q = currentQuestion(s);
      if (s.phase !== "open" || !q || now > s.deadline + GRACE_MS) return CLOSED;
      if (typeof m.v !== "number" || !Number.isFinite(m.v)) return "回答が読み取れませんでした";
      const v = snap(scaleOf(q), m.v);
      if (m.t === "move" && s.answers[n]?.submitted) return; // locked until "修正する"
      s.answers[n] = { v, submitted: m.t === "submit" };
      return;
    }
    case "unsubmit": {
      if (s.phase !== "open" || now > s.deadline) return CLOSED;
      const a = s.answers[n];
      if (a) a.submitted = false;
      return;
    }
  }
  return "不明な操作です";
}

export function applyAdmin(s: GameState, m: AdminMsg, now: number): string | undefined {
  switch (m?.t) {
    case "start": {
      const q = s.questions.find((q) => q.id === m.qid);
      if (!q) return "問題が見つかりません";
      s.phase = "open";
      s.qid = q.id;
      s.startedAt = now;
      s.deadline = now + clampInt(q.seconds, MIN_SECONDS, MAX_SECONDS) * 1000;
      s.answers = {};
      return;
    }
    case "close":
      if (s.phase !== "open") return "回答受付中ではありません";
      s.phase = "closed";
      return;
    case "reveal": {
      if (s.phase === "open") s.phase = "closed";
      const q = currentQuestion(s);
      if (s.phase !== "closed" || !q) return "締め切ったあとに発表できます";
      const answers: Record<number, number> = {};
      for (const [key, a] of Object.entries(s.answers)) answers[Number(key)] = a.v;
      s.results[q.id] = { answers, points: scoreRound(s, q, answers) }; // re-running a question replaces its earlier result
      s.played = [...playedOrder(s).filter((id) => id !== q.id), q.id];
      s.phase = "reveal";
      return;
    }
    case "scores":
      s.phase = "scores";
      return;
    case "lobby":
      s.phase = "lobby";
      return;
    case "finale":
      s.phase = "finale";
      s.shown = 0;
      return;
    case "finaleNext": {
      if (s.phase !== "finale") return "最終結果発表の画面ではありません";
      const total = podium(s).length;
      if ((s.shown ?? 0) >= total) return "すべての順位を発表しました";
      s.shown = (s.shown ?? 0) + 1;
      return;
    }
    case "addTime":
      if (s.phase !== "open") return "回答受付中ではありません";
      s.deadline = Math.max(s.deadline, now) + clampInt(m.seconds, 1, 600) * 1000;
      return;
    case "settings":
      if (m.title !== undefined) s.title = clean(m.title, 40) || s.title;
      if (m.tableCount !== undefined) s.tableCount = clampInt(m.tableCount, 1, MAX_TABLES);
      return;
    case "rename":
      setName(s, m.n, m.name);
      return;
    case "adjust":
      s.adjust[m.n] = (s.adjust[m.n] ?? 0) + clampInt(m.delta, -100, 100);
      return;
    case "questions": {
      if (s.phase === "open" || s.phase === "closed") return "出題中は問題を差し替えられません";
      if (!Array.isArray(m.questions)) return "問題が1つもありません";
      const questions = m.questions.filter((q) => q && typeof q === "object").slice(0, MAX_QUESTIONS);
      if (questions.length === 0) return "問題が1つもありません";
      setQuestions(s, questions);
      return;
    }
    case "addQuestion": {
      if (s.questions.length >= MAX_QUESTIONS) return `問題は${MAX_QUESTIONS}問までです`;
      const q = checkQuestion(m.question);
      if (typeof q === "string") return q;
      s.questions.push(makeQuestion(s, q));
      return;
    }
    case "updateQuestion": {
      const old = s.questions.find((q) => q.id === m.id);
      if (!old) return "問題が見つかりません";
      if (isLive(s, old.id)) return "出題中の問題は変更できません";
      const q = checkQuestion(m.question);
      if (typeof q === "string") return q;
      const fresh = makeQuestion(s, q, old.id);
      Object.assign(old, fresh);
      if (!fresh.comment) delete old.comment;
      if (fresh.step === undefined) delete old.step;
      if (fresh.color === undefined) delete old.color;
      // A question that was already revealed is scored again against its new answer.
      const r = s.results[old.id];
      if (r) r.points = scoreRound(s, old, r.answers);
      return;
    }
    case "moveQuestion": {
      const i = s.questions.findIndex((q) => q.id === m.id);
      if (i < 0) return "問題が見つかりません";
      // The phones show the open question's number, so the order holds still during a round.
      if (s.phase === "open" || s.phase === "closed") return "出題中は並べ替えられません";
      const j = i + Math.sign(Number(m.by) || 0);
      if (j < 0 || j >= s.questions.length || j === i) return;
      const [q] = s.questions.splice(i, 1);
      s.questions.splice(j, 0, q);
      return;
    }
    case "deleteQuestion": {
      const i = s.questions.findIndex((q) => q.id === m.id);
      if (i < 0) return "問題が見つかりません";
      if (isLive(s, m.id)) return "出題中の問題は削除できません";
      s.questions.splice(i, 1);
      delete s.results[m.id];
      s.played = (s.played ?? []).filter((id) => id !== m.id);
      if (s.qid === m.id) {
        s.qid = null;
        s.answers = {};
        if (s.phase === "reveal") s.phase = "lobby";
      }
      return;
    }
    case "reset":
      Object.assign(s, {
        names: {},
        adjust: {},
        results: {},
        played: [],
        phase: "lobby",
        qid: null,
        startedAt: 0,
        deadline: 0,
        answers: {},
        shown: 0,
      } satisfies Partial<GameState>);
      return;
  }
  return "不明な操作です";
}

// Revealed question ids, oldest first. State saved before `played` existed falls back to the results' order.
function playedOrder(s: GameState): string[] {
  const known = (s.played ?? []).filter((id) => s.results[id]);
  return [...known, ...Object.keys(s.results).filter((id) => !known.includes(id))];
}

// Called by the Worker's alarm when the clock runs out.
export function closeIfExpired(s: GameState, now: number): boolean {
  if (s.phase !== "open" || now < s.deadline) return false;
  s.phase = "closed";
  return true;
}

function setQuestions(s: GameState, questions: QuestionInput[]) {
  s.questions = questions.map((q) => makeQuestion(s, q));
  if (!currentQuestion(s)) s.qid = null;
}

function makeQuestion(s: GameState, q: QuestionInput, id = `q${s.nextId++}`): Question {
  const left = clean(q.left, 24);
  const right = clean(q.right, 24);
  const r = rangeOf(left, right);
  const lo = Math.min(r.min, r.max);
  const hi = Math.max(r.min, r.max);
  const color = q.color ? parseColor(q.color)?.hex : undefined;
  const at = color ? colorTarget({ left, right, step: q.step, color }) : null;
  const target = at ?? (typeof q.target === "number" && Number.isFinite(q.target) ? q.target : (lo + hi) / 2);
  return {
    id,
    prompt: clean(q.prompt, 80),
    left,
    right,
    target: round6(Math.min(hi, Math.max(lo, target))),
    ...(q.comment ? { comment: clean(q.comment, 160) } : {}),
    seconds: clampInt(q.seconds ?? DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS),
    worth: worthOk(q.worth) ? q.worth : DEFAULT_WORTH,
    ...(stepOk(q.step, r.max - r.min) ? { step: round6(q.step) } : {}),
    ...(color && at !== null ? { color } : {}),
  };
}

function worthOk(w: unknown): w is number {
  return typeof w === "number" && Number.isInteger(w) && w >= 1 && w <= MAX_WORTH;
}

// What is wrong with a question's answer, worth, step or time, or null. Shared
// by the admin form and the spreadsheet import, which add where the problem is.
export function questionProblem(q: QuestionInput): string | null {
  const r = rangeOf(q.left ?? "", q.right ?? "");
  const lo = Math.min(r.min, r.max);
  const hi = Math.max(r.min, r.max);
  const width = hi - lo;
  if (colorEnds(q.left ?? "", q.right ?? "")) {
    if (q.color !== undefined) {
      if (!parseColor(q.color)) return "正解の色が読めません。#BC002D や rgb(188,0,45) の形で書いてください";
      if (colorTarget({ left: q.left, right: q.right, color: q.color }) === null) {
        return "正解の色は左と右の間の明るさにしてください";
      }
    } else if (typeof q.target !== "number" || !Number.isFinite(q.target) || q.target < 0 || q.target > 100) {
      return "正解は色コード（#BC002D など）か0〜100の数字にしてください";
    }
  } else if (typeof q.target !== "number" || !Number.isFinite(q.target) || q.target < lo || q.target > hi) {
    return `正解は${formatValue(lo, r.unit)}〜${formatValue(hi, r.unit)}の数字にしてください`;
  }
  if (q.worth !== undefined && !worthOk(q.worth)) return "配点は1以上の整数にしてください";
  if (q.step !== undefined && !stepOk(q.step, width)) {
    return `針の刻みは${formatValue(round6(width / MAX_STEPS), r.unit)}〜${formatValue(width, r.unit)}の数字にしてください（空欄なら${formatValue(defaultStep(width), r.unit)}）`;
  }
  if (q.seconds !== undefined && !(Number.isInteger(q.seconds) && q.seconds >= MIN_SECONDS && q.seconds <= MAX_SECONDS)) {
    return `回答時間は${MIN_SECONDS}〜${MAX_SECONDS}秒の整数にしてください`;
  }
  return null;
}

// A question typed on the admin page: say what is wrong instead of guessing.
function checkQuestion(q: QuestionInput): QuestionInput | string {
  if (!q || typeof q !== "object") return "問題が読み取れませんでした";
  if (!clean(q.prompt, 80)) return "お題を入力してください";
  return questionProblem(q) ?? q;
}

// State saved before version 2 kept every target and answer on 0–100. A question
// whose labels now give it its own range has those moved onto that range.
export function migrate(s: GameState) {
  for (const q of s.questions) q.worth ??= DEFAULT_WORTH;
  if ((s.version ?? 1) < 2) {
    for (const q of s.questions) {
      const r = rangeOf(q.left, q.right);
      if (r.min === 0 && r.max === 100) continue;
      const conv = (v: number) => round6(r.min + (v / 100) * (r.max - r.min));
      q.target = conv(q.target);
      const res = s.results[q.id];
      if (res) for (const k of Object.keys(res.answers)) res.answers[Number(k)] = conv(res.answers[Number(k)]);
      if (s.qid === q.id) for (const a of Object.values(s.answers)) a.v = conv(a.v);
    }
  }
  s.version = STATE_VERSION;
}

// The question being played right now can't change under the tables' hands.
function isLive(s: GameState, id: string): boolean {
  return s.qid === id && (s.phase === "open" || s.phase === "closed");
}

function setName(s: GameState, n: number, name: unknown) {
  const v = clean(name, 20);
  if (v) s.names[n] = v;
  else delete s.names[n];
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clampInt(v: unknown, min: number, max: number): number {
  const x = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : min;
  return Math.min(max, Math.max(min, x));
}

// ---- views sent to each kind of client ----

export type TableRow = {
  n: number;
  name: string;
  online: boolean;
  answered: boolean; // pressed 回答 this round
  score: number;
  rank: number;
};

export type View = {
  t: "state";
  now: number;
  title: string;
  phase: Phase;
  final: boolean; // every question has been revealed
  played: number; // questions revealed so far; scores mean nothing before the first
  qid: string | null;
  qNo: number;
  qCount: number;
  question: { prompt: string; left: string; right: string; scale: Scale } | null;
  maxScore: number; // every question's worth added up: the most a table can lose
  startedAt: number;
  deadline: number;
  tables: TableRow[]; // by table number
  // all tables' needles: admin always, projector once the round is closed
  answers?: { n: number; v: number; submitted: boolean }[];
  average?: number | null;
  // points = each table's score for this question (lower is better); ranks only cover tables that answered
  result?: { target: number; comment?: string; points: Record<number, number>; ranks: Record<number, number> };
  me?: { n: number; name: string; hasName: boolean; answer: Answer | null; score: number; rank: number };
  // the score graph, sent while the ranking is shown
  board?: Board;
  // the finale: places revealed so far (3位 first); the admin gets every place
  finale?: { total: number; shown: number; places: Place[] };
  admin?: {
    questions: (Question & { done: boolean })[];
    tableCount: number;
    tokens: Record<number, string>;
  };
};

export type Board = {
  lastQNo: number | null; // question number of the latest revealed question
  qNos: number[]; // question number of each entry in pts
  rows: {
    n: number;
    pts: number[]; // points per revealed question, oldest first
    adjust: number;
    prevRank: number | null; // rank before the latest question; null after only one
  }[];
};

export function buildBoard(s: GameState): Board {
  const order = playedOrder(s);
  const last = order.at(-1);
  const rows = tableNumbers(s).map((n) => ({
    n,
    pts: order.map((id) => s.results[id].points[n] ?? 0),
    adjust: s.adjust[n] ?? 0,
    prevRank: null as number | null,
  }));
  if (order.length > 1) {
    const before = rows.map((r) => round1(scoreOf(s, r.n) - r.pts[r.pts.length - 1]));
    rows.forEach((r, i) => (r.prevRank = 1 + before.filter((b) => b < before[i]).length));
  }
  const qNo = (id: string) => s.questions.findIndex((q) => q.id === id) + 1;
  const lastIndex = last ? qNo(last) : 0;
  return { lastQNo: lastIndex > 0 ? lastIndex : null, qNos: order.map(qNo), rows };
}

export type Viewer =
  | { role: "screen" }
  | { role: "table"; n: number }
  | { role: "admin"; tokens: Record<number, string> };

export function buildView(s: GameState, viewer: Viewer, online: Set<number>, now: number): View {
  const q = currentQuestion(s);
  const ranks = new Map(standings(s).map((r) => [r.n, r]));
  const roundOver = s.phase === "closed" || s.phase === "reveal";
  const view: View = {
    t: "state",
    now,
    title: s.title,
    phase: s.phase,
    final: s.questions.length > 0 && s.questions.every((x) => s.results[x.id]),
    played: playedOrder(s).length,
    qid: q?.id ?? null,
    qNo: q ? s.questions.indexOf(q) + 1 : 0,
    qCount: s.questions.length,
    question: q && s.phase !== "lobby" ? { prompt: q.prompt, left: q.left, right: q.right, scale: scaleOf(q) } : null,
    maxScore: s.questions.reduce((a, x) => a + (x.worth ?? DEFAULT_WORTH), 0),
    startedAt: s.startedAt,
    deadline: s.deadline,
    tables: tableNumbers(s).map((n) => ({
      n,
      name: nameOf(s, n),
      online: online.has(n),
      answered: !!s.answers[n]?.submitted,
      score: ranks.get(n)?.score ?? 0,
      rank: ranks.get(n)?.rank ?? 0,
    })),
  };
  if (viewer.role === "admin" || (viewer.role === "screen" && roundOver)) {
    view.answers = Object.entries(s.answers).map(([n, a]) => ({ n: Number(n), v: a.v, submitted: a.submitted }));
    view.average = average(view.answers.map((a) => a.v));
  }
  if (s.phase === "reveal" && q) {
    const r = s.results[q.id];
    view.result = { target: q.target, comment: q.comment, points: r?.points ?? {}, ranks: r ? roundRanks(r) : {} };
  }
  if (s.phase === "scores") view.board = buildBoard(s);
  if (s.phase === "finale") {
    const places = podium(s);
    const shown = Math.min(s.shown ?? 0, places.length);
    view.finale = { total: places.length, shown, places: viewer.role === "admin" ? places : places.slice(0, shown) };
  }
  if (viewer.role === "table") {
    const n = viewer.n;
    view.me = {
      n,
      name: nameOf(s, n),
      hasName: n in s.names,
      answer: s.answers[n] ?? null,
      score: scoreOf(s, n),
      rank: ranks.get(n)?.rank ?? 0,
    };
  }
  if (viewer.role === "admin") {
    view.admin = {
      questions: s.questions.map((x) => ({ ...x, done: !!s.results[x.id] })),
      tableCount: s.tableCount,
      tokens: viewer.tokens,
    };
  }
  return view;
}
