import { useEffect, useState } from "preact/hooks";

// Which score view the projector shows. Kept per browser, like a theme setting.
export type ScoreView = "band" | "tables";
const KEY = "screen-score-view";

export function useScoreView(): [ScoreView, (v: ScoreView) => void] {
  const [mode, setMode] = useState<ScoreView>(() => {
    try {
      const v = localStorage.getItem(KEY);
      // "hearts" was the old name of the tables view
      return v === "tables" || v === "hearts" ? "tables" : "band";
    } catch {
      return "band";
    }
  });
  const set = (v: ScoreView) => {
    setMode(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // private window: the choice just lasts until reload
    }
  };
  return [mode, set];
}

// A small switch that shows while the mouse moves and fades out after a few
// seconds, so it never sits on the projected picture. The V key also toggles.
export function ViewSwitch({ mode, onChange }: { mode: ScoreView; onChange: (v: ScoreView) => void }) {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let timer = setTimeout(() => setAwake(false), 4000);
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), 3000);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "v" || e.key === "V") onChange(mode === "band" ? "tables" : "band");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, onChange]);

  return (
    <div class={`view-switch${awake ? "" : " asleep"}`} role="group" aria-label="得点の表示">
      <button aria-pressed={mode === "band"} onClick={() => onChange("band")}>
        イコライザー
      </button>
      <button aria-pressed={mode === "tables"} onClick={() => onChange("tables")}>
        テーブル
      </button>
    </div>
  );
}
