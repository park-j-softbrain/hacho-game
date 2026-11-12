import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { View } from "../../shared/game";
import { Dial, Ends, fmt } from "../Dial";
import { serverNow, useGame, useTick } from "../net";
import { click, play, useSound } from "../sound";
import { Banner, Burst, Center, Countdown } from "../ui";

export function TablePage({ n, k }: { n: number; k: string }) {
  const { view, status, fatal, error, send } = useGame(
    `role=table&n=${n}&k=${encodeURIComponent(k)}`,
  );
  const [renaming, setRenaming] = useState(false);
  useSound(PHONE_SOUNDS);

  if (fatal) return <Center>{fatal}</Center>;
  if (!view?.me) return <Center>接続中…</Center>;
  const me = view.me;
  const canName = view.phase === "lobby" || view.phase === "scores";

  return (
    <div class="phone">
      <Banner status={status} error={error} />
      <header class="phone-head">
        <span class="table-badge" aria-hidden="true">
          {me.n}
        </span>
        <div class="phone-who">
          <span class="phone-name">{me.name}</span>
          {me.name !== `テーブル${me.n}` && (
            <span class="phone-table">テーブル{me.n}</span>
          )}
        </div>
        <span class="score-pill">
          <b>{fmt(me.score)}</b>点
        </span>
      </header>
      {canName && (!me.hasName || renaming) ? (
        <NameForm
          n={me.n}
          initial={me.hasName ? me.name : ""}
          onDone={(name) => {
            if (send({ t: "name", name })) setRenaming(false);
          }}
        />
      ) : (
        <Body view={view} send={send} onRename={() => setRenaming(true)} />
      )}
    </div>
  );
}

type Send = ReturnType<typeof useGame>["send"];

function Body({
  view,
  send,
  onRename,
}: {
  view: View;
  send: Send;
  onRename: () => void;
}) {
  const me = view.me!;
  switch (view.phase) {
    case "lobby":
      return (
        <Center>
          <Burst>
            <span class="display">準備OK!</span>
          </Burst>
          <p>ゲームの開始をお待ちください</p>
          <button class="link" onClick={onRename}>
            チーム名を変更
          </button>
        </Center>
      );
    case "open":
      return <Answering view={view} send={send} />;
    case "closed":
      return (
        <div class="phone-round">
          <QuestionHead view={view} />
          <DialCard>
            <Dial value={me.answer?.v ?? null} />
            <Ends left={view.question!.left} right={view.question!.right} />
          </DialCard>
          <p class="big display">締め切りました</p>
          <p>
            {me.answer ? `あなたの回答: ${me.answer.v}` : "回答なし"}
            ・正解発表をお待ちください
          </p>
        </div>
      );
    case "reveal": {
      const result = view.result!;
      const points = result.points[me.n];
      return (
        <div class="phone-round">
          <Burst label="正解とのズレ">
            {me.answer ? (
              <span class="points">
                {fmt(points ?? 0)}
                <small>点</small>
              </span>
            ) : (
              <span class="points points-none">回答なし</span>
            )}
          </Burst>
          {result.ranks[me.n] != null && (
            <p class="total-pill">
              今回 <b>{result.ranks[me.n]}</b>位
            </p>
          )}
          <DialCard>
            <Dial
              value={me.answer?.v ?? null}
              target={result.target}
              label={`ダイヤル。正解${fmt(result.target)}${me.answer ? `、あなたの針は${me.answer.v}` : ""}`}
            />
            <Ends left={view.question!.left} right={view.question!.right} />
          </DialCard>
          <p class="answer-line">
            正解は <b class="display print">{fmt(result.target)}</b>
            {me.answer && (
              <span class="answer-mine">（あなたの回答: {me.answer.v}）</span>
            )}
          </p>
          {result.comment && <p class="small">{result.comment}</p>}
          <p class="total-pill">
            合計 <b>{fmt(me.score)}</b>点・<b>{me.rank}</b>位
          </p>
        </div>
      );
    }
    case "finale":
      return <PhoneFinale view={view} />;
    case "scores":
      return (
        <Center>
          <Burst label={view.final ? "最終結果" : "現在の順位"}>
            <span class="points">
              {me.rank}
              <small>位</small>
            </span>
          </Burst>
          <p class="total-pill">
            <b>{fmt(me.score)}</b>点・{view.tables.length}チーム中
          </p>
          <p class="small">ズレの合計が少ないほど上位です</p>
          {me.rank > 1 && <p class="big">{chase(view, me.score)}</p>}
          <p>スクリーンをご覧ください</p>
          <button class="link" onClick={onRename}>
            チーム名を変更
          </button>
        </Center>
      );
  }
}

function Answering({ view, send }: { view: View; send: Send }) {
  const me = view.me!;
  const answer = me.answer;
  const [pos, setPosState] = useState(answer?.v ?? 50);
  // Read by the ◀ ▶ buttons, so quick taps between renders each still count.
  const posRef = useRef(pos);
  const setPos = (v: number) => {
    posRef.current = v;
    setPosState(v);
  };
  // The player moving the needle: a click per step, stronger on or past a 10.
  const move = (v: number) => {
    const from = posRef.current;
    if (v === from) return;
    click(v % 10 === 0 || Math.floor(v / 10) !== Math.floor(from / 10));
    setPos(v);
  };
  const moveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useTick(250);

  // New question: start from the middle (or wherever this table already answered).
  useEffect(() => setPos(answer?.v ?? 50), [view.qid]);
  // Another phone at the same table submitted: follow it.
  useEffect(() => {
    if (answer?.submitted) setPos(answer.v);
  }, [answer?.submitted, answer?.v]);

  const timeUp = serverNow() >= view.deadline;
  const locked = !!answer?.submitted || timeUp;
  // The last position counts even if nobody presses 回答, so report it after each change.
  const commit = (v: number) => {
    clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => send({ t: "move", v }), 250);
  };
  const nudge = (d: number) => {
    const v = Math.min(100, Math.max(0, posRef.current + d));
    move(v);
    commit(v);
  };

  return (
    <div class="phone-round">
      <QuestionHead view={view} />
      <Countdown startedAt={view.startedAt} deadline={view.deadline} />
      <DialCard>
        <Dial
          value={pos}
          onChange={move}
          onCommit={commit}
          disabled={locked}
        />
        <Ends left={view.question!.left} right={view.question!.right} />
      </DialCard>
      <div class="nudge">
        <button onClick={() => nudge(-1)} disabled={locked} aria-label="左へ">
          <Chevron d="M15 5 L8 12 L15 19" />
        </button>
        <span class="nudge-value">{pos}</span>
        <button onClick={() => nudge(1)} disabled={locked} aria-label="右へ">
          <Chevron d="M9 5 L16 12 L9 19" />
        </button>
      </div>
      {answer?.submitted ? (
        <div class="submitted">
          <p class="big display">回答しました！</p>
          <button
            class="secondary"
            onClick={() => send({ t: "unsubmit" })}
            disabled={timeUp}
          >
            修正する
          </button>
        </div>
      ) : (
        <button
          class="primary"
          disabled={timeUp}
          onClick={() => {
            clearTimeout(moveTimer.current);
            send({ t: "submit", v: pos });
            play("submit");
          }}
        >
          {timeUp ? "時間切れ" : "この位置で回答する"}
        </button>
      )}
      {!answer?.submitted && !timeUp && (
        <p class="hint">時間切れのときは、針の位置がそのまま回答になります</p>
      )}
    </div>
  );
}

const PHONE_SOUNDS = ["submit"] as const;

// The phone's side of the finale: wait while the projector reveals 3位 → 1位,
// then show this table's final place. When 1位 comes out live, hold the phone's
// answer back until the projector's drumroll and fanfare are over.
const HOLD_MS = 5000;

function PhoneFinale({ view }: { view: View }) {
  const me = view.me!;
  const f = view.finale!;
  const done = f.total > 0 && f.shown >= f.total;
  const [held, setHeld] = useState(false);
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) {
      setHeld(true);
      const t = setTimeout(() => setHeld(false), HOLD_MS);
      wasDone.current = done;
      return () => clearTimeout(t);
    }
    wasDone.current = done;
  }, [done]);

  if (!done || held) {
    return (
      <Center>
        <Burst>
          <span class="display">{f.shown === 0 ? "全問終了！" : "発表中"}</span>
        </Burst>
        {f.shown === 0 ? (
          <p class="big">
            全ての問題が完了しました。
            <br />
            結果発表までもうしばらくお待ちください
          </p>
        ) : (
          <p class="big">結果発表中です</p>
        )}
        <p>スクリーンをご覧ください</p>
      </Center>
    );
  }
  return (
    <Center>
      <Burst label="最終結果">
        <span class="points">
          {me.rank}
          <small>位</small>
        </span>
      </Burst>
      <p class="big display">{me.rank <= 3 ? "おめでとうございます！" : "おつかれさまでした！"}</p>
      <p class="total-pill">
        <b>{fmt(me.score)}</b>点・{view.tables.length}チーム中
      </p>
    </Center>
  );
}

function QuestionHead({ view }: { view: View }) {
  return (
    <div class="q-head">
      <span class="q-no">
        Q{view.qNo} / {view.qCount}
      </span>
      <h2 class="q-prompt">{view.question!.prompt}</h2>
    </div>
  );
}

function DialCard({ children }: { children: ComponentChildren }) {
  return <div class="dial-card">{children}</div>;
}

function Chevron({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

// "1.5 points behind 3rd place": the gap to the next better score.
function chase(view: View, score: number): string {
  const above = view.tables
    .filter((t) => t.score < score)
    .sort((a, b) => b.score - a.score)[0];
  return above ? `${above.rank}位まで あと${fmt(score - above.score)}点` : "";
}

function NameForm({
  n,
  initial,
  onDone,
}: {
  n: number;
  initial: string;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      class="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(name.trim() || `テーブル${n}`);
      }}
    >
      <label class="big display" for="team-name">
        チーム名を決めてください
      </label>
      <input
        id="team-name"
        value={name}
        maxLength={20}
        placeholder={`例：テーブル${n}チーム`}
        onInput={(e) => setName(e.currentTarget.value)}
      />
      <button class="primary" type="submit">
        決定
      </button>
      <p class="muted small">
        空欄なら「テーブル{n}」になります。あとで変更できます
      </p>
    </form>
  );
}
