// Game rules and state. The Worker owns the state and applies these functions;
// the pages only render the View built for them, so the target never reaches a
// phone or the projector before the reveal.

export type Question = {
  id: string;
  prompt: string; // お題
  left: string; // 左端のラベル (0)
  right: string; // 右端のラベル (100)
  target: number; // 正解 0–100
  comment?: string; // 正解発表で表示する解説
};

export type QuestionInput = Omit<Question, "id">;

export type Phase = "lobby" | "open" | "closed" | "reveal" | "scores";

export type Answer = { v: number; submitted: boolean };

export type RoundResult = {
  answers: Record<number, number>;
  points: Record<number, number>;
};

export type GameState = {
  title: string;
  tableCount: number;
  seconds: number; // default answer time
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
};

// Accept answers that were in flight when the clock ran out.
export const GRACE_MS = 1000;
export const MAX_TABLES = 100;
export const MAX_QUESTIONS = 200;

// Scoring is the miss: how far the answer is from the target on the 0–100 scale.
// The lowest total wins. A table that gave no answer scores the worst miss
// possible for that question, so skipping can never beat guessing.
export function pointsFor(guess: number, target: number): number {
  return round1(Math.abs(guess - target));
}

export function missPenalty(target: number): number {
  return round1(Math.max(target, 100 - target));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Every table's miss for one question, from the answers that were in when it closed.
function scoreRound(s: GameState, target: number, answers: Record<number, number>): Record<number, number> {
  const points: Record<number, number> = {};
  for (const n of tableNumbers(s)) points[n] = n in answers ? pointsFor(answers[n], target) : missPenalty(target);
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
    seconds: 60,
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
  | { t: "start"; qid: string; seconds?: number }
  | { t: "close" }
  | { t: "reveal" }
  | { t: "scores" }
  | { t: "lobby" }
  | { t: "addTime"; seconds: number }
  | { t: "settings"; title?: string; tableCount?: number; seconds?: number }
  | { t: "rename"; n: number; name: string }
  | { t: "adjust"; n: number; delta: number }
  | { t: "questions"; questions: QuestionInput[] }
  | { t: "addQuestion"; question: QuestionInput }
  | { t: "updateQuestion"; id: string; question: QuestionInput }
  | { t: "deleteQuestion"; id: string }
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
      const v = toValue(m.v);
      if (v === null) return "回答が読み取れませんでした";
      if (s.phase !== "open" || now > s.deadline + GRACE_MS) return CLOSED;
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
      s.deadline = now + clampInt(m.seconds ?? s.seconds, 5, 600) * 1000;
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
      s.results[q.id] = { answers, points: scoreRound(s, q.target, answers) }; // re-running a question replaces its earlier result
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
    case "addTime":
      if (s.phase !== "open") return "回答受付中ではありません";
      s.deadline = Math.max(s.deadline, now) + clampInt(m.seconds, 1, 600) * 1000;
      return;
    case "settings":
      if (m.title !== undefined) s.title = clean(m.title, 40) || s.title;
      if (m.tableCount !== undefined) s.tableCount = clampInt(m.tableCount, 1, MAX_TABLES);
      if (m.seconds !== undefined) s.seconds = clampInt(m.seconds, 5, 600);
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
      Object.assign(old, makeQuestion(s, q, old.id));
      if (!q.comment) delete old.comment;
      // A question that was already revealed is scored again against its new answer.
      const r = s.results[old.id];
      if (r) r.points = scoreRound(s, old.target, r.answers);
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
  return {
    id,
    prompt: clean(q.prompt, 80),
    left: clean(q.left, 24),
    right: clean(q.right, 24),
    target: toValue(q.target, 1) ?? 50,
    ...(q.comment ? { comment: clean(q.comment, 160) } : {}),
  };
}

// A question typed on the admin page: say what is wrong instead of guessing.
function checkQuestion(q: QuestionInput): QuestionInput | string {
  if (!q || typeof q !== "object") return "問題が読み取れませんでした";
  if (!clean(q.prompt, 80)) return "お題を入力してください";
  if (typeof q.target !== "number" || !Number.isFinite(q.target) || q.target < 0 || q.target > 100) {
    return "正解は0〜100の数字で入力してください";
  }
  return q;
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

function toValue(v: unknown, digits = 0): number | null {
  const x = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(Math.min(100, Math.max(0, x)) * f) / f;
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
  question: { prompt: string; left: string; right: string } | null;
  startedAt: number;
  deadline: number;
  tables: TableRow[]; // by table number
  // all tables' needles: admin always, projector once the round is closed
  answers?: { n: number; v: number; submitted: boolean }[];
  average?: number | null;
  // points = each table's miss for this question (lower is better); ranks only cover tables that answered
  result?: { target: number; comment?: string; points: Record<number, number>; ranks: Record<number, number> };
  me?: { n: number; name: string; hasName: boolean; answer: Answer | null; score: number; rank: number };
  // the score graph, sent while the ranking is shown
  board?: Board;
  admin?: {
    questions: (Question & { done: boolean })[];
    tableCount: number;
    seconds: number;
    tokens: Record<number, string>;
  };
};

export type Board = {
  lastQNo: number | null; // question number of the latest revealed question
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
  const lastIndex = s.questions.findIndex((q) => q.id === last);
  return { lastQNo: lastIndex >= 0 ? lastIndex + 1 : null, rows };
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
    question: q && s.phase !== "lobby" ? { prompt: q.prompt, left: q.left, right: q.right } : null,
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
      seconds: s.seconds,
      tokens: viewer.tokens,
    };
  }
  return view;
}
