import { createLocalDatabaseClient } from './localDatabase';

type DatabaseRow = Record<string, any>;
type MarketView = 'MARKET' | 'MY_OFFERS';

const defaultSupabaseUrl = 'https://wucaqpwdfdmasuherfhx.supabase.co';
const supabaseUrl = String((import.meta as any).env?.VITE_SUPABASE_URL || defaultSupabaseUrl).trim().replace(/\/$/, '');
const forceLocalDatabase = String((import.meta as any).env?.VITE_FORCE_LOCAL_DB || '') === '1';
const hasSupabaseUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl);
const localDatabase = createLocalDatabaseClient();

export const isOnlineDatabaseConfigured = hasSupabaseUrl && !forceLocalDatabase;

const getTelegramInitData = () => String(window.Telegram?.WebApp?.initData || '').trim();
const shouldUseOnlineDatabase = () => isOnlineDatabaseConfigured && Boolean(getTelegramInitData());

const invoke = async <T>(action: string, payload: DatabaseRow = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/game-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, initData: getTelegramInitData() }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Game API error (${response.status})`);
    return body.data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Сервер игры не ответил вовремя');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const getLocalPlayer = async (telegramId: string) => {
  const { data, error } = await localDatabase
    .from('players')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as DatabaseRow | null;
};

export const gameDatabase = {
  isOnline: shouldUseOnlineDatabase,

  async getOrCreatePlayer(telegramId: string, initial: DatabaseRow) {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ player: DatabaseRow }>('bootstrap');
      return result.player;
    }

    const existing = await getLocalPlayer(telegramId);
    if (existing) return existing;

    const { data, error } = await localDatabase
      .from('players')
      .insert({ ...initial, telegram_id: telegramId })
      .select('*')
      .single();
    if (!error) return data as DatabaseRow;
    if (error.code === '23505') {
      const raced = await getLocalPlayer(telegramId);
      if (raced) return raced;
    }
    throw new Error(error.message);
  },

  async syncPlayer(telegramId: string, patch: DatabaseRow) {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ player: DatabaseRow }>('sync_player', patch);
      return result.player;
    }
    const { data, error } = await localDatabase
      .from('players')
      .update(patch)
      .eq('telegram_id', telegramId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as DatabaseRow | null;
  },

  async updateProfile(telegramId: string, patch: DatabaseRow) {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ player: DatabaseRow }>('update_profile', patch);
      return result.player;
    }
    return this.syncPlayer(telegramId, patch);
  },

  async openCases(caseKey: string, quantity: number, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { drops: DatabaseRow[]; cost: number } }>('open_cases', {
      case_key: caseKey,
      quantity,
      idempotency_key: idempotencyKey,
    });
  },

  async sellItems(itemIds: string[], idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { sold_item_ids: string[]; value: number } }>('sell_items', {
      item_ids: itemIds,
      idempotency_key: idempotencyKey,
    });
  },

  async sellAllItems(idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { sold_count: number; value: number } }>('sell_all_items', {
      idempotency_key: idempotencyKey,
    });
  },

  async spinSlots(bet: number, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { variants: DatabaseRow[]; result_indices: number[]; winner_index: number; won_item: DatabaseRow | null } }>('slots_spin', {
      bet,
      idempotency_key: idempotencyKey,
    });
  },

  async playUpgrader(inputItemId: string, targetItemId: number, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { won: boolean; chance: number; won_item: DatabaseRow | null } }>('upgrader_play', {
      input_item_id: inputItemId,
      target_item_id: targetItemId,
      idempotency_key: idempotencyKey,
    });
  },

  async startRocket(itemId: string, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { session_id: string; crash_multiplier: number; started_at: string } }>('rocket_start', {
      item_id: itemId,
      idempotency_key: idempotencyKey,
    });
  },

  async cashoutRocket(sessionId: string, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { cashed_out: boolean; crashed: boolean; multiplier: number; won_item?: DatabaseRow } }>('rocket_cashout', {
      session_id: sessionId,
      idempotency_key: idempotencyKey,
    });
  },

  async getBusinessState() {
    return invoke<{ session: DatabaseRow | null }>('business_state');
  },

  async startBusiness(investment: number, idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { session: DatabaseRow } }>('business_start', {
      investment,
      idempotency_key: idempotencyKey,
    });
  },

  async claimBusinessReward(idempotencyKey: string) {
    return invoke<{ player: DatabaseRow; result: { session: DatabaseRow } }>('business_claim', {
      idempotency_key: idempotencyKey,
    });
  },

  async getLeaderboard() {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ players: DatabaseRow[] }>('leaderboard');
      return result.players;
    }
    const { data, error } = await localDatabase
      .from('players')
      .select('*')
      .eq('is_public', true)
      .order('balance', { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return data as DatabaseRow[];
  },

  async getPlayer(telegramId: string) {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ player: DatabaseRow | null }>('get_player', { telegram_id: telegramId });
      return result.player;
    }
    return getLocalPlayer(telegramId);
  },

  async listMarketOffers(view: MarketView, currentPlayerId: string, searchQuery = '') {
    const normalizedLotCode = String(searchQuery || '').trim().toUpperCase();
    const exactLotCode = /^LOT-[A-Z0-9]{8}$/.test(normalizedLotCode) ? normalizedLotCode : '';
    if (shouldUseOnlineDatabase()) {
      return invoke<{ offers: DatabaseRow[]; sellers: DatabaseRow[] }>('list_market', { view, query: exactLotCode });
    }

    let query = localDatabase.from('market_offers').select('*').eq('status', 'ACTIVE');
    if (exactLotCode) {
      query = query.eq('lot_code', exactLotCode);
    } else if (view === 'MY_OFFERS') {
      query = query.eq('seller_telegram_id', currentPlayerId);
    } else {
      query = query.eq('visibility', 'PUBLIC');
      if (currentPlayerId) query = query.neq('seller_telegram_id', currentPlayerId);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);

    const offers = data as DatabaseRow[];
    const sellerIds = Array.from(new Set(offers.map(row => String(row.seller_telegram_id || '')).filter(Boolean)));
    if (sellerIds.length === 0) return { offers, sellers: [] };

    const sellerResult = await localDatabase
      .from('players')
      .select('telegram_id, username, first_name, display_name, is_public, show_profile_link')
      .in('telegram_id', sellerIds);
    if (sellerResult.error) throw new Error(sellerResult.error.message);
    return { offers, sellers: sellerResult.data as DatabaseRow[] };
  },

  async getMarketOffer(offerId: string) {
    if (shouldUseOnlineDatabase()) {
      return invoke<{ offer: DatabaseRow | null; seller: DatabaseRow | null }>('get_offer', { offer_id: offerId });
    }

    const { data: offer, error } = await localDatabase
      .from('market_offers')
      .select('*')
      .eq('offer_id', offerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!offer) return { offer: null, seller: null };
    const seller = await getLocalPlayer(String(offer.seller_telegram_id || ''));
    return { offer: offer as DatabaseRow, seller };
  },

  async createMarketOffer(payload: DatabaseRow) {
    if (shouldUseOnlineDatabase()) {
      const result = await invoke<{ offer: DatabaseRow }>('create_offer', payload);
      return result.offer;
    }
    const { data, error } = await localDatabase.from('market_offers').insert(payload).select('*').single();
    if (error) throw new Error(error.message);
    return data as DatabaseRow;
  },

  async cancelMarketOffer(offerId: string, sellerTelegramId: string) {
    if (shouldUseOnlineDatabase()) {
      return invoke<{ offer: DatabaseRow; player: DatabaseRow }>('cancel_offer', { offer_id: offerId });
    }
    const { data: offer, error } = await localDatabase
      .from('market_offers')
      .update({ status: 'CANCELLED' })
      .eq('offer_id', offerId)
      .eq('seller_telegram_id', sellerTelegramId)
      .eq('status', 'ACTIVE')
      .select('*')
      .maybeSingle();
    if (error || !offer) throw new Error(error?.message || 'Товар уже недоступен');
    return { offer: offer as DatabaseRow, player: await getLocalPlayer(sellerTelegramId) as DatabaseRow };
  },

  async buyMarketOffer(offerId: string, buyerTelegramId: string) {
    if (shouldUseOnlineDatabase()) {
      return invoke<{ offer: DatabaseRow; buyer: DatabaseRow }>('buy_offer', { offer_id: offerId });
    }

    const { offer } = await this.getMarketOffer(offerId);
    if (!offer || offer.status !== 'ACTIVE') throw new Error('Товар уже недоступен');
    if (offer.seller_telegram_id === buyerTelegramId) throw new Error('Нельзя купить собственный товар');

    const buyer = await getLocalPlayer(buyerTelegramId);
    const seller = await getLocalPlayer(String(offer.seller_telegram_id));
    if (!buyer || !seller) throw new Error('Профиль участника не найден');
    const price = Math.max(0, Math.floor(Number(offer.price) || 0));
    if (Number(buyer.balance) < price) throw new Error('Недостаточно звезд');

    const soldAt = new Date().toISOString();
    const buyerInventory = Array.isArray(buyer.inventory_json) ? buyer.inventory_json : [];
    const buyerPatch = {
      balance: Number(buyer.balance) - price,
      inventory_json: [offer.item_json, ...buyerInventory],
      stats_total_spent: Number(buyer.stats_total_spent || 0) + price,
    };
    const sellerPatch = {
      balance: Number(seller.balance) + price,
      stats_total_won: Number(seller.stats_total_won || 0) + price,
    };

    await localDatabase.from('market_offers').update({ status: 'SOLD', buyer_telegram_id: buyerTelegramId, sold_at: soldAt }).eq('offer_id', offerId);
    const buyerResult = await localDatabase.from('players').update(buyerPatch).eq('telegram_id', buyerTelegramId).select('*').single();
    const sellerResult = await localDatabase.from('players').update(sellerPatch).eq('telegram_id', offer.seller_telegram_id).select('*').single();
    if (buyerResult.error || sellerResult.error) throw new Error('Не удалось завершить покупку');

    return {
      offer: { ...offer, status: 'SOLD', buyer_telegram_id: buyerTelegramId, sold_at: soldAt },
      buyer: buyerResult.data as DatabaseRow,
      seller: sellerResult.data as DatabaseRow,
    };
  },
};
