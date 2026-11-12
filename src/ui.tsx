import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { serverNow, useTick, type Status } from "./net";

export function Center({ children }: { children: ComponentChildren }) {
  return <div class="center">{children}</div>;
}

// Connection trouble and rejected actions, shown over the top of the page.
export function Banner({ status, error }: { status: Status; error: string | null }) {
  return (
    <>
      {status !== "open" && <div class="banner banner-warn">接続が切れました。再接続中…</div>}
      {error && <div class="banner banner-error">{error}</div>}
    </>
  );
}

export function Countdown({ startedAt, deadline, large }: { startedAt: number; deadline: number; large?: boolean }) {
  useTick(250);
  const left = Math.max(0, deadline - serverNow());
  const secs = Math.ceil(left / 1000);
  const total = Math.round((deadline - startedAt) / 1000);
  const frac = deadline > startedAt ? left / (deadline - startedAt) : 0;
  return (
    <div class={`countdown${secs <= 10 ? " hurry" : ""}${large ? " countdown-large" : ""}`}>
      <div class="countdown-label">
        {secs > 0 ? (
          <span>
            残り <b class="countdown-secs">{secs}</b>秒
          </span>
        ) : (
          <b class="countdown-secs">時間切れ</b>
        )}
        {!large && total > 0 && <span class="countdown-total">{total}秒中</span>}
      </div>
      <div
        class="countdown-bar"
        role="progressbar"
        aria-label="残り時間"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={secs}
      >
        <div style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

// Two overlapping ink circles: pink and blue overprinting to purple.
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg class="logo" aria-hidden="true" width={size * 1.45} height={size} viewBox="0 0 58 40">
      <circle class="ink-pink" cx="20" cy="20" r="17" />
      <circle class="ink-blue overprint" cx="38" cy="20" r="17" />
    </svg>
  );
}

// A halftone starburst behind a big number (points, rank).
export function Burst({ children, label }: { children: ComponentChildren; label?: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  const points = Array.from({ length: 28 }, (_, i) => {
    const a = (Math.PI * i) / 14;
    const r = i % 2 ? 92 : 124;
    return `${(130 + r * Math.cos(a)).toFixed(1)},${(130 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <div class="burst">
      <svg class="burst-bg" aria-hidden="true" viewBox="0 0 260 260">
        <defs>
          <pattern id={`${id}-dots`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle class="ink-pink" cx="3.5" cy="3.5" r="1.9" />
          </pattern>
        </defs>
        <polygon points={points} fill={`url(#${id}-dots)`} />
        <polygon class="burst-outline" points={points} transform="translate(-3 -2)" />
      </svg>
      {label && <span class="burst-label">{label}</span>}
      <div class="burst-value">{children}</div>
    </div>
  );
}

export const PHASE_LABEL = {
  lobby: "待機中",
  open: "回答受付中",
  closed: "締め切り",
  reveal: "正解発表中",
  scores: "スコア表示中",
  finale: "最終結果発表",
} as const;
