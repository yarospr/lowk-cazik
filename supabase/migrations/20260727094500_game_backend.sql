-- Run in Supabase SQL Editor

create table if not exists public.players (
  telegram_id text primary key,
  username text,
  first_name text,
  last_name text,
  display_name text,
  is_public boolean not null default false,
  show_profile_link boolean not null default false,
  stats_cases_opened bigint not null default 0,
  stats_total_spent bigint not null default 0,
  stats_total_won bigint not null default 0,
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
alter table public.players add column if not exists show_profile_link boolean not null default false;
alter table public.players add column if not exists stats_cases_opened bigint not null default 0;
alter table public.players add column if not exists stats_total_spent bigint not null default 0;
alter table public.players add column if not exists stats_total_won bigint not null default 0;
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
drop policy if exists "anon insert players" on public.players;
drop policy if exists "anon update players" on public.players;
revoke all on public.players from anon, authenticated;

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
drop policy if exists "anon insert market_offers" on public.market_offers;
drop policy if exists "anon update market_offers" on public.market_offers;
revoke all on public.market_offers from anon, authenticated;

create or replace function public.create_market_offer_atomic(
  p_seller_telegram_id text,
  p_offer_id text,
  p_item_json jsonb,
  p_price bigint,
  p_description text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_offer public.market_offers%rowtype;
  v_item_id text;
  v_inventory_item jsonb;
begin
  v_item_id := nullif(p_item_json->>'uniqueId', '');
  if v_item_id is null then raise exception 'Item id is required'; end if;
  if p_offer_id !~ '^offer_[A-Za-z0-9_-]+$' then raise exception 'Invalid offer id'; end if;
  if p_price < 0 then raise exception 'Price cannot be negative'; end if;
  if p_visibility not in ('PUBLIC', 'LINK_ONLY') then raise exception 'Invalid visibility'; end if;

  select * into v_player
  from public.players
  where telegram_id = p_seller_telegram_id
  for update;
  if not found then raise exception 'Seller not found'; end if;
  select item into v_inventory_item
  from jsonb_array_elements(v_player.inventory_json) item
  where item->>'uniqueId' = v_item_id
  limit 1;
  if v_inventory_item is null then raise exception 'Item is not in inventory'; end if;

  update public.players
  set inventory_json = coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(v_player.inventory_json) item
    where item->>'uniqueId' <> v_item_id
  ), '[]'::jsonb)
  where telegram_id = p_seller_telegram_id;

  insert into public.market_offers (
    offer_id, seller_telegram_id, item_json, price, description, visibility, status
  ) values (
    p_offer_id, p_seller_telegram_id, v_inventory_item, p_price,
    left(coalesce(p_description, ''), 280), p_visibility, 'ACTIVE'
  ) returning * into v_offer;

  return to_jsonb(v_offer);
end;
$$;

create or replace function public.cancel_market_offer_atomic(
  p_seller_telegram_id text,
  p_offer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.market_offers%rowtype;
  v_player public.players%rowtype;
begin
  select * into v_offer
  from public.market_offers
  where offer_id = p_offer_id
  for update;
  if not found or v_offer.status <> 'ACTIVE' then raise exception 'Offer is not active'; end if;
  if v_offer.seller_telegram_id <> p_seller_telegram_id then raise exception 'Not the seller'; end if;

  select * into v_player
  from public.players
  where telegram_id = p_seller_telegram_id
  for update;
  if not found then raise exception 'Seller not found'; end if;

  update public.players
  set inventory_json = jsonb_build_array(v_offer.item_json) || inventory_json
  where telegram_id = p_seller_telegram_id
  returning * into v_player;

  update public.market_offers
  set status = 'CANCELLED'
  where offer_id = p_offer_id
  returning * into v_offer;

  return jsonb_build_object('offer', to_jsonb(v_offer), 'player', to_jsonb(v_player));
end;
$$;

create or replace function public.buy_market_offer_atomic(
  p_buyer_telegram_id text,
  p_offer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.market_offers%rowtype;
  v_buyer public.players%rowtype;
  v_seller public.players%rowtype;
begin
  select * into v_offer
  from public.market_offers
  where offer_id = p_offer_id
  for update;
  if not found or v_offer.status <> 'ACTIVE' then raise exception 'Offer is not active'; end if;
  if v_offer.seller_telegram_id = p_buyer_telegram_id then raise exception 'Cannot buy own offer'; end if;

  perform 1
  from public.players
  where telegram_id in (p_buyer_telegram_id, v_offer.seller_telegram_id)
  order by telegram_id
  for update;

  select * into v_buyer from public.players where telegram_id = p_buyer_telegram_id;
  select * into v_seller from public.players where telegram_id = v_offer.seller_telegram_id;
  if v_buyer.telegram_id is null or v_seller.telegram_id is null then raise exception 'Player not found'; end if;
  if v_buyer.balance < v_offer.price then raise exception 'Insufficient balance'; end if;

  update public.players
  set balance = balance - v_offer.price,
      inventory_json = jsonb_build_array(v_offer.item_json) || inventory_json,
      stats_total_spent = stats_total_spent + v_offer.price
  where telegram_id = p_buyer_telegram_id
  returning * into v_buyer;

  update public.players
  set balance = balance + v_offer.price,
      stats_total_won = stats_total_won + v_offer.price
  where telegram_id = v_offer.seller_telegram_id
  returning * into v_seller;

  update public.market_offers
  set status = 'SOLD', buyer_telegram_id = p_buyer_telegram_id, sold_at = now()
  where offer_id = p_offer_id
  returning * into v_offer;

  return jsonb_build_object(
    'offer', to_jsonb(v_offer),
    'buyer', to_jsonb(v_buyer)
  );
end;
$$;

revoke all on function public.create_market_offer_atomic(text, text, jsonb, bigint, text, text) from public, anon, authenticated;
revoke all on function public.cancel_market_offer_atomic(text, text) from public, anon, authenticated;
revoke all on function public.buy_market_offer_atomic(text, text) from public, anon, authenticated;
grant execute on function public.create_market_offer_atomic(text, text, jsonb, bigint, text, text) to service_role;
grant execute on function public.cancel_market_offer_atomic(text, text) to service_role;
grant execute on function public.buy_market_offer_atomic(text, text) to service_role;
