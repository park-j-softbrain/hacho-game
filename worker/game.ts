import { DurableObject } from "cloudflare:workers";
import {
  applyAdmin,
  applyTable,
  buildView,
  closeIfExpired,
  GRACE_MS,
  initialState,
  type AdminMsg,
  type GameState,
  type TableMsg,
  type Viewer,
} from "../shared/game";
import { SAMPLE_QUESTIONS } from "../shared/questions";
import { Bucket, Limiter } from "./limits";

type Attachment = { role: "screen" } | { role: "admin" } | { role: "table"; n: number };

// Rate limits. Real use is far below these: a phone sends at most ~4 needle moves a second.
const FAILS_PER_MIN = 20; // wrong passwords or QR codes from one IP address, then it waits a minute
const REQUESTS_PER_MIN = 360; // connections and fallback requests per IP address and page (several screens can share one office address)
const MAX_SOCKETS = 300; // open connections in total
const MSG_BURST = 30; // messages one connection can send at once…
const MSG_PER_SEC = 10; // …and per second after that
const SLOW_DOWN = "アクセスが多すぎます。1分ほど待ってから、もう一度お試しください。";

// One instance holds the whole event: state, connections and the answer timer.
// It uses the WebSocket Hibernation API, so it can sleep between messages and
// reloads its state from storage when it wakes.
export class Game extends DurableObject<Env> {
  private s!: GameState;
  private secret!: string; // signs the per-table QR tokens; survives resets
  private tokens = new Map<number, string>();
  private fails = new Limiter(FAILS_PER_MIN);
  private requests = new Limiter(REQUESTS_PER_MIN);
  private buckets = new WeakMap<WebSocket, Bucket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<GameState>("state");
      this.s = { ...initialState(SAMPLE_QUESTIONS), ...stored };
      let secret = await ctx.storage.get<string>("tableSecret");
      if (!secret) {
        secret = randomSecret();
        await ctx.storage.put("tableSecret", secret);
      }
      this.secret = secret;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const ip = req.headers.get("CF-Connecting-IP") ?? "local";
    // An address that keeps guessing passwords or QR codes is turned away for a minute.
    const att = this.fails.over(ip) ? SLOW_DOWN : await this.authorize(new URL(req.url));
    if (typeof att === "string" && att !== SLOW_DOWN) this.fails.hit(ip);
    const who = typeof att === "string" ? "refused" : att.role === "table" ? `table:${att.n}` : att.role;
    const busy = !this.requests.hit(`${ip}|${who}`) || this.ctx.getWebSockets().length >= MAX_SOCKETS;

    const [client, server] = Object.values(new WebSocketPair());
    if (busy) return closeBusy(client, server);
    if (typeof att === "string") return refuse(client, server, att);
    this.ctx.acceptWebSocket(server, [att.role]);
    server.serializeAttachment(att);
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Who is asking, from the page's query string; a string is the reason to refuse.
  private async authorize(url: URL): Promise<Attachment | string> {
    const role = url.searchParams.get("role");
    const k = url.searchParams.get("k") ?? "";
    if (role === "screen") return { role: "screen" };
    if (role === "admin") {
      if (!this.env.ADMIN_KEY) return "ADMIN_KEY が設定されていません（README参照）";
      if (!sameString(k, this.env.ADMIN_KEY)) return "パスワードが違います";
      return { role: "admin" };
    }
    if (role === "table") {
      const n = Number(url.searchParams.get("n"));
      const valid = Number.isInteger(n) && n >= 1 && n <= this.s.tableCount && sameString(k, await this.token(n));
      if (!valid) return "このQRコードは使えません。スタッフに声をかけてください。";
      return { role: "table", n };
    }
    return "不正な接続です";
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string") return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;
    // The projector only listens; anything it sends is not from the app.
    if (att.role === "screen") return ws.close(1008, "read-only");
    let bucket = this.buckets.get(ws);
    if (!bucket) this.buckets.set(ws, (bucket = new Bucket(MSG_BURST, MSG_PER_SEC)));
    if (!bucket.take()) return; // dropped: far faster than the app ever sends
    const error = await this.apply(att, [m]);
    if (error) ws.send(JSON.stringify({ t: "error", msg: error }));
  }

  // Applies a page's messages in order and tells everyone; returns the first error.
  private async apply(att: Attachment, msgs: unknown[]): Promise<string | undefined> {
    const now = Date.now();
    let changed = false;
    let movesOnly = true;
    let error: string | undefined;
    for (const raw of msgs) {
      const m = raw as { t?: unknown };
      const e =
        att.role === "table"
          ? applyTable(this.s, att.n, m as TableMsg, now)
          : att.role === "admin"
            ? applyAdmin(this.s, m as AdminMsg, now)
            : "閲覧専用です";
      if (e) error ??= e;
      else {
        changed = true;
        if (m.t !== "move") movesOnly = false;
      }
    }
    if (!changed) return error;
    await this.save();
    // A needle move only matters to the admin and to that table's own phones.
    const only =
      movesOnly && att.role === "table"
        ? (a: Attachment) => a.role === "admin" || (a.role === "table" && a.n === att.n)
        : undefined;
    await this.broadcast(only);
    return error;
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000, "bye");
    } catch {
      // already closed by the runtime
    }
    await this.broadcast(undefined, ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.broadcast(undefined, ws);
  }

  async alarm() {
    if (closeIfExpired(this.s, Date.now() - GRACE_MS)) {
      await this.save();
      await this.broadcast();
    } else {
      await this.save(); // re-arms the alarm if time was added
    }
  }

  private async save() {
    await this.ctx.storage.put("state", this.s);
    const want = this.s.phase === "open" ? this.s.deadline + GRACE_MS : null;
    if ((await this.ctx.storage.getAlarm()) === want) return;
    if (want === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(want);
  }

  private async broadcast(only?: (a: Attachment) => boolean, gone?: WebSocket) {
    const sockets = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== gone && ws.readyState === WebSocket.READY_STATE_OPEN);
    const atts = sockets.map((ws) => ws.deserializeAttachment() as Attachment);
    const online = this.online(atts);
    const views = new Map<string, string>(); // one JSON per role (per table for phones)
    for (const [i, ws] of sockets.entries()) {
      const a = atts[i];
      if (only && !only(a)) continue;
      const key = a.role === "table" ? `table:${a.n}` : a.role;
      let msg = views.get(key);
      if (!msg) {
        msg = JSON.stringify(await this.viewFor(a, online));
        views.set(key, msg);
      }
      try {
        ws.send(msg);
      } catch {
        // socket went away mid-broadcast; its close handler will update the others
      }
    }
  }

  // Tables with a phone connected.
  private online(atts?: Attachment[]): Set<number> {
    atts ??= this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN)
      .map((ws) => ws.deserializeAttachment() as Attachment);
    return new Set(atts.flatMap((a) => (a.role === "table" ? [a.n] : [])));
  }

  private async viewFor(a: Attachment, online: Set<number>) {
    const viewer: Viewer = a.role === "admin" ? { role: "admin", tokens: await this.allTokens() } : a;
    return buildView(this.s, viewer, online, Date.now());
  }

  private async allTokens(): Promise<Record<number, string>> {
    const tokens: Record<number, string> = {};
    for (let n = 1; n <= this.s.tableCount; n++) tokens[n] = await this.token(n);
    return tokens;
  }

  // The QR code for table n carries this token, so a printed card keeps working
  // across resets and can't be edited into another table's card.
  private async token(n: number): Promise<string> {
    let t = this.tokens.get(n);
    if (!t) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(this.secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]);
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`table:${n}`));
      t = base64url(new Uint8Array(sig)).slice(0, 10);
      this.tokens.set(n, t);
    }
    return t;
  }
}

// Accept and close at once with a "slow down" code; the page waits before trying again.
function closeBusy(client: WebSocket, server: WebSocket): Response {
  server.accept();
  server.close(4029, "busy");
  return new Response(null, { status: 101, webSocket: client });
}

// Accept just long enough to tell the page why, so it stops reconnecting.
function refuse(client: WebSocket, server: WebSocket, msg: string): Response {
  server.accept();
  server.send(JSON.stringify({ t: "fatal", msg }));
  server.close(4000, "refused");
  return new Response(null, { status: 101, webSocket: client });
}

function sameString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
