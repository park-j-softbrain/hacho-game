export { Game } from "./game";

// Static pages are served from assets; only the WebSocket reaches the Worker.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && req.headers.get("Upgrade") === "websocket") {
      return env.GAME.getByName("main").fetch(req);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
