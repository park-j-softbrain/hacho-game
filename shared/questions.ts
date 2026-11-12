import { MAX_SECONDS, MIN_SECONDS, type Question, type QuestionInput, halfWidth, questionProblem } from "./game";

// Loaded on first start. Replace them from the admin page (問題の読み込み).
export const SAMPLE_QUESTIONS: QuestionInput[] = [
  {
    prompt: "日本の国土のうち、森林の割合は？",
    left: "0%",
    right: "100%",
    target: 67,
    comment: "国土の約3分の2（約67%）が森林です",
  },
  {
    prompt: "地球の表面のうち、海の割合は？",
    left: "0%",
    right: "100%",
    target: 71,
    comment: "地球の表面の約71%が海です",
  },
  {
    prompt: "富士山の高さは？",
    left: "0m",
    right: "5,000m",
    target: 3776,
    comment: "剣ヶ峰の標高は3,776mです",
  },
  {
    prompt: "（サンプル）社員アンケート：みんなは朝型？夜型？",
    left: "朝型",
    right: "夜型",
    target: 40,
    comment: "事前アンケートの平均を正解にしてください",
  },
  {
    prompt: "（サンプル）社長が好きなカレーの辛さは？",
    left: "甘口",
    right: "激辛",
    target: 70,
    comment: "社長に事前に聞いた答えを正解にしてください",
  },
];

export const TSV_HEADER = ["お題", "左", "右", "正解", "解説", "所要時間(秒)", "配点", "針の刻み"];

// Rows pasted from a spreadsheet (tab-separated) or CSV without quotes:
// お題, 左, 右, 正解, 解説(任意), 所要時間(秒, 空なら60秒), 配点(空なら100), 針の刻み(空なら範囲の約1%).
// 正解 and 針の刻み are in the question's own unit ("0m"〜"5,000m" なら 3776, 10).
// A header row is skipped. A JSON array also works.
export function parseQuestions(text: string): { questions: QuestionInput[] } | { error: string } {
  const body = text.trim();
  if (!body) return { error: "問題が空です" };
  if (body.startsWith("[")) return parseJson(body);

  const sep = body.includes("\t") ? "\t" : ",";
  const questions: QuestionInput[] = [];
  let firstRow = true;
  for (const [i, line] of body.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const [prompt = "", left = "", right = "", rawTarget = "", comment = "", rawSeconds = "", rawWorth = "", rawStep = ""] = line
      .split(sep)
      .map((c) => c.trim());
    const target = toNumber(rawTarget);
    const isHeader = firstRow && target === null;
    firstRow = false;
    if (isHeader) continue;
    const at = `${i + 1}行目: `;
    if (!prompt || !left || !right) return { error: `${at}お題・左・右の3つを入れてください` };
    if (target === null) return { error: `${at}正解（4列目）を数字で入れてください` };
    const seconds = toSeconds(rawSeconds);
    if (seconds === null) return { error: at + SECONDS_ERROR };
    const worth = rawWorth ? toNumber(rawWorth) : undefined;
    if (worth === null) return { error: `${at}配点（7列目）は1以上の整数にしてください（空欄なら100）` };
    const step = rawStep ? toNumber(rawStep) : undefined;
    if (step === null) return { error: `${at}針の刻み（8列目）は数字にしてください（空欄なら範囲の約1%）` };
    const q: QuestionInput = {
      prompt,
      left,
      right,
      target,
      ...(comment ? { comment } : {}),
      ...(seconds ? { seconds } : {}),
      ...(worth !== undefined ? { worth } : {}),
      ...(step !== undefined ? { step } : {}),
    };
    const problem = questionProblem(q);
    if (problem) return { error: at + problem };
    questions.push(q);
  }
  if (questions.length === 0) return { error: "問題が1つもありません" };
  return { questions };
}

function parseJson(body: string): { questions: QuestionInput[] } | { error: string } {
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    return { error: "JSONとして読み込めませんでした" };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { error: "問題が1つもありません" };
  const questions: QuestionInput[] = [];
  for (const [i, r] of rows.entries()) {
    const target = toNumber(String(r?.target ?? ""));
    if (!r?.prompt || !r?.left || !r?.right || target === null) {
      return { error: `${i + 1}問目: prompt・left・right・target が必要です` };
    }
    const seconds = toSeconds(String(r.seconds ?? ""));
    if (seconds === null) return { error: `${i + 1}問目: seconds は${MIN_SECONDS}〜${MAX_SECONDS}の整数にしてください` };
    const q: QuestionInput = {
      prompt: r.prompt,
      left: r.left,
      right: r.right,
      target,
      ...(r.comment ? { comment: r.comment } : {}),
      ...(seconds ? { seconds } : {}),
      ...(r.worth != null ? { worth: Number(r.worth) } : {}),
      ...(r.step != null ? { step: Number(r.step) } : {}),
    };
    const problem = questionProblem(q);
    if (problem) return { error: `${i + 1}問目: ${problem}` };
    questions.push(q);
  }
  return { questions };
}

const SECONDS_ERROR = `所要時間（6列目）は${MIN_SECONDS}〜${MAX_SECONDS}秒の整数にしてください（空欄なら60秒）`;

// Accepts "45", "45秒", "45s" and full-width digits. Blank gives 0 (use the default); bad input gives null.
function toSeconds(raw: string): number | null {
  const s = halfWidth(raw).replace(/(秒|sec|s|\s)/gi, "");
  if (!s) return 0;
  if (!/^\d+$/.test(s)) return null;
  const v = Number(s);
  return v >= MIN_SECONDS && v <= MAX_SECONDS ? v : null;
}

// Accepts "3776", "3,776", "3776m", "75%", "-12.5℃" and full-width digits; the unit is ignored.
function toNumber(raw: string): number | null {
  const m = /^([-+]?\d[\d,]*(?:\.\d+)?)/.exec(halfWidth(raw).replace(/\s/g, ""));
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

export function toTsv(questions: Question[]): string {
  const rows = questions.map((q) => [
    q.prompt,
    q.left,
    q.right,
    String(q.target),
    q.comment ?? "",
    String(q.seconds),
    String(q.worth),
    q.step !== undefined ? String(q.step) : "",
  ]);
  return [TSV_HEADER, ...rows].map((r) => r.join("\t")).join("\n");
}
