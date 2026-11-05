export { Game } from "./game";

// Static pages are served from assets; only the game's endpoints reach the
// Worker: the WebSocket, and /api, the HTTPS fallback for networks that break it.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (
      (url.pathname === "/ws" && req.headers.get("Upgrade") === "websocket") ||
      (url.pathname === "/api" && req.method === "POST")
    ) {
      return env.GAME.getByName("main").fetch(req);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
