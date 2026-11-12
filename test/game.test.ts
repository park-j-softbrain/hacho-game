import { describe, expect, it } from "vitest";
import {
  applyAdmin,
  applyTable,
  buildView,
  closeIfExpired,
  GRACE_MS,
  initialState,
  missPenalty,
  pointsFor,
  roundRanks,
  standings,
  type GameState,
} from "../shared/game";
import { parseQuestions, toTsv } from "../shared/questions";

const Q = [
  { prompt: "富士山の高さ", left: "0m", right: "5000m", target: 75.5, comment: "3,776m" },
  { prompt: "朝型？夜型？", left: "朝型", right: "夜型", target: 40 },
];

function started(now = 0): GameState {
  const s = initialState(Q);
  s.tableCount = 3;
  expect(applyAdmin(s, { t: "start", qid: s.questions[0].id }, now)).toBeUndefined();
  return s;
}

describe("scoring", () => {
  it("scores the distance from the target, and the worst possible miss for no answer", () => {
    expect(pointsFor(75.5, 75.5)).toBe(0);
    expect(pointsFor(75, 75.5)).toBe(0.5);
    expect(pointsFor(64, 75.5)).toBe(11.5);
    expect(pointsFor(0.1, 0.3)).toBe(0.2); // no floating-point tails
    expect(missPenalty(75.5)).toBe(75.5);
    expect(missPenalty(40)).toBe(60);
  });

  it("ranks the closest answer first, with ties sharing a rank", () => {
    expect(roundRanks({ answers: { 1: 50, 2: 52, 3: 48, 5: 90 }, points: { 1: 2, 2: 4, 3: 2, 4: 60, 5: 40 } })).toEqual({
      1: 1,
      3: 1,
      2: 3,
      5: 4,
    });
  });

  it("puts the lowest total first and ranks equal totals together", () => {
    const s = initialState(Q);
    s.tableCount = 3;
    s.adjust = { 1: 5, 2: 5, 3: 1 };
    expect(standings(s).map((r) => [r.n, r.rank])).toEqual([
      [3, 1],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("a round", () => {
  it("scores submitted answers and last needle positions, and the worst miss for untouched tables", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyTable(s, 2, { t: "move", v: 66 }, 2000);
    applyAdmin(s, { t: "close" }, 3000);
    applyAdmin(s, { t: "reveal" }, 4000);
    expect(s.results[s.questions[0].id].points).toEqual({ 1: 0.5, 2: 9.5, 3: 75.5 });
    expect(s.results[s.questions[0].id].answers).toEqual({ 1: 75, 2: 66 });
    expect(standings(s).map((r) => [r.n, r.score])).toEqual([
      [1, 0.5],
      [2, 9.5],
      [3, 75.5],
    ]);
  });

  it("locks the needle after 回答 until 修正する", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 30 }, 1000);
    applyTable(s, 1, { t: "move", v: 90 }, 1100);
    expect(s.answers[1]).toEqual({ v: 30, submitted: true });
    applyTable(s, 1, { t: "unsubmit" }, 1200);
    applyTable(s, 1, { t: "move", v: 90 }, 1300);
    expect(s.answers[1]).toEqual({ v: 90, submitted: false });
  });

  it("accepts answers in flight at the deadline, then refuses them", () => {
    const s = started(0);
    expect(applyTable(s, 1, { t: "submit", v: 50 }, 60_000 + GRACE_MS)).toBeUndefined();
    expect(applyTable(s, 2, { t: "submit", v: 50 }, 60_000 + GRACE_MS + 1)).toBeTruthy();
    expect(closeIfExpired(s, 59_999)).toBe(false);
    expect(closeIfExpired(s, 60_000)).toBe(true);
    expect(s.phase).toBe("closed");
    expect(applyTable(s, 3, { t: "submit", v: 50 }, 1)).toBeTruthy();
  });

  it("replaces a question's result when it is played again", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyAdmin(s, { t: "reveal" }, 2000);
    applyAdmin(s, { t: "start", qid: s.questions[0].id }, 3000);
    applyTable(s, 1, { t: "submit", v: 0 }, 4000);
    applyAdmin(s, { t: "reveal" }, 5000);
    expect(standings(s).find((r) => r.n === 1)!.score).toBe(75.5); // 0 vs 75.5: the new answer, not the old
    expect(standings(s).find((r) => r.n === 2)!.score).toBe(75.5); // not summed twice
  });

  it("rejects junk from a phone", () => {
    const s = started();
    expect(applyTable(s, 1, { t: "submit", v: "abc" as unknown as number }, 1000)).toBeTruthy();
    expect(applyTable(s, 1, { t: "submit", v: 250 }, 1000)).toBeUndefined();
    expect(s.answers[1].v).toBe(100);
    expect(applyTable(s, 1, { t: "hack" } as never, 1000)).toBeTruthy();
  });
});

describe("views", () => {
  it("keeps the target and other tables' needles off phones and the projector until the reveal", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyTable(s, 2, { t: "move", v: 20 }, 1000);
    for (const phase of ["open", "closed"] as const) {
      s.phase = phase;
      const screen = JSON.stringify(buildView(s, { role: "screen" }, new Set(), 0));
      const phone = buildView(s, { role: "table", n: 2 }, new Set(), 0);
      expect(screen).not.toContain("75.5");
      expect(JSON.stringify(phone)).not.toContain("75.5");
      expect(phone.answers).toBeUndefined();
      expect(phone.me!.answer).toEqual({ v: 20, submitted: false });
    }
    // The projector shows everyone's needles once the round is closed, still without the target.
    expect(buildView(s, { role: "screen" }, new Set(), 0).answers).toHaveLength(2);
    applyAdmin(s, { t: "reveal" }, 2000);
    expect(buildView(s, { role: "table", n: 2 }, new Set(), 0).result!.target).toBe(75.5);
  });

  it("gives the admin the answers live", () => {
    const s = started();
    applyTable(s, 3, { t: "move", v: 10 }, 1000);
    const v = buildView(s, { role: "admin", tokens: {} }, new Set([3]), 0);
    expect(v.answers).toEqual([{ n: 3, v: 10, submitted: false }]);
    expect(v.average).toBe(10);
    expect(v.tables.find((t) => t.n === 3)!.online).toBe(true);
  });
});

const parsed = (text: string) => {
  const r = parseQuestions(text);
  if ("error" in r) throw new Error(r.error);
  return r.questions;
};

describe("question import", () => {
  it("reads rows pasted from a spreadsheet, skipping the header", () => {
    const text = "お題\t左\t右\t正解\t解説\n富士山の高さ\t0m\t5000m\t７５.５%\t3,776m\n\n朝型？\t朝型\t夜型\t40\n";
    expect(parseQuestions(text)).toEqual({
      questions: [
        { prompt: "富士山の高さ", left: "0m", right: "5000m", target: 75.5, comment: "3,776m" },
        { prompt: "朝型？", left: "朝型", right: "夜型", target: 40 },
      ],
    });
  });

  it("reads each question's answer time from the 6th column, 60 s when blank", () => {
    const text = "お題\t左\t右\t正解\t解説\t所要時間\na\tb\tc\t50\t\t45\nd\te\tf\t60\tメモ\t９０秒\ng\th\ti\t70";
    expect(parseQuestions(text)).toEqual({
      questions: [
        { prompt: "a", left: "b", right: "c", target: 50, seconds: 45 },
        { prompt: "d", left: "e", right: "f", target: 60, comment: "メモ", seconds: 90 },
        { prompt: "g", left: "h", right: "i", target: 70 },
      ],
    });
    expect(parseQuestions("a\tb\tc\t50\t\t3")).toEqual({
      error: "1行目: 所要時間（6列目）は5〜600秒の整数にしてください（空欄なら60秒）",
    });
    const s = initialState(parsed(text));
    expect(s.questions.map((q) => q.seconds)).toEqual([45, 90, 60]);
    applyAdmin(s, { t: "start", qid: s.questions[0].id }, 1000);
    expect(s.deadline).toBe(46000);
  });

  it("points at the bad row", () => {
    expect(parseQuestions("a\tb\tc\t50\nx\ty\tz\t120")).toEqual({ error: "2行目: 正解（4列目）は0〜100の数字にしてください" });
    expect(parseQuestions("a\t\tc\t50")).toEqual({ error: "1行目: お題・左・右の3つを入れてください" });
  });

  it("round-trips through the export", () => {
    const s = initialState(Q);
    const parsed = parseQuestions(toTsv(s.questions));
    expect(parsed).toEqual({ questions: Q.map((q) => ({ ...q, seconds: 60 })) });
  });

  it("is refused mid-round but keeps scores otherwise", () => {
    const s = started();
    expect(applyAdmin(s, { t: "questions", questions: Q }, 0)).toBeTruthy();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyAdmin(s, { t: "reveal" }, 2000);
    expect(applyAdmin(s, { t: "questions", questions: Q }, 3000)).toBeUndefined();
    expect(s.questions.every((q) => !s.results[q.id])).toBe(true);
    expect(standings(s)[0].score).toBe(0.5);
  });
});

describe("score graph", () => {
  it("lists each table's points per question in reveal order, with the rank before the latest one", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000); // Q1: table 1 misses by 0.5
    applyTable(s, 2, { t: "submit", v: 70 }, 1000); // table 2 by 5.5, table 3 didn't answer
    applyAdmin(s, { t: "reveal" }, 2000);
    applyAdmin(s, { t: "start", qid: s.questions[1].id }, 3000);
    applyTable(s, 2, { t: "submit", v: 40 }, 4000); // Q2: table 2 is spot on
    applyAdmin(s, { t: "reveal" }, 5000);
    s.adjust[3] = 1;
    applyAdmin(s, { t: "scores" }, 6000);

    const view = buildView(s, { role: "screen" }, new Set(), 6000);
    expect(view.board).toEqual({
      lastQNo: 2,
      rows: [
        { n: 1, pts: [0.5, 60], adjust: 0, prevRank: 1 },
        { n: 2, pts: [5.5, 0], adjust: 0, prevRank: 2 },
        { n: 3, pts: [75.5, 60], adjust: 1, prevRank: 3 },
      ],
    });
  });

  it("moves a replayed question to the end and leaves the graph out of other phases", () => {
    const s = started();
    applyAdmin(s, { t: "reveal" }, 1000);
    applyAdmin(s, { t: "start", qid: s.questions[1].id }, 2000);
    applyAdmin(s, { t: "reveal" }, 3000);
    applyAdmin(s, { t: "start", qid: s.questions[0].id }, 4000);
    expect(buildView(s, { role: "screen" }, new Set(), 4000).board).toBeUndefined();
    applyAdmin(s, { t: "reveal" }, 5000);
    expect(s.played).toEqual([s.questions[1].id, s.questions[0].id]);
  });
});

describe("editing questions", () => {
  const NEW = { prompt: "新しい問題", left: "低い", right: "高い", target: 30.25, comment: "解説" };

  it("adds, edits and deletes one question at a time", () => {
    const s = initialState(Q);
    expect(applyAdmin(s, { t: "addQuestion", question: NEW }, 0)).toBeUndefined();
    expect(s.questions).toHaveLength(3);
    const added = s.questions[2];
    expect(added).toMatchObject({ prompt: "新しい問題", target: 30.3 });
    expect(added.id).not.toBe(s.questions[1].id);

    const edit = { prompt: "直した問題", left: "A", right: "B", target: 10 };
    expect(applyAdmin(s, { t: "updateQuestion", id: added.id, question: edit }, 0)).toBeUndefined();
    expect(s.questions[2]).toEqual({ id: added.id, ...edit, seconds: 60 }); // comment cleared, id kept, default time

    expect(applyAdmin(s, { t: "deleteQuestion", id: s.questions[0].id }, 0)).toBeUndefined();
    expect(s.questions.map((q) => q.prompt)).toEqual(["朝型？夜型？", "直した問題"]);
  });

  it("says what is wrong with a question", () => {
    const s = initialState(Q);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, prompt: "  " } }, 0)).toBe("お題を入力してください");
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, target: 101 } }, 0)).toMatch(/正解/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, target: NaN } }, 0)).toMatch(/正解/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, seconds: 2 } }, 0)).toMatch(/回答時間/);
    expect(applyAdmin(s, { t: "updateQuestion", id: "nope", question: NEW }, 0)).toBeTruthy();
    expect(applyAdmin(s, { t: "deleteQuestion", id: "nope" }, 0)).toBeTruthy();
    expect(s.questions).toHaveLength(2);
  });

  it("leaves the round on screen alone but lets the others change", () => {
    const s = started();
    const [live, other] = s.questions;
    expect(applyAdmin(s, { t: "updateQuestion", id: live.id, question: NEW }, 1)).toBeTruthy();
    expect(applyAdmin(s, { t: "deleteQuestion", id: live.id }, 1)).toBeTruthy();
    expect(applyAdmin(s, { t: "updateQuestion", id: other.id, question: NEW }, 1)).toBeUndefined();
    expect(applyAdmin(s, { t: "addQuestion", question: NEW }, 1)).toBeUndefined();
    expect(s.questions[0]).toEqual(live);
  });

  it("scores a revealed question again when its answer changes", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyAdmin(s, { t: "reveal" }, 2000);
    const q = s.questions[0];
    applyAdmin(s, { t: "updateQuestion", id: q.id, question: { ...Q[0], target: 70 } }, 3000);
    expect(s.results[q.id].points).toEqual({ 1: 5, 2: 70, 3: 70 });
  });

  it("drops a deleted question's points, and leaves the reveal screen if it was showing", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyAdmin(s, { t: "reveal" }, 2000);
    const id = s.questions[0].id;
    expect(applyAdmin(s, { t: "deleteQuestion", id }, 3000)).toBeUndefined();
    expect(s.results[id]).toBeUndefined();
    expect(s.played).toEqual([]);
    expect(s.phase).toBe("lobby");
    expect(standings(s).every((r) => r.score === 0)).toBe(true);
    expect(buildView(s, { role: "screen" }, new Set(), 0).question).toBeNull();
  });
});
