# 波長あわせゲーム

A Wavelength-style party game for a company event, in Japanese. Each table shares
one phone, and the table answers together by turning a needle on a half-circle
dial. A projector shows the question and the scores, and staff run the game from
an admin page.

| Page | Who | URL |
| --- | --- | --- |
| Table | one phone per table, opened from the printed QR card | `/t/<table>/<token>` |
| Projector | the big screen | `/screen` |
| Admin | staff (password) | `/admin` |
| QR cards | staff, for printing | `/admin/qr` |

## How a round goes

1. The admin presses **▶ Qn を出題**. The question and the timer appear on the projector and on every phone.
2. Tables turn the needle and press **この位置で回答する**. They can press **修正する** until time runs out. If a table never presses it, the needle's last position counts. A table that never touched the needle has no answer.
3. When time is up (or the admin presses **締め切る**), the projector shows every table's needle, but not the answer.
4. **正解を発表** shows the scoring wedge, the answer and the points: 4 for being within ±2.5 of the answer, 3 within ±7.5, and 2 within ±12.5, on the 0–100 scale. To change the points, edit `BANDS` in `shared/game.ts`.
5. **スコアを表示** shows the ranking on each phone and, on the projector, a bar graph of every table's total:
   - one block per question
   - the latest question's points in pink
   - ▲/▼ for how far each table moved since the previous question

The answer is never sent to a phone or to the projector before the reveal. The
server builds a separate view for each kind of page.

## Run it locally

```sh
npm install
npm run dev          # http://localhost:5173  (admin password: "dev", from .dev.vars)
npm test             # game-rule tests
npm run typecheck
```

`npm run dev` also prints a `Network:` URL. Open the admin page and the QR page
through that URL to test with real phones on the same Wi-Fi.

## Deploy (Cloudflare, free plan)

```sh
npx wrangler login
npm run deploy                      # → https://hacho-game.<your-subdomain>.workers.dev
npx wrangler secret put ADMIN_KEY   # the admin password
```

To use a different URL, change `name` in `wrangler.jsonc` before the first deploy.
The free plan is plenty for one event.

Cloudflare waits up to 5 minutes, or until the game is idle, before the running
game picks up new server code. Pages that are open keep the old server until then.
To switch over right away (safe: the game state is saved), deploy with:

```sh
npm run build && npx wrangler deploy --durable-objects-code-update-mode immediate
```

## Before the event

1. Admin → 設定: set the title, the number of tables and the answer time.
2. Admin → 問題の読み込み: paste your questions from a spreadsheet with these five columns, in this order:
   - お題 (the question)
   - 左 (left end label)
   - 右 (right end label)
   - 正解 (the answer, 0–100)
   - 解説 (optional; shown at the reveal)

   For a quantity like a height, scale it onto 0–100 and say so in 解説 (see the Mt. Fuji sample). A survey average or the CEO's own answer also makes a good target.
3. Open `/admin/qr` **on the deployed URL** and print one card per table.
   - The cards stay valid across resets.
   - They change only if the game's storage is wiped (for example, if you delete the Worker).
4. Rehearse with a few phones on the venue Wi-Fi, then press **ゲームをリセット**. This clears scores and team names, and keeps the questions, the settings and the QR cards.

## If something goes wrong on the day

- **A phone sleeps or drops off Wi-Fi:** it reconnects by itself and gets back its table's answer, score and timer.
- **A network blocks the live connection** (some company web filters break WebSockets): the page notices and asks the server about once a second over normal HTTPS instead. Everything works; updates on that device can lag by up to a second. Other devices are not affected.
- **A phone dies:** scan the same table card with another phone.
- **Time runs out too early:** use **+15秒** while answers are open, or start the question again from 問題一覧. Playing a question again replaces its earlier points.
- **A score needs fixing:** use the **+1 / −1** buttons in スコア. Team names can be changed there too.

## Look

The design is a two-ink risograph print: warm paper, pink and blue inks that blend to
purple, and dot-pattern shading. The colours are the variables at the top of
`src/style.css`. The fonts (Dela Gothic One, Zen Maru Gothic) come from Google Fonts
and load without blocking the page, so if Google is slow or blocked the system fonts are used.

## Layout

- `shared/game.ts`: state, rules, scoring and the per-role views (pure functions, unit-tested)
- `shared/questions.ts`: the sample questions and the spreadsheet import/export
- `worker/game.ts`: a Durable Object that holds the event
  - keeps the game state in storage
  - holds the WebSocket connections, and answers `POST /api`, the HTTPS fallback for networks that break WebSockets
  - runs the answer timer as an alarm
  - signs the QR tokens
- `src/`: the Preact pages; each page loads as its own small chunk
