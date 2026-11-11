import type { TableRow, View } from "../shared/game";
import { fmt } from "./Dial";

// The projector's other score view: every table drawn along the bottom in two
// rows, its number on the front and a healthbar above it. A table starts with
// 100 HP per question and every reveal takes off its miss, slowly: the miss pops
// up, then the bar drops, then the white trail behind it drains, and only then
// do the 1位〜3位 tags and the crown move (the delays live in style.css).
export function TableBand({ view }: { view: View }) {
  const t = view.tables;
  if (t.length === 0) return null;
  const max = Math.max(1, view.qCount) * 100;
  const ranked = view.played > 0;
  const leaders = ranked ? t.filter((r) => r.rank === 1) : [];
  const hp = (r: TableRow) => Math.min(max, Math.max(0, max - r.score));
  const label = leaders.length
    ? `のこりHP。トップは${leaders.map((r) => `${r.n} ${r.name}（${fmt(hp(r))}）`).join("、")}`
    : "のこりHP";
  return (
    <div
      class={`table-band${view.phase === "reveal" ? " reveal" : ""}`}
      style={{ "--cols": Math.ceil(t.length / 2), "--segs": Math.max(1, view.qCount) }}
      role="img"
      aria-label={label}
    >
      {t.map((r) => (
        <Seat row={r} view={view} max={max} hp={hp(r)} rank={ranked && r.rank <= 3 ? r.rank : 0} />
      ))}
    </div>
  );
}

const KANJI = ["一", "二", "三"];

function Seat({ row, view, max, hp, rank }: { row: TableRow; view: View; max: number; hp: number; rank: number }) {
  // this question's miss, shown while the answer is up
  const hit = view.phase === "reveal" ? view.result?.points[row.n] : undefined;
  const pct = `${(hp / max) * 100}%`;
  const cls = ["seat", rank ? `r${rank}` : "", hp / max < 0.2 ? "low" : "", hit != null && hit > 50 ? "shake" : ""];
  return (
    <div class={cls.filter(Boolean).join(" ")}>
      {/* keyed on the rank, so a new place mounts fresh and fades in after the bars settle */}
      {rank > 0 && <i class="seat-spot" key={`spot${rank}`} />}
      <div class="seat-hp">
        <div class="seat-num">
          {rank > 0 && (
            <span class="seat-rank" key={`rank${rank}`}>
              {KANJI[rank - 1]}位
            </span>
          )}
          <span class="seat-v" style={{ "--hp": Math.round(hp) }} />
          <small>/ {max}</small>
        </div>
        <div class="seat-bar">
          <i class="seat-lag" style={{ width: pct }} />
          <i class="seat-fill" style={{ width: pct }} />
          <span class="seat-ticks" />
        </div>
      </div>
      <div class="seat-table">
        {rank === 1 && <Crown key="crown" />}
        <TableSvg n={row.n} />
        {hit != null && (
          <span class={`seat-hit${hit === 0 ? " zero" : ""}`}>{hit === 0 ? "ピタリ!" : `-${fmt(hit)}`}</span>
        )}
      </div>
    </div>
  );
}

const TOP = "M80,170 L420,170 L466,346 L34,346 Z";
const DRAPE = (() => {
  const x0 = 30;
  const x1 = 470;
  const n = 9;
  const w = (x1 - x0) / n;
  let d = `M34,346 L466,346 L${x1},470`;
  for (let i = n; i > 0; i--) d += ` Q${x0 + (i - 0.5) * w},488 ${x0 + (i - 1) * w},470`;
  return `${d} Z`;
})();

function TableSvg({ n }: { n: number }) {
  const two = n > 9;
  return (
    <svg class="seat-svg" viewBox="20 160 460 360" aria-hidden="true">
      <rect class="o" x={104} y={462} width={18} height={50} rx={4} fill="#2a4590" />
      <rect class="o" x={378} y={462} width={18} height={50} rx={4} fill="#2a4590" />
      <path class="o" d={TOP} fill="#3f63b8" />
      <path d="M110,200 L390,200" stroke="#ffffff" stroke-opacity={0.25} stroke-width={10} stroke-linecap="round" />
      <path class="o" d={DRAPE} fill="#3255a4" />
      <text x={250} y={two ? 452 : 458} font-size={two ? 92 : 104}>
        {n}
      </text>
    </svg>
  );
}

function Crown() {
  return (
    <svg class="seat-crown" viewBox="-30 -24 60 46" aria-hidden="true">
      <path d="M-22,10 L-26,-14 L-11,-2 L0,-20 L11,-2 L26,-14 L22,10 Z" />
      <rect x={-22} y={12} width={44} height={7} rx={2} />
      <circle class="gem" cx={0} cy={-20} r={3.5} />
    </svg>
  );
}
