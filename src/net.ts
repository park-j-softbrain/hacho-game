import { useEffect, useRef, useState } from "preact/hooks";
import type { AdminMsg, TableMsg, View } from "../shared/game";

export type Status = "connecting" | "open" | "closed";

let clockOffset = 0;

// The server's clock, so every phone counts down to the same deadline.
export function serverNow(): number {
  return Date.now() + clockOffset;
}

const BUSY_MS = 10000; // how long to wait when the server says to slow down

// Keeps one WebSocket to the game open: reconnects with backoff, and checks the
// connection again when a phone wakes up, since a sleeping phone's socket often
// looks open but is dead.
export function useGame(query: string) {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${query}`;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retries = 0;
    let lastMessage = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const handle = (m: { t: string; msg?: string; now?: number }) => {
      if (m.t === "state") {
        clockOffset = m.now! - Date.now();
        setView(m as View);
      } else if (m.t === "error") {
        setError(m.msg!);
      } else if (m.t === "fatal") {
        stopped = true;
        setFatal(m.msg!);
      }
    };

    const open = () => {
      clearTimeout(retryTimer);
      if (stopped) return;
      const socket = new WebSocket(url);
      ws = wsRef.current = socket;
      setStatus("connecting");
      socket.onopen = () => {
        retries = 0;
        lastMessage = Date.now();
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
        setStatus("closed");
        if (stopped) return;
        const wait = e.code === 4029 ? BUSY_MS : Math.min(5000, 500 * 2 ** retries++);
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
      if (!ws) return open();
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
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
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
