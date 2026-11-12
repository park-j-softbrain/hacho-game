import { describe, expect, it } from "vitest";
import {
  applyAdmin,
  applyTable,
  buildView,
  closeIfExpired,
  GRACE_MS,
  initialState,
  migrate,
  missPenalty,
  podium,
  pointsFor,
  scaleOf,
  snap,
  roundRanks,
  standings,
  type GameState,
} from "../shared/game";
import { parseQuestions, toTsv } from "../shared/questions";

const Q = [
  { prompt: "森林の割合", left: "0%", right: "100%", target: 75.5, comment: "約3分の2" },
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
    const q = { left: "ナシ", right: "アリ", target: 75.5, worth: 100 };
    expect(pointsFor(q, 75.5)).toBe(0);
    expect(pointsFor(q, 75)).toBe(0.5);
    expect(pointsFor(q, 64)).toBe(11.5);
    expect(pointsFor({ ...q, target: 0.3 }, 0.1)).toBe(0.2); // no floating-point tails
    expect(missPenalty(q)).toBe(75.5);
    expect(missPenalty({ ...q, target: 40 })).toBe(60);
  });

  it("scores the miss as a share of the question's range, times its worth", () => {
    const fuji = { left: "0m", right: "5,000m", target: 2700, worth: 100 };
    expect(pointsFor(fuji, 2750)).toBe(1); // |2700 − 2750| × 100 ÷ 5000
    expect(pointsFor({ ...fuji, worth: 200 }, 2750)).toBe(2);
    expect(missPenalty(fuji)).toBe(54); // the farther end, 0m
    expect(pointsFor({ left: "-30℃", right: "40℃", target: 12, worth: 70 }, 2)).toBe(10);
  });

  it("reads the dial's range, unit and step from the end labels", () => {
    expect(scaleOf({ left: "0m", right: "5,000m" })).toEqual({ min: 0, max: 5000, unit: "m", step: 50 });
    expect(scaleOf({ left: "0m", right: "5000m", step: 10 })).toEqual({ min: 0, max: 5000, unit: "m", step: 10 });
    expect(scaleOf({ left: "0%", right: "100%", step: 0.2 })).toEqual({ min: 0, max: 100, unit: "%", step: 0.2 });
    expect(scaleOf({ left: "1900年", right: "2025年" })).toEqual({ min: 1900, max: 2025, unit: "年", step: 1 });
    expect(scaleOf({ left: "−30℃", right: "４０℃" })).toEqual({ min: -30, max: 40, unit: "℃", step: 0.5 });
    expect(scaleOf({ left: "ナシ", right: "アリ" })).toEqual({ min: 0, max: 100, unit: "", step: 1 });
    expect(scaleOf({ left: "0m", right: "5000m", step: 1 }).step).toBe(50); // finer than 1/1000 of the range: the default
    const fuji = scaleOf({ left: "0m", right: "5000m", step: 10 });
    expect(snap(fuji, 2746)).toBe(2750);
    expect(snap(fuji, 6000)).toBe(5000);
    expect(snap(scaleOf({ left: "0%", right: "100%", step: 0.2 }), 33.33)).toBe(33.4);
  });

  it("snaps a phone's needle onto the question's steps", () => {
    const s = initialState([{ prompt: "富士山", left: "0m", right: "5000m", target: 3776, step: 10, worth: 200 }]);
    s.tableCount = 2;
    applyAdmin(s, { t: "start", qid: s.questions[0].id }, 0);
    applyTable(s, 1, { t: "submit", v: 3784 }, 1000);
    expect(s.answers[1].v).toBe(3780);
    applyAdmin(s, { t: "reveal" }, 2000);
    expect(s.results[s.questions[0].id].points).toEqual({ 1: 0.2, 2: 151 }); // 4m × 200 ÷ 5000; no answer: 3776m × 200 ÷ 5000
    expect(buildView(s, { role: "screen" }, new Set(), 0).maxScore).toBe(200);
  });

  it("moves targets and answers saved on the old 0–100 scale onto each question's range", () => {
    const s = initialState([]);
    s.questions = [
      { id: "q1", prompt: "富士山", left: "0m", right: "5,000m", target: 75.5, seconds: 60 } as never,
      { id: "q2", prompt: "朝型？", left: "朝型", right: "夜型", target: 40, seconds: 60 } as never,
    ];
    s.results = { q1: { answers: { 1: 80 }, points: { 1: 4.5 } } };
    s.version = undefined;
    migrate(s);
    expect(s.questions.map((q) => [q.target, q.worth])).toEqual([[3775, 100], [40, 100]]);
    expect(s.results.q1).toEqual({ answers: { 1: 4000 }, points: { 1: 4.5 } });
    migrate(s); // only once
    expect(s.questions[0].target).toBe(3775);
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
    const text = "お題\t左\t右\t正解\t解説\n森林の割合\t0%\t100%\t７５.５%\t約3分の2\n\n朝型？\t朝型\t夜型\t40\n";
    expect(parseQuestions(text)).toEqual({
      questions: [
        { prompt: "森林の割合", left: "0%", right: "100%", target: 75.5, comment: "約3分の2" },
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

  it("reads 正解 in the question's unit, 配点 from the 7th column and 針の刻み from the 8th", () => {
    const text = "お題\t左\t右\t正解\t解説\t所要時間\t配点\t針の刻み\n富士山\t0m\t5,000m\t3,776m\t剣ヶ峰\t45\t200\t10\n朝型？\t朝型\t夜型\t40";
    expect(parseQuestions(text)).toEqual({
      questions: [
        { prompt: "富士山", left: "0m", right: "5,000m", target: 3776, comment: "剣ヶ峰", seconds: 45, worth: 200, step: 10 },
        { prompt: "朝型？", left: "朝型", right: "夜型", target: 40 },
      ],
    });
    expect(initialState(parsed(text)).questions.map((q) => [q.worth, q.step])).toEqual([[200, 10], [100, undefined]]);
    expect(parseQuestions("a\t0m\t5000m\t100\t\t\t1.5")).toEqual({ error: "1行目: 配点は1以上の整数にしてください" });
    expect(parseQuestions("a\t0m\t5000m\t100\t\t\t0")).toEqual({ error: "1行目: 配点は1以上の整数にしてください" });
    expect(parseQuestions("a\t0m\t5000m\t100\t\t\t\t1")).toEqual({
      error: "1行目: 針の刻みは5m〜5,000mの数字にしてください（空欄なら50m）",
    });
  });

  it("points at the bad row", () => {
    expect(parseQuestions("a\tb\tc\t50\nx\ty\tz\t120")).toEqual({ error: "2行目: 正解は0〜100の数字にしてください" });
    expect(parseQuestions("a\t0m\t5000m\t6000")).toEqual({ error: "1行目: 正解は0m〜5,000mの数字にしてください" });
    expect(parseQuestions("a\t\tc\t50")).toEqual({ error: "1行目: お題・左・右の3つを入れてください" });
  });

  it("round-trips through the export", () => {
    const s = initialState(Q);
    const parsed = parseQuestions(toTsv(s.questions));
    expect(parsed).toEqual({ questions: Q.map((q) => ({ ...q, seconds: 60, worth: 100 })) });
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
      qNos: [1, 2],
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
    expect(added).toMatchObject({ prompt: "新しい問題", target: 30.25, worth: 100 });
    expect(added.id).not.toBe(s.questions[1].id);

    const edit = { prompt: "直した問題", left: "A", right: "B", target: 10 };
    expect(applyAdmin(s, { t: "updateQuestion", id: added.id, question: edit }, 0)).toBeUndefined();
    expect(s.questions[2]).toEqual({ id: added.id, ...edit, seconds: 60, worth: 100 }); // comment cleared, id kept, defaults

    expect(applyAdmin(s, { t: "deleteQuestion", id: s.questions[0].id }, 0)).toBeUndefined();
    expect(s.questions.map((q) => q.prompt)).toEqual(["朝型？夜型？", "直した問題"]);
  });

  it("says what is wrong with a question", () => {
    const s = initialState(Q);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, prompt: "  " } }, 0)).toBe("お題を入力してください");
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, target: 101 } }, 0)).toMatch(/正解/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, target: NaN } }, 0)).toMatch(/正解/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, seconds: 2 } }, 0)).toMatch(/回答時間/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, worth: 0 } }, 0)).toMatch(/配点/);
    expect(applyAdmin(s, { t: "addQuestion", question: { ...NEW, step: 0.01 } }, 0)).toMatch(/針の刻み/);
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

describe("finale", () => {
  const scored = (pts: Record<number, number>) => {
    const s = initialState(Q);
    s.tableCount = 5;
    for (const [n, p] of Object.entries(pts)) s.adjust[Number(n)] = p;
    return s;
  };

  it("reveals 3位, 2位, then 1位, and tells the projector only what is out", () => {
    const s = scored({ 1: 30, 2: 10, 3: 20, 4: 40, 5: 50 });
    expect(applyAdmin(s, { t: "finaleNext" }, 0)).toBeTruthy(); // not in the finale yet
    applyAdmin(s, { t: "finale" }, 0);
    expect(buildView(s, { role: "screen" }, new Set(), 0).finale).toEqual({ total: 3, shown: 0, places: [] });
    applyAdmin(s, { t: "finaleNext" }, 0);
    const v = buildView(s, { role: "screen" }, new Set(), 0).finale!;
    expect(v.places).toEqual([{ rank: 3, tables: [{ n: 1, name: "テーブル1", score: 30 }] }]);
    applyAdmin(s, { t: "finaleNext" }, 0);
    applyAdmin(s, { t: "finaleNext" }, 0);
    expect(buildView(s, { role: "screen" }, new Set(), 0).finale!.places.map((p) => p.tables[0].n)).toEqual([1, 3, 2]);
    expect(applyAdmin(s, { t: "finaleNext" }, 0)).toBeTruthy(); // nothing left
  });

  it("puts tied tables on one step, and skips 3位 when two tables share 2位", () => {
    const s = scored({ 1: 10, 2: 20, 3: 20, 4: 40, 5: 50 });
    expect(podium(s).map((p) => [p.rank, p.tables.map((t) => t.n)])).toEqual([
      [2, [2, 3]],
      [1, [1]],
    ]);
  });
});
