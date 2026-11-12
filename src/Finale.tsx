import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Place, View } from "../shared/game";
import { fmt } from "./Dial";
import { play } from "./sound";

// The projector's final results. The admin reveals one podium place per press:
// 3位, 2位, then 1位. Each place gets a drumroll first (1位 a longer one), then
// rises with its fanfare; 1位 adds the crown, rays and confetti. A projector
// opened partway through shows the places already out, without the show.
const DRUM_MS = 2000;
const DRUM_FIRST_MS = 3800;

export const FINALE_SOUNDS = ["drumroll", "fanfare", "fanfare_first"] as const;

export function Finale({ view }: { view: View }) {
  const f = view.finale!;
  const [visible, setVisible] = useState(f.shown); // places fully on the podium
  const [drum, setDrum] = useState<Place | null>(null); // the place being drummed in
  const seen = useRef(f.shown);

  useEffect(() => {
    const before = seen.current;
    seen.current = f.shown;
    if (f.shown <= before) {
      setDrum(null);
      setVisible(f.shown);
      return;
    }
    // places that came out while we weren't watching just appear
    setVisible(f.shown - 1);
    const place = f.places[f.shown - 1];
    const first = place.rank === 1;
    setDrum(place);
    play("drumroll", first ? 0.9 : 1);
    const timers = [
      setTimeout(() => {
        setDrum(null);
        setVisible(f.shown);
        if (first) play("fanfare_first");
        else play("fanfare", place.rank === 2 ? 1.12 : 1);
      }, first ? DRUM_FIRST_MS : DRUM_MS),
    ];
    if (first) timers.push(setTimeout(() => play("drumroll", 0.9), 1900));
    return () => timers.forEach(clearTimeout);
  }, [f.shown]);

  if (f.shown === 0) {
    return (
      <div class="finale finale-wait">
        <p class="finale-big display print">全問終了！</p>
        <p class="finale-sub">
          最終結果の発表まで、もうしばらくお待ちください<span class="finale-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </p>
      </div>
    );
  }

  const out = f.places.slice(0, visible);
  const latest = out[out.length - 1];
  const champion = out.some((p) => p.rank === 1);
  const title = drum
    ? drum.rank === 1
      ? drum.tables.length > 1
        ? `そして、第1位は${drum.tables.length}チーム…`
        : "そして、第1位は…"
      : `第${drum.rank}位は${drum.tables.length > 1 ? `${drum.tables.length}チーム` : ""}…`
    : latest
      ? latest.rank === 1
        ? "優勝！"
        : `第${latest.rank}位`
      : "最終結果発表";

  return (
    <div class={`finale${champion ? " finale-champion" : ""}`}>
      {champion && <i class="finale-rays" aria-hidden="true" />}
      <p class={`finale-title display print${drum ? " drumming" : ""}`}>{title}</p>
      <div class="podium">
        {[2, 1, 3].map((rank) => {
          const place = out.find((p) => p.rank === rank);
          return (
            <div class={`podium-step podium-${rank}${place ? " on" : ""}`}>
              <i class="podium-spot" aria-hidden="true" />
              <div class={`podium-teams${place && place.tables.length > 1 ? " many" : ""}`}>
                {place?.tables.map((t) => (
                  <div class="podium-team">
                    {rank === 1 && <Crown />}
                    <span class="podium-no">{t.n}</span>
                    <span class="podium-name">{t.name}</span>
                    <span class="podium-pts">合計のズレ {fmt(t.score)}点</span>
                  </div>
                ))}
              </div>
              <div class="podium-block display">
                {rank}
                <small>位</small>
              </div>
            </div>
          );
        })}
      </div>
      {champion && <Confetti />}
    </div>
  );
}

function Crown() {
  return (
    <svg class="podium-crown" viewBox="-30 -24 60 46" aria-label="優勝">
      <path d="M-22,10 L-26,-14 L-11,-2 L0,-20 L11,-2 L26,-14 L22,10 Z" />
      <rect x={-22} y={12} width={44} height={7} rx={2} />
      <circle class="gem" cx={0} cy={-20} r={3.5} />
    </svg>
  );
}

const COLORS = ["#ff48b0", "#3255a4", "#ffc21a", "#321871", "#5ad1e6"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 140 }, (_, i) => ({
        left: `${Math.random() * 100}%`,
        background: COLORS[i % COLORS.length],
        animationDuration: `${2.5 + Math.random() * 2.5}s`,
        animationDelay: `${Math.random() * 1.5}s`,
      })),
    [],
  );
  return (
    <div class="confetti" aria-hidden="true">
      {pieces.map((style) => (
        <i style={style} />
      ))}
    </div>
  );
}
