import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type Extreme, GROUP_NAMES, type View, fractionOf, snap } from "../../shared/game";
import { Dial, Ends, Shown, fmt, fmtOn } from "../Dial";
import { serverNow, useGame, useTick } from "../net";
import { click, play, useSound } from "../sound";
import { useFitText } from "../fit";
import { Banner, Burst, Center, Countdown, Fit } from "../ui";

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
        {view.secret ? (
          me.group != null && <span class="score-pill">{GROUP_NAMES[me.group]}</span>
        ) : (
          <span class="score-pill">
            <b>{fmt(me.score)}</b>点
          </span>
        )}
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
            <Dial scale={view.question!.scale} value={me.answer?.v ?? null} />
            <Ends left={view.question!.left} right={view.question!.right} />
          </DialCard>
          <p class="big display">締め切りました</p>
          <p>
            {me.answer ? (
              <>
                あなたの回答: <Shown scale={view.question!.scale} v={me.answer.v} />
              </>
            ) : (
              "回答なし"
            )}
            ・正解発表をお待ちください
          </p>
        </div>
      );
    case "reveal": {
      const result = view.result!;
      const points = result.points[me.n];
      const sc = view.question!.scale;
      return (
        <div class="phone-round">
          <Burst label="今回の点数（ズレ）">
            {me.answer ? (
              <Fit class="points">
                {fmt(points ?? 0)}
                <small>点</small>
              </Fit>
            ) : (
              <span class="points points-none">回答なし</span>
            )}
          </Burst>
          {result.ranks[me.n] != null && (
            <Fit tag="p" class="total-pill">
              今回 <b>{result.ranks[me.n]}</b>位
            </Fit>
          )}
          <DialCard>
            <Dial
              scale={sc}
              value={me.answer?.v ?? null}
              target={result.target}
              label={`ダイヤル。正解${fmtOn(sc, result.target)}${me.answer ? `、あなたの針は${fmtOn(sc, me.answer.v)}` : ""}`}
            />
            <Ends left={view.question!.left} right={view.question!.right} />
          </DialCard>
          <p class="answer-line">
            正解は{" "}
            <Fit tag="b" class="display print">
              <Shown scale={sc} v={result.target} />
            </Fit>
            {me.answer && (
              <span class="answer-mine">（あなたの回答: <Shown scale={sc} v={me.answer.v} />）</span>
            )}
          </p>
          {result.comment && <p class="small">{result.comment}</p>}
          {me.answer && points != null && <Spread best={result.best} worst={result.worst} mine={points} />}
          {view.secret ? (
            me.group != null && (
              <Fit tag="p" class="total-pill">
                いまのグループ <b>{GROUP_NAMES[me.group]}</b>
              </Fit>
            )
          ) : (
            <Fit tag="p" class="total-pill">
              合計 <b>{fmt(me.score)}</b>点・<b>{me.rank}</b>位
            </Fit>
          )}
        </div>
      );
    }
    case "finale":
      return <PhoneFinale view={view} />;
    case "scores":
      if (view.secret) return <GroupNow view={view} onRename={onRename} />;
      return (
        <Center>
          <Burst label={view.final ? "最終結果" : "現在の順位"}>
            <Fit class="points">
              {me.rank}
              <small>位</small>
            </Fit>
          </Burst>
          <Fit tag="p" class="total-pill">
            <b>{fmt(me.score)}</b>点・{view.tables.length}チーム中
          </Fit>
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
  const sc = view.question!.scale;
  const middle = snap(sc, (sc.min + sc.max) / 2);
  const [pos, setPosState] = useState(answer?.v ?? middle);
  // Read by the ◀ ▶ buttons, so quick taps between renders each still count.
  const posRef = useRef(pos);
  const setPos = (v: number) => {
    posRef.current = v;
    setPosState(v);
  };
  // The player moving the needle: a click per step, stronger on or past each tenth of the range.
  const tenth = (v: number) => Math.floor(fractionOf(sc, v) * 10 + 1e-9);
  const move = (v: number) => {
    const from = posRef.current;
    if (v === from) return;
    const onTenth = Math.abs(fractionOf(sc, v) * 10 - Math.round(fractionOf(sc, v) * 10)) < 1e-6;
    click(onTenth || tenth(v) !== tenth(from));
    setPos(v);
  };
  const moveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useTick(250);

  // New question: start from the middle (or wherever this table already answered).
  useEffect(() => setPos(answer?.v ?? middle), [view.qid]);
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
  const shown = fmtOn(sc, pos);
  // ◀ ▶ move one step toward that end of the dial.
  const nudge = (d: number) => {
    const v = snap(sc, posRef.current + d * sc.step * Math.sign(sc.max - sc.min));
    move(v);
    commit(v);
  };

  return (
    <div class="phone-round answering">
      <QuestionHead view={view} />
      <Countdown startedAt={view.startedAt} deadline={view.deadline} />
      <DialCard>
        <Dial
          scale={sc}
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
        <Fit class={`nudge-value${sc.band ? " nudge-color" : shown.length > 7 ? " longer" : shown.length > 4 ? " long" : ""}`}>
          <Shown scale={sc} v={pos} />
        </Fit>
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

// Where this table's miss sits between this question's closest and farthest tables.
function Spread({ best, worst, mine }: { best: Extreme | null; worst: Extreme | null; mine: number }) {
  if (!best || !worst) return null;
  const width = worst.miss - best.miss;
  const at = width > 0 ? Math.min(100, Math.max(0, ((mine - best.miss) / width) * 100)) : 0;
  const top = mine <= best.miss;
  return (
    <div class="spread">
      {width > 0 && (
        <>
          <div class="spread-bar" role="img" aria-label={`いちばん近いチームのズレ${fmt(best.miss)}点、あなた${fmt(mine)}点、おしかった賞${fmt(worst.miss)}点`}>
            <i class="spread-mark spread-mine" style={{ left: `${at}%` }}>
              <span>あなた</span>
            </i>
          </div>
          <div class="spread-ends" aria-hidden="true">
            <span>いちばん近い {fmt(best.miss)}点</span>
            <span>おしかった賞 {fmt(worst.miss)}点</span>
          </div>
        </>
      )}
      <p class="spread-note">
        {top
          ? "今回いちばん近いチームです！"
          : width > 0 && mine >= worst.miss
            ? "今回のおしかった賞です。次で取り返しましょう！"
            : `いちばん近いチームまで あと${fmt(mine - best.miss)}点`}
      </p>
    </div>
  );
}

// The 途中経過 screen while the totals are hidden: this table's group and whether it moved.
function GroupNow({ view, onRename }: { view: View; onRename: () => void }) {
  const me = view.me!;
  const g = me.group;
  const prev = me.prevGroup;
  const moved =
    g == null || prev == null
      ? null
      : g < prev
        ? `${GROUP_NAMES[prev]} → ${GROUP_NAMES[g]} に上がりました！`
        : g > prev
          ? `${GROUP_NAMES[prev]} → ${GROUP_NAMES[g]} に下がりました`
          : "前の問題と同じグループです";
  const same = g == null ? 0 : view.tables.filter((t) => t.group === g).length;
  return (
    <Center>
      <Burst label="いまのグループ">
        <span class="display group-burst">{g == null ? "―" : GROUP_NAMES[g]}</span>
      </Burst>
      {same > 1 && <Fit tag="p" class="total-pill">{same}チームがこのグループ</Fit>}
      {moved && <p class="big">{moved}</p>}
      <p class="small">合計のズレが近いチームどうしで分けています。順位は最後の結果発表で分かります</p>
      <p>スクリーンをご覧ください</p>
      <button class="link" onClick={onRename}>
        チーム名を変更
      </button>
    </Center>
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
        <Fit class="points">
          {me.rank}
          <small>位</small>
        </Fit>
      </Burst>
      <p class="big display">{me.rank <= 3 ? "おめでとうございます！" : "おつかれさまでした！"}</p>
      <Fit tag="p" class="total-pill">
        <b>{fmt(me.score)}</b>点・{view.tables.length}チーム中
      </Fit>
    </Center>
  );
}

function QuestionHead({ view }: { view: View }) {
  // shrinks when a long prompt would push the dial and the button off the screen
  const prompt = useFitText<HTMLHeadingElement>(view.question!.prompt, "height", 0.45);
  return (
    <div class="q-head">
      <span class="q-no">
        Q{view.qNo} / {view.qCount}
      </span>
      <h2 class="q-prompt" ref={prompt}>{view.question!.prompt}</h2>
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
