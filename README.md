# lowk-cazik (GitHub Pages + Supabase)

Current version includes:
- case opening
- rocket
- upgrader
- slots
- leaderboard
- Telegram-based account binding (same Telegram account -> same player profile)

## 1. Create Supabase table/migration

1. Open Supabase -> `SQL Editor`.
2. Create `New query`.
3. Paste `supabase/schema.sql` from this repo.
4. Run.

This script is idempotent and can be re-run safely.

## 2. Get Supabase keys

Supabase -> `Project Settings` -> `API`:
- `Project URL`
- `Publishable key (anon)`

Do not use `secret`/`service_role` in frontend.

## 3. Create local env file

In project root:

```powershell
copy .env.example .env.local
```

Then fill `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_DEFAULT_BALANCE=0
VITE_TELEGRAM_BOT_USERNAME=YOUR_BOT_USERNAME_WITHOUT_AT
```

`VITE_TELEGRAM_BOT_USERNAME` is used to generate market links in format `https://t.me/<bot>/app?startapp=...` so they open directly in Telegram WebApp.

## 4. Run

```powershell
npm install
npm run dev
```

## 5. GitHub Pages deploy

If you deploy via GitHub Actions, add repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_BALANCE` (optional)

## 6. Telegram bot setup

In `@BotFather` set WebApp Menu URL to your GitHub Pages URL.

## Verification checklist

1. Open app from Telegram bot menu button.
2. Profile shows your player and data persists after reopen.
3. `players` table has one stable row for your Telegram id.
4. Balance/inventory change in-game and update in Supabase.
