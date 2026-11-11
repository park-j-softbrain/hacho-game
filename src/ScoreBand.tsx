import { useId } from "preact/hooks";
import type { TableRow } from "../shared/game";
import { fmt } from "./Dial";

// The projector's bottom band: every table's total as an equalizer bar, in table
// order so each table finds its bar in the same place. The table with the fewest
// points is the only thing in gold, under a pulsing spotlight with a crown.
const W = 1900;
const H = 250;
const L = 40;
const R = W - 40;
const TOP = 96; // the tallest bar reaches here; the caption sits above
const BOT = 206; // bar baseline; table numbers below
const SPEC = ["#5ad1e6", "#4f7bff", "#8a4dff", "#ff48b0", "#ff8a3d"];
const GOLD = "#ffd23f";

export function ScoreBand({ tables }: { tables: TableRow[] }) {
  const id = useId().replace(/[^\w-]/g, "");
  if (tables.length === 0) return null;
  const top = Math.max(10, ...tables.map((t) => t.score));
  const slot = (R - L) / tables.length;
  const bw = slot * 0.5;
  const height = (s: number) => Math.max(4, (Math.max(0, s) / top) * (BOT - TOP));
  const leaders = tables.filter((t) => t.rank === 1);
  const first = tables.indexOf(leaders[0]);
  const fx = L + slot * (first + 0.5);
  // the caption goes beside the leader, on whichever side has more room
  const right = fx < W / 2;

  return (
    <div class="score-band">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`合計のズレ。トップは${leaders.map((t) => `${t.n} ${t.name}（${fmt(t.score)}点）`).join("、")}`}
      >
        <defs>
          <linearGradient id={`${id}-spec`} x1={0} x2={W} y1={0} y2={0} gradientUnits="userSpaceOnUse">
            {SPEC.map((c, i) => (
              <stop offset={i / (SPEC.length - 1)} stop-color={c} />
            ))}
          </linearGradient>
          <linearGradient id={`${id}-gold`} x1={0} x2={0} y1={0} y2={1}>
            <stop offset={0} stop-color="#fff6c8" />
            <stop offset={0.5} stop-color={GOLD} />
            <stop offset={1} stop-color="#ff9d2e" />
          </linearGradient>
          <linearGradient id={`${id}-beam`} x1={0} x2={0} y1={0} y2={1}>
            <stop offset={0} stop-color={GOLD} stop-opacity={0} />
            <stop offset={1} stop-color={GOLD} stop-opacity={0.22} />
          </linearGradient>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {tables.map((t, i) => {
          const x = L + slot * i + (slot - bw) / 2;
          const cx = x + bw / 2;
          const h = height(t.score);
          const win = t.rank === 1;
          return (
            <g>
              {win ? (
                <>
                  <rect class="band-beam" x={L + slot * i + 4} y={8} width={slot - 8} height={BOT - 8} rx={12} fill={`url(#${id}-beam)`} />
                  <rect x={x} y={BOT - h} width={bw} height={h} rx={4} fill={`url(#${id}-gold)`} filter={`url(#${id}-glow)`} />
                  <Crown x={cx} y={BOT - h - 30} glow={`url(#${id}-glow)`} />
                </>
              ) : (
                <>
                  {/* a bar drawn as three slim lines, like an equalizer */}
                  {[0, 1, 2].map((k) => {
                    const hk = h * (1 - k * 0.06);
                    return (
                      <rect x={x + k * (bw / 3) + 1} y={BOT - hk} width={bw / 3 - 3} height={hk} rx={2} fill={`url(#${id}-spec)`} opacity={0.8 - k * 0.15} />
                    );
                  })}
                  <text class="band-value" x={cx} y={BOT - h - 9}>
                    {fmt(t.score)}
                  </text>
                </>
              )}
              <text class={`band-no${win ? " band-win" : ""}`} x={cx} y={BOT + 32}>
                {t.n}
              </text>
            </g>
          );
        })}

        <g class="band-caption" text-anchor={right ? "start" : "end"}>
          <text class="band-caption-name" x={fx + (right ? 1 : -1) * Math.max(slot * 0.7, 46)} y={34}>
            {leaders.length > 1 ? `トップ ${leaders.map((t) => t.n).join("・")}` : `トップ ${leaders[0].n} ${leaders[0].name}`}
          </text>
          <text class="band-caption-score" x={fx + (right ? 1 : -1) * Math.max(slot * 0.7, 46)} y={70}>
            {fmt(leaders[0].score)}点
          </text>
        </g>
        <text class="band-note" x={R} y={30}>
          合計のズレ　低いほど上位
        </text>
      </svg>
    </div>
  );
}

function Crown({ x, y, glow }: { x: number; y: number; glow: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(0.8)`} filter={glow}>
      <path d="M-22,10 L-26,-14 L-11,-2 L0,-20 L11,-2 L26,-14 L22,10 Z" fill={GOLD} stroke="#fff6c8" stroke-width={1.5} stroke-linejoin="round" />
      <rect x={-22} y={12} width={44} height={6} rx={2} fill={GOLD} />
    </g>
  );
}
