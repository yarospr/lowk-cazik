# lowk-cazik

Telegram WebApp casino with persistent accounts bound to `telegram_id`.

## What was fixed

- Account identity is now tied to Telegram user id (`telegram_id`), so one Telegram account no longer creates a new in-game account on each launch.
- Added server API + SQLite database (`server/casino.db`) for persistent state.
- Added local fallback mode for regular browser launches (without Telegram context).
- Added migration from old keys `ccc_balance`/`ccc_inventory` to scoped storage keys.

## Database restore (if DB file was deleted)

1. Open terminal in project root.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start server once:
   ```bash
   npm run dev:server
   ```

After server start, a new SQLite file is created automatically:

- `server/casino.db`

No manual SQL needed for restore in this version.

## What to open and what to fill in

1. Open project file `.env` (create it from `.env.example`):
   ```bash
   copy .env.example .env
   ```
2. In `.env` fill:
   - `TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_FROM_BOTFATHER`
   - Optional: `DEFAULT_BALANCE=1000`

3. In Telegram open `@BotFather`, run `/setmenubutton` for your bot and set your WebApp URL.
4. In Telegram open your bot and launch the WebApp from the menu button.

## Run full app locally

```bash
npm install
npm run dev
```

This starts:

- Frontend: `http://localhost:3000`
- API: `http://localhost:3001`

## API check

Open in browser:

- `http://localhost:3001/api/health`

If server is OK, you will see JSON with `ok: true` and DB path.

