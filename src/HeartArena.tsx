import type { ComponentChildren } from "preact";
import type { TableRow, View } from "../shared/game";
import { fmt } from "./Dial";

// The projector's other score view: every table on a card around the edges of
// the screen, with the round in the middle. A table starts with 100 HP per
// question, shown as one heart each, and every reveal takes off its miss.

// Tables go clockwise from the top-left: across the top, down the right, back
// along the bottom and up the left. 20 tables: 6 top, 4 right, 6 bottom, 4 left.
export function seatSplit(count: number) {
  const side = Math.floor(count / 5);
  const top = Math.ceil((count - 2 * side) / 2);
  const bottom = count - 2 * side - top;
  return { top, side, bottom };
}

export function HeartArena({ view, children }: { view: View; children: ComponentChildren }) {
  const t = view.tables;
  const { top, side, bottom } = seatSplit(t.length);
  const rows = {
    top: t.slice(0, top),
    right: t.slice(top, top + side),
    bottom: t.slice(top + side, top + side + bottom), // the row runs right to left in CSS
    left: t.slice(top + side + bottom).reverse(),
  };
  const card = (row: TableRow) => <HeartCard row={row} view={view} />;
  return (
    <div class="arena" style={{ "--cols": Math.max(top, 1) }}>
      <div class="arena-row">{rows.top.map(card)}</div>
      <div class="arena-mid">
        {side > 0 && <div class="arena-col">{rows.left.map(card)}</div>}
        <div class="arena-center">{children}</div>
        {side > 0 && <div class="arena-col">{rows.right.map(card)}</div>}
      </div>
      {bottom > 0 && <div class="arena-row arena-row-bottom">{rows.bottom.map(card)}</div>}
    </div>
  );
}

function HeartCard({ row, view }: { row: TableRow; view: View }) {
  const hearts = Math.max(1, view.qCount);
  const max = hearts * 100;
  const hp = Math.min(max, Math.max(0, max - row.score));
  const lead = view.played > 0 && row.rank === 1;
  // this question's miss, shown while the answer is up
  const hit = view.phase === "reveal" ? view.result?.points[row.n] : undefined;
  return (
    <div class={`hp-card${lead ? " hp-lead" : ""}`}>
      <div class="hp-top">
        <span class="hp-no">{row.n}</span>
        <span class="hp-name">{row.name}</span>
        {hit != null && hit > 0 && <span class="hp-hit">-{fmt(hit)}</span>}
        {lead && <Crown />}
        <span class="hp-value">{fmt(hp)}</span>
      </div>
      <div class="hp-hearts" aria-label={`残り${fmt(hp)} / ${max}`}>
        {Array.from({ length: hearts }, (_, i) => {
          const f = Math.min(1, Math.max(0, (hp - i * 100) / 100));
          const cut = `inset(0 ${(1 - f) * 100}% 0 0)`;
          return (
            <span class="heart">
              <HeartSvg class="heart-empty" />
              <HeartSvg class="heart-lag" style={{ clipPath: cut }} />
              <HeartSvg class="heart-full" style={{ clipPath: cut }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

const HEART = "M0,-6 C-4,-16 -20,-14 -20,-2 C-20,8 -8,14 0,22 C8,14 20,8 20,-2 C20,-14 4,-16 0,-6 Z";

function HeartSvg(props: { class: string; style?: Record<string, string> }) {
  return (
    <svg viewBox="-22 -17 44 41" aria-hidden="true" {...props}>
      <path d={HEART} />
    </svg>
  );
}

function Crown() {
  return (
    <svg class="hp-crown" viewBox="-28 -22 56 44" aria-label="トップ">
      <path d="M-22,10 L-26,-14 L-11,-2 L0,-20 L11,-2 L26,-14 L22,10 Z" />
      <rect x={-22} y={12} width={44} height={7} rx={2} />
    </svg>
  );
}
