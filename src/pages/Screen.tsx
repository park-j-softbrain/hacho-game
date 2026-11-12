import { useState } from "preact/hooks";
import type { Board, View } from "../../shared/game";
import { Dial, Ends, fmt } from "../Dial";
import { FINALE_SOUNDS, Finale } from "../Finale";
import { ScoreBand } from "../ScoreBand";
import { TableBand } from "../TableBand";
import { SoundHint, ViewSwitch, useScoreView } from "../ViewSwitch";
import { useGame } from "../net";
import { type Stage, useReveal, useScreenSounds } from "../reveal";
import { useSound } from "../sound";
import { Banner, Center, Countdown, Logo, PHASE_LABEL } from "../ui";

// The projector. Shows nothing secret before the reveal: the server only sends
// the target and the other tables' needles once the round is over.
export function ScreenPage() {
  const { view, status } = useGame("role=screen");
  const [mode, setMode] = useScoreView();
  const sound = useSound(SCREEN_SOUNDS);
  const { stage, before, live } = useReveal(view);
  useScreenSounds(view, stage, live, mode === "tables");
  if (!view) return <Center>接続中…</Center>;

  const round =
    (view.phase === "open" || view.phase === "closed" || view.phase === "reveal") && !!view.question;
  // the running totals; the ranking screen has its own full chart
  const totals = view.phase !== "scores" && view.phase !== "finale" && (view.played > 0 || (mode === "tables" && round));
  const band = totals && mode === "band";
  const tables = totals && mode === "tables";
  // Until the reveal's results show, the bands keep the totals from before it.
  const intro = stage !== "done";
  const shown: View = intro ? { ...view, phase: "closed", tables: before, result: undefined } : view;

  return (
    <div class={`screen${band ? " with-band" : ""}${tables ? " with-tables" : ""}${view.phase === "finale" ? " with-finale" : ""}`}>
      <Banner status={status} error={null} />
      <header class="screen-head">
        <div class="brand">
          <Logo />
          <h1 class="display print">{view.title}</h1>
        </div>
        <div class="screen-chips">
          {view.question && view.phase !== "scores" && view.phase !== "finale" && (
            <span class="chip chip-q">
              Q{view.qNo} / {view.qCount}
            </span>
          )}
          {view.phase !== "lobby" && (
            <span class="chip chip-phase">
              {view.phase === "scores"
                ? view.final
                  ? "最終結果"
                  : "現在の順位"
                : PHASE_LABEL[view.phase]}
            </span>
          )}
        </div>
      </header>
      {view.phase === "lobby" && <Lobby view={view} />}
      {round && <Round view={view} stage={stage} />}
      {view.phase === "finale" && view.finale && <Finale view={view} />}
      {view.phase === "scores" && view.board && (
        <ScoreChart view={view} board={view.board} />
      )}
      {band && <ScoreBand tables={shown.tables} />}
      {tables && <TableBand view={shown} />}
      <FullscreenButton />
      <ViewSwitch mode={mode} onChange={setMode} />
      {!sound.ready && !sound.muted && <SoundHint />}
    </div>
  );
}

function Lobby({ view }: { view: View }) {
  const joined = view.tables.filter((t) => t.online).length;
  return (
    <div class="screen-lobby">
      <p class="screen-lead display print">
        テーブルのQRコードをスマホで読み取って参加してください
      </p>
      <p class="screen-sub">
        参加中 <b class="display">{joined}</b> / {view.tables.length} テーブル
      </p>
      <div class="table-grid">
        {view.tables.map((t) => (
          <div class={`table-chip${t.online ? " on" : ""}`}>
            <span class="table-chip-no">{t.n}</span>
            <span class="table-chip-name">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SCREEN_SOUNDS = [
  "question_start", "tick", "time_up", "join", "needle_sweep",
  "correct", "incorrect", "hp_down", "hp_low", ...FINALE_SOUNDS,
] as const;

function Round({ view, stage }: { view: View; stage: Stage }) {
  const q = view.question!;
  const intro = stage !== "done";
  const result = view.result;
  const markers =
    view.phase === "open"
      ? undefined
      : (view.answers ?? []).map((a) => ({
          ...a,
          best: !intro && result?.ranks[a.n] === 1,
        }));
  const long =
    q.prompt.length > 32
      ? " prompt-xlong"
      : q.prompt.length > 14
        ? " prompt-long"
        : "";
  return (
    <div class="screen-round">
      <div class="screen-main">
        <span class="chip chip-small">お題</span>
        <h2 class={`screen-prompt display print${long}`}>{q.prompt}</h2>
        <div class="dial-box">
          <Dial
            target={stage === "pause" ? undefined : result?.target}
            sweep={stage === "sweep"}
            markers={markers}
            label={`ダイヤル。${q.left}から${q.right}`}
          />
          <Ends left={q.left} right={q.right} />
        </div>
      </div>
      <aside class="screen-side">
        {view.phase === "open" && <Answering view={view} />}
        {(view.phase === "closed" || (view.phase === "reveal" && intro)) && (
          <div class="card card-dots side-card">
            <p class="screen-big display print">締め切り！</p>
            <p class="screen-sub">正解は…？</p>
          </div>
        )}
        {view.phase === "reveal" && !intro && result && <Result view={view} />}
        {view.phase !== "open" && !intro && view.average != null && (
          <div class="average-pill">
            <span>みんなの平均</span>
            <b class="display">{fmt(view.average)}</b>
          </div>
        )}
      </aside>
    </div>
  );
}

function Answering({ view }: { view: View }) {
  const done = view.tables.filter((t) => t.answered).length;
  return (
    <>
      <Countdown startedAt={view.startedAt} deadline={view.deadline} large />
      <p class="screen-sub">
        回答済み <b class="display">{done}</b> / {view.tables.length}
      </p>
      <div class="answered-grid">
        {view.tables.map((t) => (
          <span class={`answered-chip${t.answered ? " on" : ""}`}>{t.n}</span>
        ))}
      </div>
    </>
  );
}

function Result({ view }: { view: View }) {
  const result = view.result!;
  const names = new Map(view.tables.map((t) => [t.n, t.name]));
  // The closest three places (ties share one), with each table's miss.
  const places = [1, 2, 3]
    .map((rank) => ({
      rank,
      rows: Object.entries(result.ranks)
        .filter(([, r]) => r === rank)
        .map(([n]) => ({
          name: names.get(Number(n)) ?? `テーブル${n}`,
          miss: result.points[Number(n)] ?? 0,
        })),
    }))
    .filter((p) => p.rows.length > 0);
  return (
    <>
      <div class="card card-dots side-card target-card">
        <span class="chip chip-pink">正解</span>
        <p class="screen-target display">{fmt(result.target)}</p>
        {result.comment && <p class="screen-comment">{result.comment}</p>}
      </div>
      <div class="card winners">
        {places.map((p) => (
          <div class="winners-row">
            <span class={`points-badge points-badge-${5 - p.rank}`}>
              <b>{p.rank}</b>位
            </span>
            <span class="winners-names">
              {p.rows.map((row, i) => (
                <>
                  {i > 0 && "・"}
                  <span class="nowrap">
                    {row.name}（{fmt(row.miss)}）
                  </span>
                </>
              ))}
            </span>
          </div>
        ))}
        {places.length === 0 && (
          <p class="screen-sub">回答したチームはありませんでした</p>
        )}
        <p class="small">（）は正解とのズレ。少ないほど上位</p>
      </div>
    </>
  );
}

// The ranking as a table of numbers: each question's miss (the latest in pink),
// the total, and how far each table moved since the last question.
function ScoreChart({ view, board }: { view: View; board: Board }) {
  const rows = new Map(board.rows.map((r) => [r.n, r]));
  const tables = [...view.tables].sort((a, b) => a.rank - b.rank || a.n - b.n);
  const columns = tables.length > 12 ? 2 : 1;
  const perColumn = Math.ceil(tables.length / columns);
  const qNos = board.qNos;
  const last = qNos.length - 1;

  return (
    <div class="scoreboard">
      <div class="scoreboard-head">
        <h2 class="display print">
          {view.final ? "最終結果" : "合計のズレ"}
          <small class="board-note">少ないほど上位</small>
        </h2>
        <div class="legend">
          <span>数字は各問題のズレ</span>
          {board.lastQNo && (
            <span>
              <i class="swatch swatch-last" aria-hidden="true" />
              最新の問題（Q{board.lastQNo}）
            </span>
          )}
        </div>
      </div>
      <div
        class="chart"
        role="table"
        aria-label={`合計のズレ。${tables.map((t) => `${t.rank}位 ${t.name} ${fmt(t.score)}点`).join("、")}`}
        style={{ "--columns": columns, "--rows": perColumn, "--qs": Math.max(1, qNos.length) }}
      >
        {Array.from({ length: columns }, (_, c) => (
          <div class="chart-column">
            <div class="chart-head" aria-hidden="true">
              <span class="pts-row">
                {qNos.map((q, i) => (
                  <span class={`pts-q${i === last ? " pts-q-last" : ""}`}>Q{q}</span>
                ))}
              </span>
              <span class="chart-head-total">合計</span>
            </div>
            <div class="chart-rows">
              {tables.slice(c * perColumn, (c + 1) * perColumn).map((t) => {
                const r = rows.get(t.n);
                const pts = r?.pts ?? [];
                const move = r?.prevRank != null ? r.prevRank - t.rank : null;
                return (
                  <div class="chart-row">
                    <span class={`rank-badge${t.rank === 1 ? " rank-1" : ""}`}>
                      {t.rank}
                    </span>
                    <span class="chart-name">{t.name}</span>
                    <span class="pts-row">
                      {pts.map((p, i) => (
                        <span class={`pts${i === last ? " pts-last" : ""}`}>{fmt(p)}</span>
                      ))}
                    </span>
                    <span class="chart-total display">
                      {fmt(t.score)}
                      <small>点</small>
                    </span>
                    <span class={`move${move ? (move > 0 ? " move-up" : " move-down") : ""}`}>
                      {move == null
                        ? ""
                        : move > 0
                          ? `▲${move}`
                          : move < 0
                            ? `▼${-move}`
                            : "―"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FullscreenButton() {
  const [hidden, setHidden] = useState(false);
  if (hidden || !document.fullscreenEnabled) return null;
  return (
    <button
      class="fullscreen secondary"
      onClick={() => {
        document.documentElement.requestFullscreen().catch(() => {});
        setHidden(true);
      }}
    >
      全画面
    </button>
  );
}
