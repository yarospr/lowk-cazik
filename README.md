# lowk-cazik

Telegram Mini App with case opening, market, leaderboard and games. The online
mode uses a Supabase Edge Function as the only public API: the function validates
Telegram `initData`, and privileged database keys never reach the browser.

## Storage modes

- Online: set `VITE_SUPABASE_URL`. Telegram users share profiles, market and leaderboard.
- Local development: without Telegram `initData`, the app uses IndexedDB in the current browser.
- Forced local: set `VITE_FORCE_LOCAL_DB=1`.

Local storage is a development/recovery mode. It is not a shared market.

## 1. Create the Supabase schema

Open Supabase `SQL Editor`, paste `supabase/schema.sql`, and run it. The script
creates the player and market tables plus atomic market functions. Direct access
from `anon` and `authenticated` clients is revoked.

## 2. Deploy the API

Install and authenticate the Supabase CLI, link the project, then deploy:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy game-api
supabase secrets set TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN APP_ORIGIN=https://yarospr.github.io
```

Optional server settings:

```powershell
supabase secrets set DEFAULT_BALANCE=0 TELEGRAM_AUTH_MAX_AGE=86400
```

`TELEGRAM_BOT_TOKEN` and Supabase secret/service-role keys are server-only. Never
put them in `.env.local`, Vite variables, source control, or a GitHub Pages build.

## 3. Configure the frontend

```powershell
copy .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_DEFAULT_BALANCE=0
VITE_TELEGRAM_BOT_USERNAME=YOUR_BOT_USERNAME_WITHOUT_AT
VITE_TELEGRAM_APP_SHORT_NAME=
VITE_FORCE_LOCAL_DB=0
```

For a Main Mini App, leave `VITE_TELEGRAM_APP_SHORT_NAME` empty. Shared offers
then use `https://t.me/<bot>?startapp=o_<id>`. For a named Mini App, enter
the exact short name from BotFather; links use
`https://t.me/<bot>/<short-name>?startapp=o_<id>`.

The old hardcoded `/app` path is not universally valid and must not be used unless
the Mini App short name is literally `app`.

## 4. Run locally

```powershell
npm install
npm run dev
```

## 5. GitHub Pages

Build the frontend with these repository secrets/variables:

- `VITE_SUPABASE_URL`
- `VITE_DEFAULT_BALANCE` (optional)
- `VITE_TELEGRAM_BOT_USERNAME`
- `VITE_TELEGRAM_APP_SHORT_NAME` (only for a named Mini App)

In BotFather, set the menu/Main Mini App URL to the GitHub Pages URL.

## Security boundary

Anything shipped to a browser can be downloaded, including HTML, CSS, JavaScript
and item images. Minification does not change that. Protection comes from keeping
identity validation, RNG, balance changes, inventory changes, market transactions,
rate limits and audit logs on a private backend. The current API already validates
Telegram identity and makes market writes atomic; moving all game outcomes and
economy synchronization server-side is the next hardening stage.

The extraction boundary and staged hardening plan are documented in
`docs/backend-separation.md`.

For stronger source separation, keep the frontend source and backend in private
repositories and publish only the compiled frontend assets. The compiled UI still
remains observable, but a copied client cannot access protected data or perform
valid economy operations without the server API.

## Verification

1. Open from the Telegram menu button, not a normal browser tab.
2. Confirm one stable `players` row is created for the Telegram user.
3. Open the same app from another device and confirm shared balance/inventory.
4. Create and buy an offer with two Telegram accounts.
5. Confirm invalid or stale `initData` receives `401` from `game-api`.
