# lowk-cazik (GitHub Pages + Supabase Free)

This version is made for:
- Frontend: GitHub Pages
- Database: Supabase (free cloud PostgreSQL)

## Why this setup

GitHub Pages cannot run backend code (Node/SQLite). It can host only static files.
So game progress must be stored in a cloud DB. Here we use Supabase Free.

## Step-by-step setup (for beginners)

### 1. Create free Supabase project

1. Open: https://supabase.com/
2. Sign up / log in.
3. Click `New project`.
4. Fill project name and DB password.
5. Wait until project status becomes ready.

### 2. Create table in Supabase

1. In Supabase dashboard open `SQL Editor`.
2. Create `New query`.
3. Open file `supabase/schema.sql` in this repo.
4. Copy all SQL and run it.

This creates table `public.players` where progress is stored by `telegram_id`.

### 3. Copy Supabase keys

In Supabase dashboard open `Project Settings` -> `API` and copy:
- `Project URL`
- `anon public` key

### 4. Put keys into local env

In project folder run:

```bash
copy .env.example .env.local
```

Then open `.env.local` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
VITE_DEFAULT_BALANCE=1000
```

### 5. Run locally

```bash
npm install
npm run dev
```

### 6. Deploy to GitHub Pages

Important: GitHub Pages build also needs these env vars.
If you deploy with GitHub Actions, add repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_BALANCE` (optional)

Then build/publish frontend as usual.

### 7. Telegram BotFather WebApp URL

In `@BotFather` set menu button URL to your GitHub Pages frontend URL.
Example:

`https://your-username.github.io/lowk-cazik/`

## Notes

- If Supabase keys are not set, app falls back to localStorage mode.
- In localStorage mode progress is only on one device/browser.
- In Supabase mode progress is cloud-synced by Telegram user id.
