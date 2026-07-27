# Backend separation

## What can and cannot be hidden

The browser must download the rendered frontend, so deployed HTML, CSS,
JavaScript and image assets can always be inspected or copied. Obfuscation only
raises the effort slightly. The useful security boundary is a private API that
owns identity, game outcomes and every economy mutation.

## Repository boundary

Keep these paths in a private backend repository:

- `supabase/functions/game-api/`
- `supabase/schema.sql`
- backend tests and deployment configuration
- future game rules, RNG, rate limits and audit logic

The frontend repository should contain only the API client contract. Its only
production configuration is `VITE_SUPABASE_URL`; no database key or bot token is
needed in the browser.

The existing `supabase/` directory is deliberately self-contained so it can be
moved to a private repository without changing the `/functions/v1/game-api`
endpoint used by `gameDatabase.ts`.

## Required server ownership

The backend must be authoritative for:

1. Telegram `initData` validation and user identity.
2. Case, slots, rocket, upgrader and business outcomes.
3. Cryptographically secure RNG and an immutable outcome audit record.
4. Balance, inventory, statistics and market mutations.
5. Per-user rate limits, idempotency keys and replay protection.
6. Item catalog versions and price/rule versions used for each outcome.

The current backend already owns identity and atomic market transactions. The
temporary `sync_player` action still accepts game state calculated by the client,
so it is a compatibility path, not an anti-cheat boundary.

## Migration stages

### Stage A: production recovery

- Deploy the current schema and `game-api` function.
- Configure `TELEGRAM_BOT_TOKEN`, `APP_ORIGIN` and the frontend project URL.
- Verify the shared market and leaderboard with two Telegram accounts.

### Stage B: server-side case opening

- Add `open_cases(case_id, quantity, idempotency_key)`.
- Lock the player row, charge once, choose drops with `crypto.getRandomValues`,
  append canonical inventory items and return only animation results.
- Remove balance/inventory fields from `sync_player` after the client switches.

### Stage C: remaining games

- Add one transactional command per game action.
- Store pending rocket/upgrader/slots sessions server-side with expiry times.
- Reject duplicate command IDs and impossible state transitions.

### Stage D: abuse controls

- Add request and economy audit tables.
- Rate-limit by Telegram user and command type.
- Alert on repeated invalid signatures, replay attempts and abnormal value flow.
- Rotate the bot token and backend secret immediately if either is exposed.

## Request contract

Every request uses:

```json
{
  "action": "command_name",
  "payload": {},
  "initData": "Telegram.WebApp.initData"
}
```

For state-changing commands, add a client-generated `idempotency_key`. The server
must store it with the user ID and return the original result for retries instead
of applying the mutation twice.

## Deployment layout

- Frontend: static GitHub Pages deployment.
- Backend: Supabase Edge Functions in a separate private repository.
- Database: Supabase Postgres with RLS and no direct `anon` table grants.
- Secrets: Supabase project secrets only, never Vite or GitHub Pages variables.

CORS limits which browser origins can call the API, but it is not authentication.
Telegram signature validation and server-owned state are the actual security
controls.
