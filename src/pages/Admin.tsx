import { useState } from "preact/hooks";
import {
  DEFAULT_SECONDS,
  DEFAULT_WORTH,
  MAX_SECONDS,
  MIN_SECONDS,
  type QuestionInput,
  type View,
  formatValue,
  questionProblem,
  rangeOf,
  scaleOf,
} from "../../shared/game";
import { parseQuestions, toTsv } from "../../shared/questions";
import { Dial, Ends, Shown, fmt, fmtOn } from "../Dial";
import { colorEnds } from "../../shared/color";
import { storage, useGame } from "../net";
import { Banner, Center, Countdown, Logo, PHASE_LABEL } from "../ui";

export const ADMIN_KEY = "adminKey";

export function AdminPage() {
  const [key, setKey] = useState(() => storage.get(ADMIN_KEY));
  if (!key) {
    return (
      <Login
        onLogin={(k) => {
          storage.set(ADMIN_KEY, k);
          setKey(k);
        }}
      />
    );
  }
  return (
    <Console
      k={key}
      onLogout={() => {
        storage.remove(ADMIN_KEY);
        setKey(null);
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (k: string) => void }) {
  const [k, setK] = useState("");
  return (
    <form
      class="admin-login"
      onSubmit={(e) => {
        e.preventDefault();
        if (k) onLogin(k);
      }}
    >
      <Logo size={48} />
      <h1 class="display print">管理画面</h1>
      <label for="admin-key">パスワード</label>
      <input
        id="admin-key"
        type="password"
        value={k}
        onInput={(e) => setK(e.currentTarget.value)}
      />
      <button class="primary" type="submit">
        ログイン
      </button>
    </form>
  );
}

type Send = ReturnType<typeof useGame>["send"];

function Console({ k, onLogout }: { k: string; onLogout: () => void }) {
  const { view, status, fatal, error, send } = useGame(
    `role=admin&k=${encodeURIComponent(k)}`,
  );
  if (fatal) {
    return (
      <Center>
        <p>{fatal}</p>
        <button class="secondary" onClick={onLogout}>
          ログインし直す
        </button>
      </Center>
    );
  }
  if (!view?.admin) return <Center>接続中…</Center>;
  const questions = view.admin.questions;
  const current = questions.findIndex((q) => q.id === view.qid);

  return (
    <div class="admin">
      <Banner status={status} error={error} />
      <header class="admin-head card">
        <div class="brand">
          <Logo size={30} />
          <h1 class="display print">{view.title}</h1>
          <span class="chip chip-small">管理</span>
        </div>
        <div class="admin-status">
          <span class={`phase phase-${view.phase}`}>
            {PHASE_LABEL[view.phase]}
          </span>
          {current >= 0 && view.phase !== "lobby" && (
            <span class="chip chip-small">
              Q{current + 1} / {questions.length}
            </span>
          )}
          <span class="conn">
            <i
              class={`dot ${status === "open" ? "dot-on" : "dot-off"}`}
              aria-hidden="true"
            />
            {status === "open" ? "接続中" : "再接続中…"}
          </span>
        </div>
        <nav>
          <a href="/screen" target="_blank">
            スクリーンを開く
          </a>
          <a href="/admin/qr" target="_blank">
            QRコード印刷
          </a>
          <button class="link" onClick={onLogout}>
            ログアウト
          </button>
        </nav>
      </header>
      <div class="admin-grid">
        <div class="admin-main">
          <Controls view={view} send={send} />
          <Answers view={view} />
        </div>
        <Scores view={view} send={send} />
      </div>
      <Questions view={view} send={send} />
      <Settings view={view} send={send} />
      <Import view={view} send={send} />
      <section class="panel">
        <h2>リセット</h2>
        <p>
          得点・チーム名・回答を消して待機画面に戻します。問題・設定・QRコードはそのままです。
        </p>
        <button
          class="danger"
          onClick={() =>
            confirm("得点とチーム名をすべて消します。よろしいですか？") &&
            send({ t: "reset" })
          }
        >
          ゲームをリセット
        </button>
      </section>
    </div>
  );
}

function Controls({ view, send }: { view: View; send: Send }) {
  const admin = view.admin!;
  const questions = admin.questions;
  const current = questions.findIndex((q) => q.id === view.qid);
  // The next question not yet played, looking forward from the current one first.
  const next =
    questions.slice(current + 1).find((q) => !q.done) ??
    questions.find((q) => !q.done && q.id !== view.qid) ??
    null;
  const start = (qid: string) => send({ t: "start", qid });
  const q = questions[current];
  const open = view.phase === "open";

  return (
    <section class="panel controls">
      <h2>進行</h2>
      {q && view.phase !== "lobby" && (
        <p class="controls-q">
          Q{current + 1}「{q.prompt}」 {q.left} ↔ {q.right}
        </p>
      )}
      {open && (
        <Countdown startedAt={view.startedAt} deadline={view.deadline} />
      )}
      <div class="controls-buttons">
        {open && (
          <button class="primary" onClick={() => send({ t: "close" })}>
            締め切る
          </button>
        )}
        {view.phase === "closed" && (
          <button class="primary" onClick={() => send({ t: "reveal" })}>
            正解を発表
          </button>
        )}
        {view.phase === "reveal" && !view.final && (
          <button
            class={next ? "secondary" : "primary"}
            onClick={() => send({ t: "scores" })}
          >
            スコアを表示
          </button>
        )}
        {!open && view.phase !== "closed" && view.phase !== "finale" && next && (
          <button class="primary" onClick={() => start(next.id)}>
            ▶ Q{questions.indexOf(next) + 1} を出題（{next.seconds}秒）
          </button>
        )}
        {!open && view.phase !== "closed" && view.phase !== "finale" && !next && (
          <button class="primary" onClick={() => send({ t: "finale" })}>
            全問終了画面へ
          </button>
        )}
        {view.phase === "finale" && view.finale && <FinaleButtons view={view} send={send} />}
        {(open || view.phase === "closed") && (
          <button
            class="secondary"
            disabled={!open}
            onClick={() => send({ t: "addTime", seconds: 15 })}
          >
            +15秒
          </button>
        )}
        {view.phase !== "lobby" && !open && (
          <button class="secondary" onClick={() => send({ t: "lobby" })}>
            待機画面に戻す
          </button>
        )}
      </div>
    </section>
  );
}

// The finale: 最終結果発表 (3位), then 2位を発表, then 1位を発表. Ties share a
// place; fix them first with ±1 in スコア if you want one table per place.
function FinaleButtons({ view, send }: { view: View; send: Send }) {
  const f = view.finale!;
  const next = f.places[f.shown];
  const ties = f.places.filter((p) => p.tables.length > 1);
  const missing = f.places.length > 0 ? [3, 2].filter((r) => !f.places.some((p) => p.rank === r)) : [];
  return (
    <>
      {next ? (
        <button class="primary" onClick={() => send({ t: "finaleNext" })}>
          {f.shown === 0 ? `最終結果発表（${next.rank}位）` : `${next.rank}位を発表`}
        </button>
      ) : (
        <button class="primary" onClick={() => send({ t: "scores" })}>
          スコアを表示
        </button>
      )}
      {f.shown === 0 && ties.length > 0 && (
        <span class="finale-tie">
          同点：
          {ties.map((p) => `${p.rank}位（${p.tables.map((t) => t.n).join("・")}）`).join("、")}
          。このままだと同じ段に並びます
        </span>
      )}
      {f.shown === 0 && missing.length > 0 && (
        <span class="muted">同点のため、{missing.join("・")}位はいません</span>
      )}
    </>
  );
}

function Answers({ view }: { view: View }) {
  const answers = new Map((view.answers ?? []).map((a) => [a.n, a]));
  const q = view.admin!.questions.find((x) => x.id === view.qid);
  const showRound =
    view.phase === "open" || view.phase === "closed" || view.phase === "reveal";
  if (!showRound || !q) {
    return (
      <section class="panel">
        <h2>回答状況</h2>
        <p>出題すると、ここに各テーブルの回答が表示されます。</p>
      </section>
    );
  }
  const values = [...answers.values()].map((a) => a.v);
  const sc = scaleOf(q);
  const u = (v: number) => fmtOn(sc, v);
  return (
    <section class="panel">
      <h2>
        回答状況
        <span class="answers-target">
          正解 <b class="display"><Shown scale={sc} v={q.target} /></b>（管理者のみ表示）
        </span>
      </h2>
      <div class="answers">
        <div class="answers-dial">
          <Dial
            scale={sc}
            target={q.target}
            markers={(view.answers ?? []).map((a) => ({
              ...a,
              hollow: !a.submitted,
              best: view.result?.ranks[a.n] === 1,
            }))}
            label="回答の分布"
          />
          <Ends left={q.left} right={q.right} />
          <p class="legend small">
            <span>
              <i class="dot dot-on" aria-hidden="true" />
              送信済み
            </span>
            <span>
              <i class="dot dot-off" aria-hidden="true" />
              未送信
            </span>
          </p>
          <div class="answers-stats">
            <div class="stat">
              <span>回答</span>
              <b class="display">
                {answers.size} / {view.tables.length}
              </b>
            </div>
            <div class="stat stat-pink">
              <span>平均</span>
              <b class="display">
                {view.average != null ? u(view.average) : "—"}
              </b>
            </div>
            <div class="stat stat-wide">
              <span>
                最小{" "}
                <b class="display">
                  {values.length ? u(Math.min(...values)) : "—"}
                </b>
              </span>
              <span>/</span>
              <span>
                最大{" "}
                <b class="display">
                  {values.length ? u(Math.max(...values)) : "—"}
                </b>
              </span>
            </div>
          </div>
        </div>
        <div class="answers-table">
          <table class="admin-table">
            <thead>
              <tr>
                <th>卓</th>
                <th>チーム</th>
                <th>回答</th>
                <th>状態</th>
                {view.result && <th>ズレ</th>}
              </tr>
            </thead>
            <tbody>
              {view.tables.map((t) => {
                const a = answers.get(t.n);
                return (
                  <tr>
                    <td class="display">{t.n}</td>
                    <td>
                      <i
                        class={`dot ${t.online ? "dot-on" : "dot-off"}`}
                        title={t.online ? "接続中" : "未接続"}
                        aria-label={t.online ? "接続中" : "未接続"}
                      />
                      {t.name}
                    </td>
                    <td class="display num">{a ? u(a.v) : "—"}</td>
                    <td>
                      <span
                        class={`status ${a ? (a.submitted ? "status-sent" : "status-unsent") : "status-none"}`}
                      >
                        {a
                          ? a.submitted
                            ? "送信済み"
                            : "未送信（針の位置）"
                          : "未回答"}
                      </span>
                    </td>
                    {view.result && (
                      <td class="display">{fmt(view.result.points[t.n] ?? 0)}点</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Scores({ view, send }: { view: View; send: Send }) {
  const rows = [...view.tables].sort((a, b) => a.rank - b.rank || a.n - b.n);
  return (
    <section class="panel admin-scores">
      <h2>スコア<span class="answers-target">ズレの合計。少ないほど上位</span></h2>
      <ol class="score-list">
        {rows.map((t) => (
          <li>
            <span
              class={`rank-badge rank-badge-small${view.played > 0 && t.rank <= 3 ? ` rank-${t.rank}` : ""}`}
            >
              {t.rank}
            </span>
            <button
              class="score-name"
              title="チーム名を変更"
              onClick={() => {
                const name = prompt(`テーブル${t.n}のチーム名`, t.name);
                if (name !== null) send({ t: "rename", n: t.n, name });
              }}
            >
              {t.name}
            </button>
            <span class="score-points">
              <b class="display">{fmt(t.score)}</b>点
            </span>
            <button
              class="round"
              aria-label={`${t.name} −1点`}
              onClick={() => send({ t: "adjust", n: t.n, delta: -1 })}
            >
              −1
            </button>
            <button
              class="round round-fill"
              aria-label={`${t.name} +1点`}
              onClick={() => send({ t: "adjust", n: t.n, delta: 1 })}
            >
              +1
            </button>
          </li>
        ))}
      </ol>
      <p class="small">チーム名を押すと名前を変更できます</p>
    </section>
  );
}

function Questions({ view, send }: { view: View; send: Send }) {
  const admin = view.admin!;
  const busy = view.phase === "open" || view.phase === "closed";
  // The card being edited, or "new" for the blank form at the end.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const save = (message: Parameters<Send>[0]) => {
    if (send(message)) setEditing(null);
  };
  return (
    <section class="questions">
      <h2 class="section-title">問題一覧</h2>
      <div class="question-cards">
        {admin.questions.map((q, i) => {
          const live = q.id === view.qid && view.phase !== "lobby";
          const locked = busy && q.id === view.qid; // the round on screen can't change
          if (editing === q.id) {
            return (
              <QuestionForm
                title={`Q${i + 1} を編集`}
                initial={q}
                note={
                  q.done
                    ? "出題済みの問題です。正解を変えると、これまでの得点も新しい正解で計算し直します。"
                    : undefined
                }
                onSave={(question) =>
                  save({ t: "updateQuestion", id: q.id, question })
                }
                onCancel={() => setEditing(null)}
              />
            );
          }
          return (
            <article
              class={`card question-card${live ? " card-dots live" : ""}`}
            >
              <div class="question-top">
                <span class="display q-big">Q{i + 1}</span>
                <span
                  class={`status ${live ? "status-unsent" : q.done ? "status-sent" : "status-none"}`}
                >
                  {live ? "出題中" : q.done ? "済" : "未出題"}
                </span>
              </div>
              <p class="question-prompt">{q.prompt}</p>
              <p class="question-meta">
                正解 <b class="display"><Shown scale={scaleOf(q)} v={q.target} /></b>・{q.left} ↔{" "}
                {q.right}・{q.seconds}秒・配点{q.worth}
                {q.step !== undefined && `・刻み${fmt(q.step, scaleOf(q).unit)}`}
              </p>
              <button
                class={q.done || live ? "secondary" : "primary"}
                onClick={() =>
                  (!busy ||
                    confirm(
                      "出題中の問題を中断して、この問題を出題しますか？",
                    )) &&
                  send({ t: "start", qid: q.id })
                }
              >
                {q.done || live ? "もう一度" : "出題"}
              </button>
              <div class="question-edit">
                <button
                  class="link question-move"
                  disabled={busy || i === 0}
                  aria-label={`Q${i + 1}を上へ`}
                  title="上へ"
                  onClick={() => send({ t: "moveQuestion", id: q.id, by: -1 })}
                >
                  ↑
                </button>
                <button
                  class="link question-move question-move-last"
                  disabled={busy || i === admin.questions.length - 1}
                  aria-label={`Q${i + 1}を下へ`}
                  title="下へ"
                  onClick={() => send({ t: "moveQuestion", id: q.id, by: 1 })}
                >
                  ↓
                </button>
                <button
                  class="link"
                  disabled={locked}
                  onClick={() => setEditing(q.id)}
                >
                  編集
                </button>
                <button
                  class="link link-danger"
                  disabled={locked}
                  onClick={() =>
                    confirm(
                      `Q${i + 1}「${q.prompt}」を削除しますか？${q.done ? "この問題の得点も消えます。" : ""}`,
                    ) && send({ t: "deleteQuestion", id: q.id })
                  }
                >
                  削除
                </button>
              </div>
            </article>
          );
        })}
        {editing === "new" ? (
          <QuestionForm
            title="問題を追加"
            onSave={(question) => save({ t: "addQuestion", question })}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button class="question-add" onClick={() => setEditing("new")}>
            ＋ 問題を追加
          </button>
        )}
      </div>
    </section>
  );
}

function QuestionForm({
  title,
  initial,
  note,
  onSave,
  onCancel,
}: {
  title: string;
  initial?: QuestionInput;
  note?: string;
  onSave: (q: QuestionInput) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [left, setLeft] = useState(initial?.left ?? "");
  const [right, setRight] = useState(initial?.right ?? "");
  const [target, setTarget] = useState(initial ? (initial.color ?? String(initial.target)) : "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [seconds, setSeconds] = useState(String(initial?.seconds ?? DEFAULT_SECONDS));
  const [worth, setWorth] = useState(String(initial?.worth ?? DEFAULT_WORTH));
  const [step, setStep] = useState(initial?.step !== undefined ? String(initial.step) : "");
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const q: QuestionInput = {
    prompt,
    left,
    right,
    target: num(target),
    ...(colorEnds(left, right) && !/^\s*-?[\d.]+\s*$/.test(target) ? { color: target.trim() } : {}),
    comment,
    seconds: num(seconds),
    worth: num(worth),
    ...(step.trim() !== "" ? { step: num(step) } : {}),
  };
  const range = rangeOf(left, right);
  const sc = scaleOf({ left, right });
  const problem = target.trim() === "" ? null : questionProblem(q);
  const valid = prompt.trim() !== "" && target.trim() !== "" && !problem;
  const span = `${formatValue(range.min, range.unit)}〜${formatValue(range.max, range.unit)}`;
  return (
    <form
      class="card question-card question-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(q);
      }}
    >
      <h3>{title}</h3>
      <label>
        お題
        <input
          value={prompt}
          maxLength={80}
          required
          onInput={(e) => setPrompt(e.currentTarget.value)}
        />
      </label>
      <div class="question-form-ends">
        <label>
          左端
          <input
            value={left}
            maxLength={24}
            onInput={(e) => setLeft(e.currentTarget.value)}
          />
        </label>
        <label>
          右端
          <input
            value={right}
            maxLength={24}
            onInput={(e) => setRight(e.currentTarget.value)}
          />
        </label>
      </div>
      <p class="small">
        左右が「0m」「5,000m」のように数字で始まると、その範囲と単位でダイヤルを読みます。左右の両方に「明るい赤 #FF9A9A」のように色コードを入れると、色のダイヤルになります。今の範囲：{colorEnds(left, right) ? "色（左 → 正解 → 右）" : span}
      </p>
      <label>
        {colorEnds(left, right) ? "正解（色コード #BC002D か 0〜100 の位置）" : `正解（${span}）`}
        <input
          type={colorEnds(left, right) ? "text" : "number"}
          step="any"
          required
          value={target}
          onInput={(e) => setTarget(e.currentTarget.value)}
        />
      </label>
      <label>
        解説（省略可）
        <input
          value={comment}
          maxLength={160}
          onInput={(e) => setComment(e.currentTarget.value)}
        />
      </label>
      <label>
        所要時間（秒）
        <input
          type="number"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          required
          value={seconds}
          onInput={(e) => setSeconds(e.currentTarget.value)}
        />
      </label>
      <label>
        配点（範囲の端から端までずれたときの点数）
        <input
          type="number"
          min={1}
          step={1}
          required
          value={worth}
          onInput={(e) => setWorth(e.currentTarget.value)}
        />
      </label>
      <label>
        針の刻み（空欄なら{fmt(sc.step, sc.unit)}）
        <input
          type="number"
          min={0}
          step="any"
          value={step}
          placeholder={String(sc.step)}
          onInput={(e) => setStep(e.currentTarget.value)}
        />
      </label>
      {problem && <p class="small error">{problem}</p>}
      {note && <p class="small">{note}</p>}
      <div class="controls-buttons">
        <button class="primary" type="submit" disabled={!valid}>
          保存
        </button>
        <button class="secondary" type="button" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </form>
  );
}

function Settings({ view, send }: { view: View; send: Send }) {
  const admin = view.admin!;
  const [title, setTitle] = useState(view.title);
  const [tableCount, setTableCount] = useState(admin.tableCount);
  return (
    <section class="panel">
      <h2>設定</h2>
      <form
        class="settings"
        onSubmit={(e) => {
          e.preventDefault();
          send({ t: "settings", title, tableCount });
        }}
      >
        <label>
          タイトル
          <input
            value={title}
            maxLength={40}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <label>
          テーブル数
          <input
            type="number"
            min={1}
            max={100}
            value={tableCount}
            onInput={(e) => setTableCount(Number(e.currentTarget.value))}
          />
        </label>
        <button class="primary" type="submit">
          保存
        </button>
      </form>
    </section>
  );
}

function Import({ view, send }: { view: View; send: Send }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const busy = view.phase === "open" || view.phase === "closed";
  return (
    <section class="panel">
      <h2>問題の読み込み</h2>
      <p class="muted">
        スプレッドシートで「お題・左・右・正解・解説・所要時間(秒)・配点・針の刻み」の8列を作り、範囲をコピーして貼り付けてください。見出し行はあってもかまいません。
        左右が「0m」「5,000m」のように数字で始まると、その範囲と単位でダイヤルを読みます。正解と針の刻みはその単位で書きます（5,000mの問題なら 3776）。
        解説・所要時間・配点・針の刻みは空欄にでき、それぞれ「なし」「60秒」「100」「範囲の約1%」になります。点数は「ズレ ÷ 範囲の幅 × 配点」です。
        左右の両方に「明るい赤 #FF9A9A」「暗い赤 #4A0012」のように色コードを入れると、色のダイヤルになります。正解も「#BC002D」のように色コードで書き、左右の間の明るさにしてください。
        読み込むと問題一覧が置き換わります。これまでの得点は残ります。
      </p>
      <textarea
        rows={8}
        value={text}
        placeholder={
          "お題\t左\t右\t正解\t解説\t所要時間(秒)\t配点\t針の刻み\n富士山の高さは？\t0m\t5,000m\t3776\t剣ヶ峰の標高\t45\t200\t10\n日本の国旗の赤い丸は、正確にはどんな赤？\t明るい赤 #FF9A9A\t暗い赤 #4A0012\t#BC002D\t法律では「紅色」とだけ決まっています\t60\t100\t"
        }
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <div class="controls-buttons">
        <button
          class="primary"
          disabled={busy}
          onClick={() => {
            const parsed = parseQuestions(text);
            if ("error" in parsed) return setMessage(parsed.error);
            if (
              !confirm(
                `${parsed.questions.length}問を読み込みます。今の問題一覧は置き換わります。よろしいですか？`,
              )
            )
              return;
            if (send({ t: "questions", questions: parsed.questions })) {
              setMessage(`${parsed.questions.length}問を読み込みました`);
              setText("");
            }
          }}
        >
          読み込む
        </button>
        <button
          class="secondary"
          onClick={() => setText(toTsv(view.admin!.questions))}
        >
          今の問題をここに書き出す
        </button>
        {busy && <span class="muted">出題中は読み込めません</span>}
        {message && <span>{message}</span>}
      </div>
    </section>
  );
}
