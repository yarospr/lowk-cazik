import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();
const jsonHeaders = { 'Content-Type': 'application/json' };

const getCorsHeaders = (request: Request) => {
  const configuredOrigin = Deno.env.get('APP_ORIGIN') || '*';
  const requestOrigin = request.headers.get('origin') || '';
  const allowedOrigin = configuredOrigin === '*' || requestOrigin === configuredOrigin ? configuredOrigin : 'null';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};

const respond = (request: Request, status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...jsonHeaders, ...getCorsHeaders(request) },
});

const bytesToHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes))
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

const signHmac = async (key: ArrayBuffer | Uint8Array, value: string) => {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
};

const secureEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

const validateInitData = async (initData: string): Promise<TelegramUser> => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash') || '';
  if (!receivedHash) throw new Error('Telegram hash is missing');
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await signHmac(encoder.encode('WebAppData'), botToken);
  const expectedHash = bytesToHex(await signHmac(secretKey, dataCheckString));
  if (!secureEqual(expectedHash, receivedHash)) throw new Error('Telegram signature is invalid');

  const authDate = Number(params.get('auth_date') || 0);
  const maxAgeSeconds = Number(Deno.env.get('TELEGRAM_AUTH_MAX_AGE') || 86400);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('Telegram authorization data is expired');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Telegram user is missing');
  const user = JSON.parse(rawUser) as TelegramUser;
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Telegram user id is invalid');
  return user;
};

const getSecretKey = () => {
  return Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(request) });
  if (request.method !== 'POST') return respond(request, 405, { error: 'Method not allowed' });

  try {
    const { action, payload = {}, initData = '' } = await request.json();
    const user = await validateInitData(String(initData));
    const telegramId = String(user.id);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const secretKey = getSecretKey();
    if (!supabaseUrl || !secretKey) throw new Error('Supabase server credentials are not configured');
    const db = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

    if (action === 'bootstrap') {
      const { data: existing, error: selectError } = await db.from('players').select('*').eq('telegram_id', telegramId).maybeSingle();
      if (selectError) throw selectError;
      if (!existing) {
        const defaultBalance = Math.max(0, Math.floor(Number(Deno.env.get('DEFAULT_BALANCE') || 0)));
        const { data: created, error } = await db.from('players').insert({
          telegram_id: telegramId,
          username: user.username || null,
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          display_name: '',
          is_public: true,
          show_profile_link: true,
          balance: defaultBalance,
          inventory_json: [],
        }).select('*').single();
        if (error) throw error;
        return respond(request, 200, { data: { player: created } });
      }
      const { data: updated, error } = await db.from('players').update({
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
      }).eq('telegram_id', telegramId).select('*').single();
      if (error) throw error;
      return respond(request, 200, { data: { player: updated } });
    }

    if (action === 'sync_player') {
      const allowed = ['balance', 'inventory_json', 'stats_cases_opened', 'stats_total_spent', 'stats_total_won'];
      const patch = Object.fromEntries(allowed.filter(key => key in payload).map(key => [key, payload[key]]));
      const { data, error } = await db.from('players').update(patch).eq('telegram_id', telegramId).select('*').single();
      if (error) throw error;
      return respond(request, 200, { data: { player: data } });
    }

    if (action === 'update_profile') {
      const patch = {
        display_name: String(payload.display_name || '').trim().slice(0, 40),
        is_public: Boolean(payload.is_public),
        show_profile_link: Boolean(payload.show_profile_link),
      };
      if (!patch.display_name) throw new Error('Display name is required');
      const { data, error } = await db.from('players').update(patch).eq('telegram_id', telegramId).select('*').single();
      if (error) throw error;
      return respond(request, 200, { data: { player: data } });
    }

    if (action === 'leaderboard') {
      const fields = 'telegram_id, username, first_name, display_name, is_public, show_profile_link, balance, stats_cases_opened, stats_total_spent, stats_total_won';
      const { data, error } = await db.from('players').select(fields).eq('is_public', true).order('balance', { ascending: false }).limit(10);
      if (error) throw error;
      return respond(request, 200, { data: { players: data } });
    }

    if (action === 'get_player') {
      const requestedId = String(payload.telegram_id || '');
      const { data, error } = await db.from('players').select('*').eq('telegram_id', requestedId).maybeSingle();
      if (error) throw error;
      const visible = data && (data.is_public || requestedId === telegramId) ? data : null;
      return respond(request, 200, { data: { player: visible } });
    }

    if (action === 'list_market') {
      const ownOffers = payload.view === 'MY_OFFERS';
      let query = db.from('market_offers').select('*').eq('status', 'ACTIVE');
      query = ownOffers
        ? query.eq('seller_telegram_id', telegramId)
        : query.eq('visibility', 'PUBLIC').neq('seller_telegram_id', telegramId);
      const { data: offers, error } = await query.order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      const sellerIds = Array.from(new Set((offers || []).map(row => row.seller_telegram_id)));
      const { data: sellers, error: sellerError } = sellerIds.length
        ? await db.from('players').select('telegram_id, username, first_name, display_name, is_public, show_profile_link').in('telegram_id', sellerIds)
        : { data: [], error: null };
      if (sellerError) throw sellerError;
      return respond(request, 200, { data: { offers, sellers } });
    }

    if (action === 'get_offer') {
      const offerId = String(payload.offer_id || '');
      const { data: offer, error } = await db.from('market_offers').select('*').eq('offer_id', offerId).maybeSingle();
      if (error) throw error;
      let seller = null;
      if (offer) {
        const result = await db.from('players').select('telegram_id, username, first_name, display_name, is_public, show_profile_link').eq('telegram_id', offer.seller_telegram_id).maybeSingle();
        if (result.error) throw result.error;
        seller = result.data;
      }
      return respond(request, 200, { data: { offer, seller } });
    }

    if (action === 'create_offer') {
      const { data, error } = await db.rpc('create_market_offer_atomic', {
        p_seller_telegram_id: telegramId,
        p_offer_id: String(payload.offer_id || ''),
        p_item_json: payload.item_json,
        p_price: Math.max(0, Math.floor(Number(payload.price) || 0)),
        p_description: String(payload.description || '').trim().slice(0, 280),
        p_visibility: payload.visibility === 'LINK_ONLY' ? 'LINK_ONLY' : 'PUBLIC',
      });
      if (error) throw error;
      return respond(request, 200, { data: { offer: data } });
    }

    if (action === 'cancel_offer') {
      const { data, error } = await db.rpc('cancel_market_offer_atomic', {
        p_seller_telegram_id: telegramId,
        p_offer_id: String(payload.offer_id || ''),
      });
      if (error) throw error;
      return respond(request, 200, { data });
    }

    if (action === 'buy_offer') {
      const { data, error } = await db.rpc('buy_market_offer_atomic', {
        p_buyer_telegram_id: telegramId,
        p_offer_id: String(payload.offer_id || ''),
      });
      if (error) throw error;
      return respond(request, 200, { data });
    }

    return respond(request, 400, { error: 'Unknown action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const unauthorized = /Telegram|authorization/i.test(message);
    return respond(request, unauthorized ? 401 : 400, { error: message });
  }
});
