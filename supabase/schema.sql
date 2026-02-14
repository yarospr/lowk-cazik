-- Run this SQL in Supabase SQL Editor
create table if not exists public.players (
  telegram_id text primary key,
  username text,
  first_name text,
  last_name text,
  balance bigint not null default 1000,
  inventory_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_players_updated_at on public.players;
create trigger trg_players_updated_at
before update on public.players
for each row
execute function public.touch_updated_at();

alter table public.players enable row level security;

-- Quick-start policies for a Telegram mini-app without Supabase Auth.
-- Later you can tighten this via auth or Edge Functions.
create policy "anon select players"
on public.players
for select
to anon
using (true);

create policy "anon insert players"
on public.players
for insert
to anon
with check (true);

create policy "anon update players"
on public.players
for update
to anon
using (true)
with check (true);
