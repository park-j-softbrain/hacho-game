import { useId, useRef } from "preact/hooks";

// A half-circle dial: 0 at the left end, 100 at the right end. Drawn like a
// two-ink risograph print: blue halftone track, a pink target line, and
// slightly misregistered pink "plates" under the needle.
const CX = 100;
const CY = 100;
const R = 94; // outer rim
const RI = 46; // inner edge of the track

function at(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

const TRACK = (() => {
  const [ox, oy] = at(0, R);
  const [ex, ey] = at(100, R);
  const [ix, iy] = at(100, RI);
  const [jx, jy] = at(0, RI);
  return `M${ox},${oy} A${R},${R} 0 0 1 ${ex},${ey} L${ix},${iy} A${RI},${RI} 0 0 0 ${jx},${jy} Z`;
})();

const TICKS = (() => {
  let major = "";
  let minor = "";
  for (let v = 0; v <= 100; v += 5) {
    const [a, b] = at(v, R - 2);
    const [c, d] = at(v, R - (v % 10 === 0 ? 9 : 6));
    if (v % 10 === 0) major += `M${a},${b} L${c},${d} `;
    else minor += `M${a},${b} L${c},${d} `;
  }
  return { major, minor };
})();

// hollow: a needle the table hasn't sent yet (admin view); best: the closest answer
export type Marker = { n: number; v: number; best?: boolean; hollow?: boolean };

type Props = {
  value?: number | null; // this table's needle
  target?: number | null; // draws the answer line
  markers?: Marker[]; // every table's needle (projector / admin)
  onChange?: (v: number) => void; // while dragging
  onCommit?: (v: number) => void; // on release
  disabled?: boolean;
  label?: string;
  sweep?: boolean; // the answer line swings in from the left end (projector reveal)
};

export function Dial({ value, target, markers, onChange, onCommit, disabled, label, sweep }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const last = useRef<number | null>(null);
  // Pattern ids must be unique when two dials share a page.
  const id = useId().replace(/[^\w-]/g, "");
  const interactive = !!onChange && !disabled;

  const valueAt = (e: PointerEvent): number => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    let a = Math.atan2(CY - p.y, p.x - CX);
    if (a < 0) a = p.x < CX ? Math.PI : 0; // below the dial: snap to the nearer end
    return Math.round(100 * (1 - a / Math.PI));
  };

  const down = (e: PointerEvent) => {
    if (!interactive) return;
    dragging.current = true;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // keep dragging without capture; the pointer just has to stay over the dial
    }
    last.current = valueAt(e);
    onChange!(last.current);
  };
  const move = (e: PointerEvent) => {
    if (!dragging.current) return;
    last.current = valueAt(e);
    onChange!(last.current);
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (last.current !== null) onCommit?.(last.current);
  };

  return (
    <svg
      ref={svg}
      class={`dial${interactive ? " dial-live" : ""}`}
      viewBox="-10 -10 220 120"
      role="img"
      aria-label={label ?? (value != null ? `ダイヤル。針は${value}の位置` : "ダイヤル")}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <defs>
        <pattern id={`${id}-track`} width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
          <circle class="ink-blue" cx="1.7" cy="1.7" r="0.62" />
        </pattern>
      </defs>
      <path d={TRACK} fill={`url(#${id}-track)`} />
      <path class="dial-outline" d={TRACK} />
      <path class="dial-tick" d={TICKS.major} />
      <path class="dial-tick dial-tick-minor" d={TICKS.minor} />
      {target != null && <TargetLine target={target} sweep={sweep} />}
      {markers && <Markers markers={markers} />}
      {value != null && <Needle v={value} />}
      <circle class="dial-hub" cx={CX} cy={CY} r={8} />
      <circle class="dial-hub-dot" cx={CX} cy={CY} r={3} />
    </svg>
  );
}

// Drawn pointing at 0 and turned to the answer, so a sweep is one CSS rotation.
function TargetLine({ target, sweep }: { target: number; sweep?: boolean }) {
  return (
    <line
      class={`target-line${sweep ? " target-sweep" : ""}`}
      x1={CX - 10}
      y1={CY}
      x2={CX - R - 3}
      y2={CY}
      style={{ transform: `rotate(${(target / 100) * 180}deg)` }}
    />
  );
}

function Needle({ v }: { v: number }) {
  const [x, y] = at(v, R + 2);
  return (
    <g class="needle">
      <g class="needle-plate" transform="translate(1.4 1)">
        <line x1={CX} y1={CY} x2={x} y2={y} />
        <circle cx={x} cy={y} r={6} />
      </g>
      <line class="needle-ink" x1={CX} y1={CY} x2={x} y2={y} />
      <circle class="needle-ink" cx={x} cy={y} r={6} />
      <circle class="needle-dot" cx={x} cy={y} r={2.2} />
    </g>
  );
}

// Every table's needle, with its number at the tip. Each number goes on the
// outermost ring where it clears the numbers already placed; with 20 tables
// answering close together the dots shrink and use more rings.
function Markers({ markers }: { markers: Marker[] }) {
  const dense = markers.length > 12;
  const dot = dense ? 4.8 : 5.6;
  const rings = Array.from({ length: dense ? 6 : 5 }, (_, i) => R - 8 - i * (2 * dot + 1));
  const done: { x: number; y: number }[] = [];
  const placed = [...markers]
    .sort((a, b) => a.v - b.v)
    .map((m) => {
      // the clearance from the nearest placed number, per ring
      const room = rings.map((r) => {
        const [x, y] = at(m.v, r);
        return Math.min(Infinity, ...done.map((p) => Math.hypot(p.x - x, p.y - y)));
      });
      let ring = room.findIndex((d) => d >= 2 * dot + 0.6);
      if (ring < 0) ring = room.indexOf(Math.max(...room)); // nowhere is clear: least overlap
      const [x, y] = at(m.v, rings[ring]);
      done.push({ x, y });
      return { ...m, r: rings[ring] };
    });
  return (
    <g class={`markers${dense ? " markers-dense" : ""}`}>
      {placed.map((m) => {
        const [hx, hy] = at(m.v, 9);
        const [x, y] = at(m.v, m.r);
        return <line class="marker-stem" x1={hx} y1={hy} x2={x} y2={y} />;
      })}
      {placed.map((m) => {
        const [x, y] = at(m.v, m.r);
        const kind = m.hollow ? " marker-hollow" : m.best ? " marker-hit" : "";
        return (
          <g class={`marker${kind}`}>
            <circle class="marker-plate" cx={x + 1} cy={y + 0.8} r={dot} />
            <circle class="marker-dot" cx={x} cy={y} r={dot} />
            <text x={x} y={y}>
              {m.n}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function Ends({ left, right }: { left: string; right: string }) {
  return (
    <div class="ends">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

export function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
