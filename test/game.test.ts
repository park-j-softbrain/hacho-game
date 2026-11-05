import { describe, expect, it } from "vitest";
import {
  applyAdmin,
  applyTable,
  buildView,
  closeIfExpired,
  GRACE_MS,
  initialState,
  pointsFor,
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
  expect(applyAdmin(s, { t: "start", qid: s.questions[0].id, seconds: 60 }, now)).toBeUndefined();
  return s;
}

describe("scoring", () => {
  it("gives 4 / 3 / 2 / 0 by distance from the target", () => {
    expect(pointsFor(75, 75.5)).toBe(4);
    expect(pointsFor(73, 75.5)).toBe(4); // 2.5 away: edge of the bullseye
    expect(pointsFor(70, 75.5)).toBe(3);
    expect(pointsFor(64, 75.5)).toBe(2);
    expect(pointsFor(62, 75.5)).toBe(0);
  });

  it("ranks equal scores together", () => {
    const s = initialState(Q);
    s.tableCount = 3;
    s.adjust = { 1: 5, 2: 5, 3: 1 };
    expect(standings(s).map((r) => [r.n, r.rank])).toEqual([
      [1, 1],
      [2, 1],
      [3, 3],
    ]);
  });
});

describe("a round", () => {
  it("counts submitted answers and last needle positions, and nothing for untouched tables", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyTable(s, 2, { t: "move", v: 66 }, 2000);
    applyAdmin(s, { t: "close" }, 3000);
    applyAdmin(s, { t: "reveal" }, 4000);
    expect(s.results[s.questions[0].id].points).toEqual({ 1: 4, 2: 2 });
    expect(standings(s).map((r) => r.score)).toEqual([4, 2, 0]);
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
    expect(standings(s).find((r) => r.n === 1)!.score).toBe(0);
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

  it("points at the bad row", () => {
    expect(parseQuestions("a\tb\tc\t50\nx\ty\tz\t120")).toEqual({ error: "2行目: 正解（4列目）は0〜100の数字にしてください" });
    expect(parseQuestions("a\t\tc\t50")).toEqual({ error: "1行目: お題・左・右の3つを入れてください" });
  });

  it("round-trips through the export", () => {
    const s = initialState(Q);
    const parsed = parseQuestions(toTsv(s.questions));
    expect(parsed).toEqual({ questions: Q });
  });

  it("is refused mid-round but keeps scores otherwise", () => {
    const s = started();
    expect(applyAdmin(s, { t: "questions", questions: Q }, 0)).toBeTruthy();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000);
    applyAdmin(s, { t: "reveal" }, 2000);
    expect(applyAdmin(s, { t: "questions", questions: Q }, 3000)).toBeUndefined();
    expect(s.questions.every((q) => !s.results[q.id])).toBe(true);
    expect(standings(s)[0].score).toBe(4);
  });
});

describe("score graph", () => {
  it("lists each table's points per question in reveal order, with the rank before the latest one", () => {
    const s = started();
    applyTable(s, 1, { t: "submit", v: 75 }, 1000); // Q1: table 1 gets 4
    applyTable(s, 2, { t: "submit", v: 70 }, 1000); // table 2 gets 3
    applyAdmin(s, { t: "reveal" }, 2000);
    applyAdmin(s, { t: "start", qid: s.questions[1].id }, 3000);
    applyTable(s, 2, { t: "submit", v: 40 }, 4000); // Q2: table 2 gets 4
    applyAdmin(s, { t: "reveal" }, 5000);
    s.adjust[3] = 1;
    applyAdmin(s, { t: "scores" }, 6000);

    const view = buildView(s, { role: "screen" }, new Set(), 6000);
    expect(view.board).toEqual({
      lastQNo: 2,
      rows: [
        { n: 1, pts: [4, 0], adjust: 0, prevRank: 1 },
        { n: 2, pts: [3, 4], adjust: 0, prevRank: 2 },
        { n: 3, pts: [0, 0], adjust: 1, prevRank: 3 },
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
