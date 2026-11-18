// Layout check: npm run check:screen | npm run check:phone   [-- outdir]
// Needs `npm run dev` running and Google Chrome installed (CHROME=path to use another).
// It RESETS the local game, then drives it through every phase with hard content
// (long prompt, long answer, long names, 12 tables) and, at several window sizes,
// reports text that leaves the page, is too wide for its box, or overlaps other
// text, or a number or short label broken over two lines. On a phone at least
// 650px tall it also reports when the 回答 button needs scrolling to reach.
// Screenshots go to outdir. ONLY=lobby,finale,... runs just those phases.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGE = process.argv[2] === "phone" ? "phone" : "screen";
const OUT = process.argv[3] ?? mkdtempSync(join(tmpdir(), `hacho-${PAGE}-`));
const ONLY = process.env.ONLY?.split(",");
mkdirSync(OUT, { recursive: true });
const APP = "http://localhost:5173";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES =
  PAGE === "screen"
    ? [[1920, 1080], [1280, 720], [1067, 660], [1280, 800], [1024, 768], [1440, 900], [2560, 1080], [800, 600]]
    : [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932], [768, 1024], [740, 360]];
const PHONE = 2; // the table whose phone is checked

// ---- the game, over the admin WebSocket ----
function open(q) {
  return new Promise((res, rej) => {
    const ws = new WebSocket("ws://localhost:5173/ws?" + q);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "state") ws.last = m; if (m.t === "error") console.log("error:", m.msg); };
    ws.onopen = async () => { for (let i = 0; i < 50 && !ws.last; i++) await wait(50); res(ws); };
    ws.onerror = rej;
  });
}
const admin = await open("role=admin&k=dev");
const send = async (m, ms = 300) => { admin.send(JSON.stringify(m)); await wait(ms); };
const QUESTIONS = [
  { prompt: "キリンの1日の平均睡眠時間は？", left: "0時間", right: "24時間", target: 0.33, comment: "わずか約20分（0.33時間）！敵に襲われないよう立ったまま数分ずつしか寝ません", step: 0.01 },
  { prompt: "富士山の高さは？", left: "0m", right: "5,000m", target: 3776, comment: "剣ヶ峰の標高は3,776mです" },
  { prompt: "日本で一番人口が多い市町村（東京23区を除く）、横浜市の人口はおよそ何人でしょうか？ちょっと長めのお題でも収まるか確かめます", left: "0人", right: "5,000,000人", target: 3770000, comment: "2024年の推計で約377万人。これは解説がとても長い場合の確認用の文章で、三行以上になっても枠からはみ出さないかを見ます。さらにもう一文足しておきます。" },
  { prompt: "日本の国旗の赤い丸は、正確にはどんな赤？", left: "明るい赤 #FF9A9A", right: "暗い赤 #4A0012", target: 0, color: "#BC002D", comment: "法律では「紅色」とだけ決まっています。#BC002D はよく使われる値です" },
  { prompt: "社長が好きなカレーの辛さは？", left: "甘口", right: "激辛", target: 70, comment: "社長に事前に聞いた答えを正解にしてください" },
];
const NAMES = ["営業二課", "カスタマーサクセス第一グループ", "経理のみなさん", "開発", "人事", "総務", "マーケティング戦略推進室", "品質保証", "情報システム", "広報", "法務", "カレー部"];
async function setup(tables, hide, named = true) {
  await send({ t: "reset" });
  await send({ t: "questions", questions: QUESTIONS });
  await send({ t: "settings", tableCount: tables, hideTotals: hide });
  if (named) for (let i = 0; i < tables; i++) await send({ t: "rename", n: i + 1, name: NAMES[i % NAMES.length] }, 30);
}
async function answer(n, f, submit = true) {
  const sc = admin.last.question.scale;
  const t = await open(`role=table&n=${n}&k=${admin.last.admin.tokens[n]}`);
  t.send(JSON.stringify({ t: submit ? "submit" : "move", v: sc.min + f * (sc.max - sc.min) }));
  await wait(80); t.close();
}
async function round(qi, fs) {
  await send({ t: "start", qid: admin.last.admin.questions[qi].id });
  for (const [i, f] of fs.entries()) if (f != null) await answer(i + 1, f);
}
const reveal = async () => { await send({ t: "close" }); await send({ t: "reveal" }); };

// ---- the browser ----
const port = 9333;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "hacho-chrome-"))}`, "--no-first-run", "--hide-scrollbars", "--mute-audio", "about:blank"], { stdio: "ignore" });
let list; for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await wait(200); } }
const page = list.find((t) => t.type === "page");
const cdp = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (cdp.onopen = r));
let id = 0; const pending = new Map();
cdp.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); cdp.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

// Runs in the page. The projector must stay on its stage; a phone may scroll down
// but never sideways, and while answering the button must be on screen.
const CHECK = (page) => `(() => {
  const PAGE = ${JSON.stringify(page)};
  const root = document.querySelector(PAGE === "screen" ? ".screen" : ".phone"); if (!root) return ["no ." + PAGE];
  const doc = document.documentElement;
  const S = PAGE === "screen" ? root.getBoundingClientRect() : { left: 0, top: -scrollY, right: innerWidth, bottom: doc.scrollHeight - scrollY };
  const bad = [];
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  const pinned = (e) => { for (let p = e; p; p = p.parentElement) if (getComputedStyle(p).position === "fixed") return true; return false; };
  const shown = (e) => { const cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05; };
  // text pieces: elements with their own text, outside the dial's svg
  const leaves = [...root.querySelectorAll("*")].filter((e) => !e.closest("svg") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && shown(e) && !pinned(e));
  // the visible part of the text: big display type has a tall empty band above and below its glyphs
  const box = (e) => {
    const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); const pad = b.height * 0.15;
    // text cut off with an ellipsis only shows inside its own box
    if (getComputedStyle(e).overflowX !== "visible") { const c = e.getBoundingClientRect(); const l = Math.max(b.left, c.left), rr = Math.min(b.right, c.right); return { left: l, right: rr, width: rr - l, top: b.top + pad, bottom: b.bottom - pad, height: b.height - 2 * pad }; }
    return { left: b.left, right: b.right, width: b.width, top: b.top + pad, bottom: b.bottom - pad, height: b.height - 2 * pad };
  };
  const items = leaves.map((e) => ({ e, r: box(e), t: e.textContent.trim().slice(0, 20) })).filter((x) => x.r.width > 1);
  if (PAGE === "phone" && doc.scrollWidth > innerWidth + 1) bad.push("page scrolls sideways (" + doc.scrollWidth + " in " + innerWidth + ")");
  for (const { e, r, t } of items)
    if (r.right > S.right + 2 || r.bottom > S.bottom + 2 || r.left < S.left - 2 || r.top < S.top - 2)
      bad.push("text outside " + (PAGE === "screen" ? "stage" : "page") + ": " + name(e) + " " + t);
  for (const { e } of items) {
    if (getComputedStyle(e).display === "inline") continue;
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 3 && getComputedStyle(e).overflowX !== "hidden") bad.push("too wide for its box: " + name(e) + " (" + e.scrollWidth + " in " + e.clientWidth + ") " + (e.textContent||"").trim().slice(0, 20));
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 4 && h > 4 && w * h > 0.15 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) bad.push("overlap: " + name(a.e) + " " + a.t + "  ×  " + name(b.e) + " " + b.t);
  }
  // a number or a short label in display type broken over two lines ("3,770,000 / 人", "首位争 / い")
  for (const e of root.querySelectorAll("b, .display, .points, .total-pill, .nudge-value")) {
    const t = (e.textContent || "").trim();
    if (!t || t.length > 14 || e.closest("svg") || !shown(e) || pinned(e)) continue;
    const r = document.createRange(); r.selectNodeContents(e);
    // pieces that overlap vertically sit on one line (a big number and its small 点 have different tops)
    let lines = 0, floor = -Infinity;
    for (const x of [...r.getClientRects()].filter((x) => x.width > 1).sort((p, q) => p.top - q.top)) {
      if (x.top >= floor - 2) lines++;
      floor = Math.max(floor, x.bottom);
    }
    if (lines > 1) bad.push("broken over lines: " + name(e) + " " + t);
  }
  if (PAGE === "phone") {
    const act = root.querySelector(".phone-round > .primary, .phone-round > .submitted");
    // on screens under 650px tall (sideways, old small phones) a short scroll is accepted
    if (act && innerHeight >= 650 && act.getBoundingClientRect().bottom > innerHeight + 1) bad.push("needs scrolling to reach: " + name(act) + " " + act.textContent.trim().slice(0, 20));
  }
  return [...new Set(bad)];
})()`;

let failures = 0;
async function shoot(label, settle = 1500) {
  if (ONLY && !ONLY.includes(label)) return;
  const url = PAGE === "screen" ? `${APP}/screen` : `${APP}/t/${PHONE}/${admin.last.admin.tokens[PHONE]}`;
  for (const [w, h] of SIZES) {
    const mobile = PAGE === "phone" && w < 700;
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await call("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    await call("Page.navigate", { url });
    await wait(settle);
    const bad = await evaluate(CHECK(PAGE));
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: PAGE === "phone" });
    writeFileSync(`${OUT}/${label}-${w}x${h}.png`, Buffer.from(shot.result.data, "base64"));
    if (bad.length) failures++;
    console.log(`${bad.length ? "FAIL" : "ok  "} ${label} ${w}x${h}${bad.length ? "\n      " + bad.join("\n      ") : ""}`);
  }
}

const SPREAD = [0.7, 0.75, 0.2, 0.9, 0.5, 0.6, 0.76, 0.1, 0.3, 0.8, 0.74, 0.4];
if (PAGE === "screen") {
  await setup(12, true);
  await shoot("lobby");
  await round(0, [0.3, 0.02, 0.5, 0.1, null, 0.8, 0.4, 0.2, 0.6, null, 0.05, 0.9]);
  await shoot("open");
  await send({ t: "close" });
  await shoot("closed");
  await send({ t: "reveal" });
  await shoot("reveal-giraffe", 4500);
  await round(1, SPREAD); await reveal();
  await shoot("reveal-fuji", 4500);
  await round(2, SPREAD); await reveal();
  await shoot("reveal-long", 4500);
  await round(3, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35]); await reveal();
  await shoot("reveal-color", 4500);
  await send({ t: "scores" });
  await shoot("scores-groups");
  await send({ t: "settings", tableCount: 12, hideTotals: false });
  await shoot("scores-board");
  await send({ t: "start", qid: admin.last.admin.questions[4].id }); await reveal();
  await shoot("reveal-bands", 4500);
  await send({ t: "rename", n: 2, name: "カスタマーサクセス第一グループ" });
  await send({ t: "finale" });
  for (let i = 0; i < 3; i++) await send({ t: "finaleNext" }, 200);
  await shoot("finale", 6000);
} else {
  await setup(12, true, false);
  await shoot("name");
  for (let i = 0; i < 12; i++) await send({ t: "rename", n: i + 1, name: NAMES[i] }, 30);
  await shoot("lobby");
  await send({ t: "start", qid: admin.last.admin.questions[2].id });
  await answer(PHONE, 0.754, false);
  await shoot("open-long");
  await answer(PHONE, 0.754);
  for (const [i, f] of SPREAD.entries()) if (i + 1 !== PHONE) await answer(i + 1, f);
  await shoot("open-submitted");
  await send({ t: "close" });
  await shoot("closed");
  await send({ t: "reveal" });
  await shoot("reveal-long", 2500);
  await send({ t: "start", qid: admin.last.admin.questions[3].id });
  await shoot("open-color");
  await round(3, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35]); await reveal();
  await shoot("reveal-color", 2500);
  await send({ t: "scores" });
  await shoot("scores-groups");
  await send({ t: "settings", tableCount: 12, hideTotals: false });
  await round(0, SPREAD); await reveal();
  await shoot("reveal-totals", 2500);
  await send({ t: "scores" });
  await shoot("scores-rank");
  await send({ t: "finale" });
  await shoot("finale-wait");
  for (let i = 0; i < 3; i++) await send({ t: "finaleNext" }, 200);
  await shoot("finale-done", 2500);
}

console.log(failures ? `\n${failures} size/phase combinations with problems` : "\nall clear");
console.log(`screenshots: ${OUT}`);
admin.close(); cdp.close(); chrome.kill();
process.exit(failures ? 1 : 0);
