import { useEffect, useRef, useState } from "preact/hooks";
import type { AdminMsg, TableMsg, View } from "../shared/game";

export type Status = "connecting" | "open" | "closed";

let clockOffset = 0;

// The server's clock, so every phone counts down to the same deadline.
export function serverNow(): number {
  return Date.now() + clockOffset;
}

// How often the HTTPS fallback asks. Each ask is a billed request, so it asks
// quickly only when a delay would show: while a question is open, and on the
// projector. A page whose game hasn't changed for a while slows down further,
// and a hidden page stops asking until it is shown again.
const FAST_MS = 1000;
const SLOW_MS = 5000;
const QUIET_MS = 10000;
const QUIET_AFTER = 10 * 60_000;
const BUSY_MS = 10000; // how long to wait when the server says to slow down

// Keeps one WebSocket to the game open: reconnects with backoff, and checks the
// connection again when a phone wakes up, since a sleeping phone's socket often
// looks open but is dead.
//
// Some company web filters decrypt HTTPS and break the WebSocket handshake. When
// sockets keep failing before they open, the page asks over plain HTTPS about
// over plain HTTPS instead (POST /api, see pollEvery), and keeps trying the WebSocket now and then.
export function useGame(query: string) {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<((m: TableMsg | AdminMsg) => boolean) | null>(null);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${query}`;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retries = 0;
    let lastMessage = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    let phase = "";
    const handle = (m: { t: string; msg?: string; now?: number; phase?: string }) => {
      if (m.t === "state") {
        phase = m.phase!;
        clockOffset = m.now! - Date.now();
        setView(m as View);
      } else if (m.t === "error") {
        setError(m.msg!);
      } else if (m.t === "fatal") {
        stopped = true;
        polling = false;
        setFatal(m.msg!);
      }
    };

    // ---- the HTTPS fallback ----
    let failedOpens = 0; // sockets in a row that closed without ever opening
    let polling = false;
    let rev = "";
    let queue: (TableMsg | AdminMsg)[] = [];
    let inflight = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let busyUntil = 0;
    let changedAt = Date.now();
    const pollEvery = () =>
      Date.now() - changedAt > QUIET_AFTER
        ? QUIET_MS
        : phase === "open" || query.startsWith("role=screen")
          ? FAST_MS
          : SLOW_MS;

    const poll = async () => {
      clearTimeout(pollTimer);
      if (!polling || stopped || inflight) return;
      // Hidden: wait for wake() to ask again, unless something needs sending.
      if (document.visibilityState === "hidden" && !queue.length) return;
      inflight = true;
      const msgs = queue;
      queue = [];
      try {
        const res = await fetch(`/api?${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rev, msgs }),
          cache: "no-store",
        });
        if (res.status === 429) busyUntil = Date.now() + BUSY_MS;
        if (!res.ok) throw new Error(String(res.status));
        const r: { rev: string; msgs: { t: string }[] } = await res.json();
        if (r.rev !== rev) changedAt = Date.now();
        rev = r.rev;
        r.msgs.forEach(handle);
        if (polling && !wsRef.current) setStatus("open");
      } catch {
        // Not resent: the server may have applied them before the reply was lost.
        if (msgs.some((m) => m.t !== "move")) setError("送信できませんでした。もう一度お試しください");
        if (polling && !wsRef.current) setStatus("closed");
      }
      inflight = false;
      const wait = Math.max(queue.length ? 0 : pollEvery(), busyUntil - Date.now());
      if (polling && !stopped) pollTimer = setTimeout(poll, wait);
    };

    // A needle move replaces any move still waiting, so dragging sends one request per poll.
    queueRef.current = (m) => {
      if (!polling) return false;
      if (m.t === "move") queue = queue.filter((x) => x.t !== "move");
      queue.push(m);
      void poll();
      return true;
    };

    const startPolling = () => {
      if (polling) return;
      polling = true;
      void poll();
    };

    const stopPolling = (socket: WebSocket) => {
      if (!polling) return;
      polling = false;
      clearTimeout(pollTimer);
      for (const m of queue) socket.send(JSON.stringify(m));
      queue = [];
    };

    const open = () => {
      clearTimeout(retryTimer);
      if (stopped) return;
      const socket = new WebSocket(url);
      ws = wsRef.current = socket;
      setStatus("connecting");
      let opened = false;
      socket.onopen = () => {
        opened = true;
        retries = 0;
        failedOpens = 0;
        lastMessage = Date.now();
        stopPolling(socket);
        setStatus("open");
      };
      socket.onmessage = (e) => {
        lastMessage = Date.now();
        if (e.data === "pong") return;
        handle(JSON.parse(e.data));
      };
      socket.onclose = (e) => {
        if (ws !== socket) return;
        ws = wsRef.current = null;
        if (!opened && ++failedOpens >= 2) startPolling();
        if (!polling) setStatus("closed");
        if (stopped) return;
        // while the fallback works, try the WebSocket again only now and then
        const wait = e.code === 4029 ? BUSY_MS : polling ? 30000 : Math.min(5000, 500 * 2 ** retries++);
        retryTimer = setTimeout(open, wait);
      };
    };

    // Drop a socket without waiting for its close handshake and start a new one.
    const restart = () => {
      const old = ws;
      ws = wsRef.current = null;
      old?.close();
      open();
    };

    const heartbeat = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessage > 25000) restart();
      else ws.send("ping");
    }, 10000);

    const wake = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (polling) void poll();
      if (!ws) return polling ? undefined : open();
      const asked = Date.now();
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      setTimeout(() => {
        if (lastMessage < asked && !stopped) restart();
      }, 3000);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    open();
    return () => {
      stopped = true;
      polling = false;
      queueRef.current = null;
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
      clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      ws?.close();
    };
  }, [query]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const send = (m: TableMsg | AdminMsg): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      if (queueRef.current?.(m)) return true;
      setError("接続が切れています。再接続をお待ちください");
      return false;
    }
    ws.send(JSON.stringify(m));
    return true;
  };

  return { view, status, fatal, error, send };
}

// Re-render every `ms` while active (for countdowns).
export function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!ms) return;
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode: the admin just logs in again
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
