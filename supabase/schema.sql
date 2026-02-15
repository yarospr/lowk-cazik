-- Run in Supabase SQL Editor

create table if not exists public.players (
  telegram_id text primary key,
  username text,
  first_name text,
  last_name text,
  display_name text,
  is_public boolean not null default false,
  balance bigint not null default 0,
  inventory_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.players add column if not exists username text;
alter table public.players add column if not exists first_name text;
alter table public.players add column if not exists last_name text;
alter table public.players add column if not exists display_name text;
alter table public.players add column if not exists is_public boolean not null default false;
alter table public.players add column if not exists balance bigint not null default 0;
alter table public.players add column if not exists inventory_json jsonb not null default '[]'::jsonb;
alter table public.players add column if not exists created_at timestamptz not null default now();
alter table public.players add column if not exists updated_at timestamptz not null default now();

update public.players
set display_name = coalesce(nullif(display_name, ''), first_name, username, 'Player')
where display_name is null or display_name = '';

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

create index if not exists idx_players_balance_desc on public.players (balance desc);

alter table public.players enable row level security;

drop policy if exists "anon select players" on public.players;
create policy "anon select players"
on public.players
for select
to anon
using (true);

drop policy if exists "anon insert players" on public.players;
create policy "anon insert players"
on public.players
for insert
to anon
with check (true);

drop policy if exists "anon update players" on public.players;
create policy "anon update players"
on public.players
for update
to anon
using (true)
with check (true);

create table if not exists public.market_offers (
  offer_id text primary key,
  seller_telegram_id text not null,
  buyer_telegram_id text,
  item_json jsonb not null,
  price bigint not null default 0 check (price >= 0),
  description text not null default '',
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'LINK_ONLY')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SOLD', 'CANCELLED')),
  created_at timestamptz not null default now(),
  sold_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.market_offers add column if not exists offer_id text;
alter table public.market_offers add column if not exists seller_telegram_id text;
alter table public.market_offers add column if not exists buyer_telegram_id text;
alter table public.market_offers add column if not exists item_json jsonb not null default '{}'::jsonb;
alter table public.market_offers add column if not exists price bigint not null default 0;
alter table public.market_offers add column if not exists description text not null default '';
alter table public.market_offers add column if not exists visibility text not null default 'PUBLIC';
alter table public.market_offers add column if not exists status text not null default 'ACTIVE';
alter table public.market_offers add column if not exists created_at timestamptz not null default now();
alter table public.market_offers add column if not exists sold_at timestamptz;
alter table public.market_offers add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_offers_status_visibility_created_at
  on public.market_offers (status, visibility, created_at desc);
create index if not exists idx_market_offers_seller_id
  on public.market_offers (seller_telegram_id);

drop trigger if exists trg_market_offers_updated_at on public.market_offers;
create trigger trg_market_offers_updated_at
before update on public.market_offers
for each row
execute function public.touch_updated_at();

alter table public.market_offers enable row level security;

drop policy if exists "anon select market_offers" on public.market_offers;
create policy "anon select market_offers"
on public.market_offers
for select
to anon
using (true);

drop policy if exists "anon insert market_offers" on public.market_offers;
create policy "anon insert market_offers"
on public.market_offers
for insert
to anon
with check (true);

drop policy if exists "anon update market_offers" on public.market_offers;
create policy "anon update market_offers"
on public.market_offers
for update
to anon
using (true)
with check (true);
