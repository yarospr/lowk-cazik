
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Star, ArrowLeft, User, Box, Check, Gamepad2, Trophy, Banknote, Trash2, AlertTriangle, Rocket, Play, StopCircle, Info, Zap, ArrowUp, Coins, Settings, Loader2, ExternalLink, Link2, RefreshCw, Search, Store, Clock3, EyeOff, SkipForward, PackageOpen, Tag, X, Globe2, ChevronDown, ChevronLeft, ChevronRight, Gem, Copy, Ban, CircleDotDashed } from 'lucide-react';
import { BaseItem, Case, CaseItemDrop, InventoryItem, AppScreen, PlayerProfile } from './types';
import { ITEMS_DATA, CASES_DATA, INITIAL_BALANCE } from './constants';
import { gameDatabase } from './gameDatabase';

// --- UTILS ---
const TELEGRAM_BOT_USERNAME = (((import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME as string) || 'lowkcazikbot').trim().replace(/^@/, '');
const TELEGRAM_APP_SHORT_NAME = (((import.meta as any).env?.VITE_TELEGRAM_APP_SHORT_NAME as string) || '').trim().replace(/^\//, '');
const OFFER_ID_PREFIX = 'offer_';
const LOT_CODE_PATTERN = /^LOT-[A-Z0-9]{8}$/;
const ALL_ITEMS = ITEMS_DATA["items_db"];
const ITEM_BY_ID = new Map<number, BaseItem>(ALL_ITEMS.map(item => [item.id, item]));
const IGNORED_NUMERIC_KEYS = new Set(['id', 'serial', 'obtainedAt', 'chance_percent', 'chance', 'payout']);
const ITEM_NAME_KEY = '\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435';
const ITEM_PRICE_KEY = '\u0446\u0435\u043d\u0430';
const ITEM_RARITY_KEY = '\u0440\u0435\u0434\u043a\u043e\u0441\u0442\u044c';
const BUSINESS_TICK_MS = 60_000;
const MIN_PLINKO_BET = 100;
const MAX_PLINKO_BET = 100_000_000;
const MAX_PLINKO_BALLS = 20;
const MAX_INVENTORY_ITEMS = 5000;
const GAME_RTP = 1.01;
const BUSINESS_RTP = 1.07;
const MIN_BUSINESS_INVESTMENT = 300;
const INVENTORY_LIMIT_MESSAGE = '\u041d\u0435\u043b\u044c\u0437\u044f \u0438\u043c\u0435\u0442\u044c \u0431\u043e\u043b\u0435\u0435 5 000 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u043e\u0432';
const getBundledItemImageUrl = (itemId: number): string => {
  return Number.isInteger(itemId) && itemId > 0
    ? `./assets/items/icons/${itemId}.png`
    : '';
};

type BusinessRewardNotice = {
  item: InventoryItem;
  percent: number;
  targetPrice: number;
  createdAt: number;
};

type BusinessState = {
  active: boolean;
  investment: number;
  targetTotal: number;
  earnedTotal: number;
  nextDropAt: number | null;
  pendingReward: BusinessRewardNotice | null;
  completedAt: number | null;
  rewardsCount: number;
};

const EMPTY_BUSINESS_STATE: BusinessState = {
  active: false,
  investment: 0,
  targetTotal: 0,
  earnedTotal: 0,
  nextDropAt: null,
  pendingReward: null,
  completedAt: null,
  rewardsCount: 0,
};

type CaseSampler = {
  cumulative: number[];
  drops: CaseItemDrop[];
  total: number;
};

const CASE_SAMPLER_CACHE = new Map<string, CaseSampler>();

const getItemById = (id: number): BaseItem | undefined => {
  return ITEM_BY_ID.get(id);
};

const getCaseSampler = (c: Case): CaseSampler => {
  const cached = CASE_SAMPLER_CACHE.get(c.key);
  if (cached && cached.drops.length === c.items.length) {
    return cached;
  }

  const cumulative: number[] = [];
  let total = 0;
  for (const drop of c.items) {
    total += drop.chance_percent;
    cumulative.push(total);
  }

  const sampler: CaseSampler = {
    cumulative,
    drops: c.items,
    total: total > 0 ? total : 100,
  };
  CASE_SAMPLER_CACHE.set(c.key, sampler);
  return sampler;
};

const getRarityColor = (rarity: string) => {
  switch (rarity) {
    case 'обычный': return 'text-blue-200 border-blue-500 shadow-blue-500/20';
    case 'редкий': return 'text-green-200 border-green-500 shadow-green-500/20';
    case 'эпический': return 'text-purple-200 border-purple-500 shadow-purple-500/20';
    case 'мифический': return 'text-red-200 border-red-500 shadow-red-500/20';
    case 'легендарный': return 'text-yellow-200 border-yellow-500 shadow-yellow-500/20';
    default: return 'text-white border-gray-600';
  }
};

const getRouletteCardStyle = (rarity: string) => {
  switch (rarity) {
    case 'обычный': return 'bg-blue-600 border-blue-400 text-white';
    case 'редкий': return 'bg-green-600 border-green-400 text-white';
    case 'эпический': return 'bg-purple-600 border-purple-400 text-white';
    case 'мифический': return 'bg-red-600 border-red-400 text-white';
    case 'легендарный': return 'bg-yellow-500 border-yellow-200 text-black';
    default: return 'bg-slate-800 border-slate-600 text-white';
  }
};

const getRarityGlow = (rarity: string) => {
  switch (rarity) {
    case 'обычный': return 'shadow-blue-500/40';
    case 'редкий': return 'shadow-green-500/40';
    case 'эпический': return 'shadow-purple-500/40';
    case 'мифический': return 'shadow-red-500/40';
    case 'легендарный': return 'shadow-yellow-500/40';
    default: return 'shadow-none';
  }
}

const getItemImageUrl = (item: BaseItem): string => {
  const record = item as unknown as Record<string, unknown>;
  const candidates = [record.image_url, record.image, record.img, getBundledItemImageUrl(item.id)];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const resolved = new URL(value.trim(), window.location.href);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') return resolved.toString();
    } catch {
      // Ignore malformed image sources and keep the emoji fallback.
    }
  }
  return '';
};

type TrashCaseLimitState = {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: number;
};

const getNextHourTimestamp = (now = Date.now()) => {
  const next = new Date(now);
  next.setMinutes(60, 0, 0);
  return next.getTime();
};

const formatLimitCountdown = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const ItemArtwork = React.memo(({
  item,
  className = '',
  imageClassName = '',
  eager = false,
  style,
}: {
  item: BaseItem;
  className?: string;
  imageClassName?: string;
  eager?: boolean;
  style?: React.CSSProperties;
}) => {
  const imageUrl = getItemImageUrl(item);
  const [failedUrl, setFailedUrl] = useState('');
  const showImage = Boolean(imageUrl && imageUrl !== failedUrl);
  return (
    <div className={`flex items-center justify-center overflow-hidden ${className}`} style={style}>
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(imageUrl)}
          className={`w-full h-full object-contain select-none ${imageClassName}`}
        />
      ) : (
        <span aria-hidden="true">{item.emg}</span>
      )}
    </div>
  );
});

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('ru-RU').format(Math.floor(amount));
};
const toSafeNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sanitizePositiveIntegerInput = (raw: string): string => {
  const digitsOnly = raw.replace(/\D+/g, '');
  if (!digitsOnly) return '';
  const withoutLeadingZeros = digitsOnly.replace(/^0+/, '');
  const normalized = withoutLeadingZeros || '0';
  return normalized.slice(0, 12);
};

const getItemName = (item: Partial<BaseItem> | InventoryItem): string => {
  const value = (item as Record<string, unknown>)[ITEM_NAME_KEY];
  return typeof value === 'string' ? value : '';
};

const getItemRarity = (item: Partial<BaseItem> | InventoryItem): string => {
  const value = (item as Record<string, unknown>)[ITEM_RARITY_KEY];
  return typeof value === 'string' ? value : '';
};

const getItemPrice = (item: Partial<BaseItem> | InventoryItem | null | undefined): number => {
  if (!item) return 0;
  const record = item as Record<string, unknown>;
  const directPrice = toSafeNumber(record.price ?? record[ITEM_PRICE_KEY]);
  if (directPrice > 0) return directPrice;
  for (const [key, value] of Object.entries(record)) {
    if (IGNORED_NUMERIC_KEYS.has(key)) continue;
    const parsed = toSafeNumber(value);
    if (parsed > 0) return parsed;
  }
  return 0;
};
const sumItemPrices = (items: Array<Partial<BaseItem> | InventoryItem>): number => {
  return items.reduce((acc, item) => acc + getItemPrice(item), 0);
};

const generateUUID = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const generateSerial = () => {
  return Math.floor(Math.random() * 10000) + 1;
};

const formatSecondsLeft = (secondsLeft: number): string => {
  const safe = Math.max(0, secondsLeft);
  const mm = Math.floor(safe / 60).toString().padStart(2, '0');
  const ss = (safe % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

const getBusinessStorageKey = (playerId: string): string => {
  return `ccc_business_state_${playerId}`;
};

const normalizeBusinessState = (raw: unknown): BusinessState => {
  if (!raw || typeof raw !== 'object') return EMPTY_BUSINESS_STATE;
  const rec = raw as Record<string, unknown>;
  const pendingRaw = rec.pendingReward;
  let pendingReward: BusinessRewardNotice | null = null;
  if (pendingRaw && typeof pendingRaw === 'object') {
    const pendingRec = pendingRaw as Record<string, unknown>;
    const itemRaw = pendingRec.item;
    if (itemRaw && typeof itemRaw === 'object') {
      pendingReward = {
        item: itemRaw as InventoryItem,
        percent: Math.max(1, Math.min(20, Math.floor(toSafeNumber(pendingRec.percent) || 1))),
        targetPrice: Math.max(0, toSafeNumber(pendingRec.targetPrice)),
        createdAt: toSafeNumber(pendingRec.createdAt) || Date.now(),
      };
    }
  }

  const active = Boolean(rec.active);
  const investment = Math.max(0, Math.floor(toSafeNumber(rec.investment)));
  const targetTotal = Math.max(0, toSafeNumber(rec.targetTotal));
  const earnedTotal = Math.max(0, toSafeNumber(rec.earnedTotal));
  const nextDropAtRaw = toSafeNumber(rec.nextDropAt);
  const completedAtRaw = toSafeNumber(rec.completedAt);
  const rewardsCount = Math.max(0, Math.floor(toSafeNumber(rec.rewardsCount)));

  return {
    active,
    investment,
    targetTotal,
    earnedTotal,
    nextDropAt: nextDropAtRaw > 0 ? nextDropAtRaw : null,
    pendingReward,
    completedAt: completedAtRaw > 0 ? completedAtRaw : null,
    rewardsCount,
  };
};

const findItemAtOrBelowPrice = (targetPrice: number): BaseItem => {
  const eligible = ALL_ITEMS
    .filter(item => getItemPrice(item) <= targetPrice)
    .sort((left, right) => getItemPrice(right) - getItemPrice(left));
  return eligible[0] || ALL_ITEMS.reduce((cheapest, item) =>
    getItemPrice(item) < getItemPrice(cheapest) ? item : cheapest
  );
};

const createBusinessReward = (investment: number, remainingValue: number, obtainedAt: number): BusinessRewardNotice => {
  const percent = Math.floor(Math.random() * 20) + 1;
  const targetPrice = Math.min(Math.max(1, remainingValue), Math.max(1, Math.floor((investment * percent) / 100)));
  const closest = findItemAtOrBelowPrice(targetPrice);

  const item: InventoryItem = {
    ...closest,
    uniqueId: generateUUID(),
    serial: generateSerial(),
    obtainedAt,
  };

  return {
    item,
    percent,
    targetPrice,
    createdAt: obtainedAt,
  };
};

const simulateBusinessCatchup = (state: BusinessState, now: number): { nextState: BusinessState; rewards: BusinessRewardNotice[] } => {
  if (!state.active || state.pendingReward || state.nextDropAt === null || state.nextDropAt > now) {
    return { nextState: state, rewards: [] };
  }

  const reward = createBusinessReward(state.investment, state.targetTotal - state.earnedTotal, state.nextDropAt);
  const rewardPrice = getItemPrice(reward.item);
  const earnedTotal = state.earnedTotal + rewardPrice;

  return {
    nextState: {
      ...state,
      earnedTotal,
      rewardsCount: state.rewardsCount + 1,
      active: true,
      pendingReward: reward,
      completedAt: null,
      nextDropAt: null,
    },
    rewards: [],
  };
};

const mapServerBusinessState = (raw: Record<string, unknown> | null): BusinessState => {
  if (!raw) return EMPTY_BUSINESS_STATE;
  const pendingItem = raw.pending_item && typeof raw.pending_item === 'object'
    ? raw.pending_item as InventoryItem
    : null;
  const nextDropAt = raw.next_drop_at ? new Date(String(raw.next_drop_at)).getTime() : null;
  const completedAt = raw.completed_at ? new Date(String(raw.completed_at)).getTime() : null;
  return {
    active: Boolean(raw.active),
    investment: Math.max(0, Math.floor(toSafeNumber(raw.investment))),
    targetTotal: Math.max(0, Math.floor(toSafeNumber(raw.target_total))),
    earnedTotal: Math.max(0, Math.floor(toSafeNumber(raw.earned_total))),
    nextDropAt: nextDropAt && Number.isFinite(nextDropAt) ? nextDropAt : null,
    pendingReward: pendingItem ? {
      item: pendingItem,
      percent: 0,
      targetPrice: Math.max(0, Math.floor(toSafeNumber(raw.pending_value))),
      createdAt: Date.now(),
    } : null,
    completedAt: completedAt && Number.isFinite(completedAt) ? completedAt : null,
    rewardsCount: Math.max(0, Math.floor(toSafeNumber(raw.rewards_count))),
  };
};

const getRandomItemFromCase = (c: Case): CaseItemDrop => {
  const sampler = getCaseSampler(c);
  const target = Math.random() * sampler.total;

  let low = 0;
  let high = sampler.cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (target <= sampler.cumulative[mid]) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return sampler.drops[low] ?? sampler.drops[sampler.drops.length - 1];
};

const findClosestItemByPrice = (targetPrice: number): BaseItem => {
  if (!ALL_ITEMS || ALL_ITEMS.length === 0) throw new Error("No items DB");
  
  return ALL_ITEMS.reduce((prev, curr) => {
    return (Math.abs(getItemPrice(curr) - targetPrice) < Math.abs(getItemPrice(prev) - targetPrice) ? curr : prev);
  });
};

const getRandomItemNearPrice = (targetPrice: number): BaseItem => {
  // Range: 0.7x to 1.3x price
  const candidates = ALL_ITEMS.filter(i => getItemPrice(i) >= targetPrice * 0.7 && getItemPrice(i) <= targetPrice * 1.3);
  
  if (candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
  }
  return findClosestItemByPrice(targetPrice);
}

const buildLocalPlinkoPrizes = (bet: number): BaseItem[] => {
  const weights = [1, 8, 28, 56, 70, 56, 28, 8, 1];
  const prizes = [6, 2.5, 1.3, 0.95, 0.391, 0.95, 1.3, 2.5, 6]
    .map(multiplier => findClosestItemByPrice(bet * multiplier));
  const targetWeightedValue = bet * GAME_RTP * 256;
  for (let pass = 0; pass < 4; pass += 1) {
    for (const index of [4, 3, 5, 2, 6, 1, 7, 0, 8]) {
      const withoutCurrent = prizes.reduce((sum, item, prizeIndex) =>
        prizeIndex === index ? sum : sum + getItemPrice(item) * weights[prizeIndex], 0);
      prizes[index] = findClosestItemByPrice(Math.max(1, (targetWeightedValue - withoutCurrent) / weights[index]));
    }
  }
  return prizes;
};

const casesByType = CASES_DATA.reduce((acc, c) => {
  if (!acc[c.type]) acc[c.type] = [];
  acc[c.type].push(c);
  return acc;
}, {} as Record<string, Case[]>);

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramChat = {
  username?: string;
};

type TelegramWebAppState = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramUser;
    chat?: TelegramChat;
    start_param?: string;
  };
  ready?: () => void;
  expand?: () => void;
  isFullscreen?: boolean;
  requestFullscreen?: () => void;
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openTelegramLink?: (url: string) => void;
};

type PlayerDbRow = {
  telegram_id?: string;
  username?: string | null;
  first_name?: string | null;
  balance?: number | null;
  inventory_json?: InventoryItem[] | string | null;
  display_name?: string | null;
  is_public?: boolean | null;
  show_profile_link?: boolean | null;
  stats_cases_opened?: number | null;
  stats_total_spent?: number | null;
  stats_total_won?: number | null;
};

type OfferVisibility = 'PUBLIC' | 'LINK_ONLY';
type OfferStatus = 'ACTIVE' | 'SOLD' | 'CANCELLED';
type MarketViewTab = 'MARKET' | 'MY_OFFERS';
type MarketSort = 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC' | 'RARITY_DESC';
type StatsDelta = {
  casesOpened?: number;
  spent?: number;
  won?: number;
};

type MarketOfferDbRow = {
  offer_id?: string;
  lot_code?: string;
  seller_telegram_id?: string;
  buyer_telegram_id?: string | null;
  item_json?: InventoryItem | string | null;
  price?: number | null;
  description?: string | null;
  visibility?: OfferVisibility | string | null;
  status?: OfferStatus | string | null;
  created_at?: string | null;
  sold_at?: string | null;
};

type MarketOffer = {
  offer_id: string;
  lot_code: string;
  seller_telegram_id: string;
  buyer_telegram_id?: string;
  item: InventoryItem;
  price: number;
  description: string;
  visibility: OfferVisibility;
  status: OfferStatus;
  created_at: string;
  sold_at?: string;
  seller_name: string;
  seller_username?: string;
  seller_show_profile_link: boolean;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppState;
    };
  }
}

const LOCAL_PLAYER_ID_KEY = 'ccc_player_uuid';

const normalizeOfferId = (raw: unknown): string | null => {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.startsWith(OFFER_ID_PREFIX) ? value : null;
};

const encodeOfferStartParam = (offerId: string): string => {
  if (!offerId.startsWith(OFFER_ID_PREFIX)) return offerId;
  return `o_${offerId.slice(OFFER_ID_PREFIX.length)}`;
};

const parseOfferStartParam = (raw: unknown): string | null => {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith(OFFER_ID_PREFIX)) return value;
  if (value.startsWith('o_')) return `${OFFER_ID_PREFIX}${value.slice(2)}`;
  return null;
};

const normalizeLotCode = (raw: unknown): string | null => {
  const value = String(raw || '').trim().toUpperCase();
  return LOT_CODE_PATTERN.test(value) ? value : null;
};

const generateLotCode = (): string => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `LOT-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

const getPermanentItemId = (item: InventoryItem): string => `#${Math.max(1, item.serial).toString().padStart(4, '0')}`;

const MARKET_SORT_OPTIONS: Array<{ value: MarketSort; label: string }> = [
  { value: 'NEWEST', label: 'Новые' },
  { value: 'PRICE_ASC', label: 'Дешевле' },
  { value: 'PRICE_DESC', label: 'Дороже' },
  { value: 'RARITY_DESC', label: 'Редкие' },
];

const RARITY_RANK: Record<string, number> = {
  'обычный': 1,
  'редкий': 2,
  'эпический': 3,
  'мифический': 4,
  'легендарный': 5,
};

const buildTelegramMiniAppUrl = (startParam: string) => {
  if (!TELEGRAM_BOT_USERNAME) return '';
  const appPath = TELEGRAM_APP_SHORT_NAME ? `/${TELEGRAM_APP_SHORT_NAME}` : '';
  return `https://t.me/${TELEGRAM_BOT_USERNAME}${appPath}?startapp=${encodeURIComponent(startParam)}`;
};

const getOrCreateLocalPlayerId = (): string => {
  const existing = localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;

  const generated = `local_${generateUUID()}`;
  localStorage.setItem(LOCAL_PLAYER_ID_KEY, generated);
  return generated;
};

const parseDbInventory = (raw: PlayerDbRow['inventory_json']): InventoryItem[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseOfferItem = (raw: MarketOfferDbRow['item_json']): InventoryItem | null => {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  const itemId = Math.floor(toSafeNumber(record.id));
  const baseItem = itemId > 0 ? getItemById(itemId) : undefined;
  if (!baseItem && itemId <= 0) return null;

  return {
    ...(baseItem ?? ({} as BaseItem)),
    ...(record as unknown as InventoryItem),
    uniqueId: typeof record.uniqueId === 'string' && record.uniqueId ? record.uniqueId : generateUUID(),
    serial: Math.max(1, Math.floor(toSafeNumber(record.serial) || generateSerial())),
    obtainedAt: Math.max(1, Math.floor(toSafeNumber(record.obtainedAt) || Date.now())),
  } as InventoryItem;
};

const normalizeOfferVisibility = (raw: unknown): OfferVisibility => {
  return raw === 'LINK_ONLY' ? 'LINK_ONLY' : 'PUBLIC';
};

const normalizeOfferStatus = (raw: unknown): OfferStatus => {
  if (raw === 'SOLD') return 'SOLD';
  if (raw === 'CANCELLED') return 'CANCELLED';
  return 'ACTIVE';
};

const mapOfferRow = (
  row: MarketOfferDbRow,
  sellersById: Map<string, PlayerDbRow>
): MarketOffer | null => {
  const offer_id = typeof row.offer_id === 'string' ? row.offer_id : '';
  const seller_telegram_id = typeof row.seller_telegram_id === 'string' ? row.seller_telegram_id : '';
  if (!offer_id || !seller_telegram_id) return null;

  const item = parseOfferItem(row.item_json);
  if (!item) return null;

  const seller = sellersById.get(seller_telegram_id);
  const seller_name = seller?.display_name || seller?.first_name || seller?.username || 'Player';
  const seller_username = seller?.username || undefined;
  const seller_show_profile_link = Boolean(seller?.show_profile_link ?? seller?.is_public);

  return {
    offer_id,
    lot_code: normalizeLotCode(row.lot_code) || `LOT-${offer_id.replace(/[^a-z0-9]/gi, '').slice(-8).padStart(8, '0').toUpperCase()}`,
    seller_telegram_id,
    buyer_telegram_id: typeof row.buyer_telegram_id === 'string' ? row.buyer_telegram_id : undefined,
    item,
    price: Math.max(0, Math.floor(toSafeNumber(row.price))),
    description: String(row.description || ''),
    visibility: normalizeOfferVisibility(row.visibility),
    status: normalizeOfferStatus(row.status),
    created_at: String(row.created_at || ''),
    sold_at: typeof row.sold_at === 'string' ? row.sold_at : undefined,
    seller_name,
    seller_username,
    seller_show_profile_link,
  };
};

const mapDbRowToProfile = (row: PlayerDbRow): PlayerProfile => {
  const id = String(row.telegram_id || '');
  const resolvedName = row.display_name || row.first_name || row.username || '';
  const balance = Number.isFinite(Number(row.balance)) ? Number(row.balance) : INITIAL_BALANCE;

  return {
    id,
    name: resolvedName,
    balance,
    inventory: parseDbInventory(row.inventory_json),
    telegram_id: id,
    telegram_username: row.username || undefined,
    is_public: Boolean(row.is_public),
    show_profile_link: Boolean(row.show_profile_link ?? row.is_public),
    stats_cases_opened: Math.max(0, Math.floor(toSafeNumber(row.stats_cases_opened))),
    stats_total_spent: Math.max(0, Math.floor(toSafeNumber(row.stats_total_spent))),
    stats_total_won: Math.max(0, Math.floor(toSafeNumber(row.stats_total_won))),
  };
};

// --- COMPONENTS ---

const Button = ({ children, onClick, className = "", variant = "primary", disabled = false }: any) => {
  const baseStyle = "px-4 py-3 rounded-lg font-bold transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-wide text-sm";
  const variants: any = {
    primary: "bg-yellow-500 text-black hover:bg-yellow-400 shadow-lg shadow-yellow-500/20",
    secondary: "bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700",
    danger: "bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/30",
    success: "bg-green-600 text-white hover:bg-green-500 shadow-lg shadow-green-900/30",
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed grayscale' : ''} ${className}`}
    >
      {children}
    </button>
  );
};

const CaseIcon = ({ emoji, className = "text-6xl" }: { emoji: string, className?: string }) => (
  <div className={`relative flex items-center justify-center ${className}`}>
    <div className="absolute opacity-100 drop-shadow-lg text-[1.2em]">📦</div>
    <div className="absolute z-10 transform scale-75 translate-y-2 drop-shadow-md">{emoji}</div>
  </div>
);

const BalanceBadge = ({ balance }: { balance: number }) => (
  <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-full border border-slate-800 shadow-inner">
    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
    <span className="font-mono font-bold text-yellow-100 text-base">{formatMoney(balance)}</span>
  </div>
);

const BottomNav = ({ activeTab, onTabChange }: { activeTab: string, onTabChange: (tab: string) => void }) => {
  return (
    <div className="telegram-safe-bottom fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 pt-2 px-4 flex justify-around items-center z-50 max-w-md mx-auto">
      <button
        onClick={() => onTabChange('games')}
        aria-label="Игры"
        title="Игры"
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'games' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Gamepad2 className="w-6 h-6" />
      </button>
      <button
        onClick={() => onTabChange('leaderboard')}
        aria-label="Рейтинг"
        title="Рейтинг"
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'leaderboard' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Trophy className="w-6 h-6" />
      </button>
      <button
        onClick={() => onTabChange('profile')}
        aria-label="Профиль"
        title="Профиль"
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'profile' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <User className="w-6 h-6" />
      </button>
      <button
        onClick={() => onTabChange('market')}
        aria-label="Рынок"
        title="Рынок"
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'market' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Banknote className="w-6 h-6" />
      </button>

    </div>
  );
};

// --- ROULETTE COMPONENT ---

type RouletteStripEntry = {
  item: BaseItem;
  chance: number;
};

const getMarketRarityStyle = (rarity: string) => {
  switch (rarity) {
    case 'обычный': return { border: 'border-cyan-500/45', text: 'text-cyan-300', bg: 'bg-cyan-500/10' };
    case 'редкий': return { border: 'border-emerald-500/45', text: 'text-emerald-300', bg: 'bg-emerald-500/10' };
    case 'эпический': return { border: 'border-fuchsia-500/45', text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10' };
    case 'мифический': return { border: 'border-rose-500/45', text: 'text-rose-300', bg: 'bg-rose-500/10' };
    case 'легендарный': return { border: 'border-amber-400/55', text: 'text-amber-300', bg: 'bg-amber-400/10' };
    default: return { border: 'border-slate-700', text: 'text-slate-400', bg: 'bg-slate-800/60' };
  }
};

const formatMarketAge = (createdAt: string) => {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 1) return 'сейчас';
  if (elapsedMinutes < 60) return `${elapsedMinutes} мин`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
};

const buildRouletteStrip = (
  caseData: Case,
  winner: BaseItem,
  totalItems: number,
  winnerIndex: number,
): RouletteStripEntry[] => {
  const itemChanceMap = new Map<number, number>();
  for (const drop of caseData.items) {
    itemChanceMap.set(drop.id, drop.chance_percent);
  }

  const winnerChance = itemChanceMap.get(winner.id) ?? 0;
  const strip: RouletteStripEntry[] = [];

  for (let i = 0; i < totalItems; i += 1) {
    if (i === winnerIndex) {
      strip.push({ item: winner, chance: winnerChance });
      continue;
    }

    const randomDrop = getRandomItemFromCase(caseData);
    const item = getItemById(randomDrop.id) ?? winner;
    const chance = itemChanceMap.get(item.id) ?? randomDrop.chance_percent ?? 0;
    strip.push({ item, chance });
  }

  return strip;
};

const isLowPowerDevice = () => {
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8);
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || navigator.hardwareConcurrency <= 4
    || memory <= 4;
};

const getRouletteRarityPalette = (rarity: string) => {
  switch (rarity) {
    case 'обычный': return { backgroundColor: '#123349', borderColor: '#2c759d', particleColor: 'rgba(125, 211, 252, 0.20)' };
    case 'редкий': return { backgroundColor: '#133c2a', borderColor: '#2f8f62', particleColor: 'rgba(110, 231, 183, 0.20)' };
    case 'эпический': return { backgroundColor: '#35204b', borderColor: '#8b5db1', particleColor: 'rgba(216, 180, 254, 0.20)' };
    case 'мифический': return { backgroundColor: '#481e29', borderColor: '#a94d63', particleColor: 'rgba(253, 164, 175, 0.20)' };
    case 'легендарный': return { backgroundColor: '#4a390f', borderColor: '#b78a20', particleColor: 'rgba(253, 224, 71, 0.20)' };
    default: return { backgroundColor: '#1a2028', borderColor: '#46515f', particleColor: 'rgba(203, 213, 225, 0.14)' };
  }
};

const Roulette: React.FC<{
  caseData: Case;
  winner: BaseItem;
  compact: boolean;
  lowPower: boolean;
  durationMs: number;
  index: number;
  settled: boolean;
}> = React.memo(({ caseData, winner, compact, lowPower, durationMs, index, settled }) => {
  const cardWidth = compact ? 72 : 104;
  const gap = compact ? 6 : 8;
  const totalItems = lowPower ? (compact ? 10 : 15) : (compact ? 13 : 22);
  const winnerIndex = totalItems - (compact ? 3 : 5);
  const [strip] = useState<RouletteStripEntry[]>(() => buildRouletteStrip(caseData, winner, totalItems, winnerIndex));
  const [isSpinning, setIsSpinning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [finalTranslate, setFinalTranslate] = useState(0);

  useEffect(() => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
    const containerCenter = containerWidth / 2;
    const slotWidth = cardWidth + gap;
    const winnerCenterPosition = (winnerIndex * slotWidth) + (cardWidth / 2);
    const jitter = (Math.random() * cardWidth * 0.36) - (cardWidth * 0.18);
    const translate = containerCenter - winnerCenterPosition + jitter;

    setFinalTranslate(translate);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setIsSpinning(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [cardWidth, gap, winnerIndex]);

  const winnerRarity = getItemRarity(winner);

  return (
    <div className={`relative min-w-0 flex-shrink-0 ${compact ? 'h-[92px]' : 'h-40'}`}>
      <span className="absolute left-2 top-1.5 z-20 text-[9px] font-bold font-mono text-amber-300">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div
        ref={containerRef}
        className={`roulette-viewport relative w-full h-full overflow-hidden bg-[#0b0d10] border transition-colors duration-300 ${settled ? getRarityColor(winnerRarity).split(' ').find(value => value.startsWith('border-')) : 'border-slate-800'} rounded-lg`}
      >
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-300 z-20 -translate-x-1/2 shadow-[0_0_10px_rgba(252,211,77,0.85)]" />
        <div className="absolute left-1/2 top-0 -translate-x-1/2 z-20 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-amber-300" />

        <div
          className="roulette-track flex h-full items-center absolute left-0"
          style={{
            gap: `${gap}px`,
            paddingLeft: `${gap}px`,
            transform: `translate3d(${isSpinning ? finalTranslate : 0}px, 0, 0)`,
            transition: `transform ${durationMs}ms cubic-bezier(0.08, 0.72, 0.12, 1)`,
          }}
        >
          {strip.map(({ item, chance }, itemIndex) => {
            const rarity = getItemRarity(item);
            const isWinner = itemIndex === winnerIndex;
            const palette = getRouletteRarityPalette(rarity);

            return (
            <div
              key={`${item.id}-${itemIndex}`}
              className={`roulette-card rarity-card flex-shrink-0 flex flex-col items-center justify-between relative border text-white ${isWinner && settled ? `${getRarityColor(rarity)} scale-[1.03]` : ''} rounded-md`}
              style={{
                width: `${cardWidth}px`,
                height: compact ? '68px' : '124px',
                backgroundColor: palette.backgroundColor,
                borderColor: palette.borderColor,
                '--rarity-particle': palette.particleColor,
              }}
            >
              <div className={compact
                ? 'absolute right-1 top-1 text-[7px] font-bold text-white/55'
                : 'text-[9px] text-slate-500 w-full text-right px-1.5 pt-1'}>
                {chance.toFixed(2)}%
              </div>
              <ItemArtwork item={item} eager className={compact ? 'text-3xl w-10 h-10 mt-3' : 'text-5xl w-16 h-16'} />
              <div className={`w-full text-center leading-tight font-bold text-slate-200 truncate ${compact ? 'text-[8px] px-1 pb-1' : 'text-[9px] px-1.5 pb-2'}`}>
                {getItemName(item)}
              </div>
            </div>
            );
          })}
        </div>

        <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[#0b0d10] to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#0b0d10] to-transparent z-10 pointer-events-none" />
      </div>
    </div>
  );
});

const RouletteScreen = ({
  selectedCase,
  droppedItems,
  onComplete
}: {
  selectedCase: Case,
  droppedItems: InventoryItem[],
  onComplete: () => void
}) => {
  const [settled, setSettled] = useState(false);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const [lowPower] = useState(isLowPowerDevice);
  const compact = droppedItems.length >= 6;
  const durationMs = compact
    ? (lowPower ? 1800 : 2600)
    : (lowPower ? 1450 : 2850);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const settleTimer = window.setTimeout(() => setSettled(true), durationMs + 80);
    const finishTimer = window.setTimeout(finish, durationMs + (lowPower ? 360 : 720));
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(finishTimer);
    };
  }, [durationMs, finish, lowPower]);

  return (
      <div className="telegram-full-height flex flex-col h-full bg-[#080a0d] overflow-hidden">
        <div className="px-4 pt-4 pb-3 bg-[#101318] z-20 border-b border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              <div className="w-9 h-9 rounded-md border border-amber-400/30 bg-amber-400/10 flex items-center justify-center">
                <PackageOpen className="w-5 h-5 text-amber-300" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-amber-300 font-bold uppercase">Распаковка</div>
                <h2 className="text-base font-bold text-white truncate">{selectedCase.name}</h2>
              </div>
            </div>
            <button
              onClick={finish}
              className="h-9 px-3 flex items-center gap-1.5 text-xs font-bold text-slate-300 border border-slate-700 rounded-md hover:bg-slate-800"
            >
              <SkipForward className="w-4 h-4" />
              Пропустить
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
            <span>{`${droppedItems.length} ${droppedItems.length === 1 ? 'кейс' : 'кейсов'}`}</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span>{lowPower ? 'экономичный режим' : 'плавная прокрутка'}</span>
          </div>
        </div>
        <div className={`flex-1 p-3 pb-6 overflow-y-auto custom-scrollbar w-full ${compact ? 'grid grid-cols-2 content-start gap-2' : `flex flex-col gap-2 ${droppedItems.length === 1 ? 'justify-center' : 'justify-start'}`}`}>
           {droppedItems.map((item, index) => (
             <Roulette
                key={item.uniqueId}
                caseData={selectedCase}
                winner={item}
                compact={compact}
                lowPower={lowPower}
                durationMs={durationMs}
                index={index}
                settled={settled}
             />
           ))}
        </div>
      </div>
  );
}

const PlinkoBoard = ({ paths, prizes, winningBins, onSettled }: {
  paths: number[][];
  prizes: BaseItem[];
  winningBins: number[];
  onSettled: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSettledRef = useRef(onSettled);
  const [landedBallIndexes, setLandedBallIndexes] = useState<number[]>([]);

  useEffect(() => { onSettledRef.current = onSettled; }, [onSettled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || paths.length < 1 || paths.some(path => path.length !== 8)) return;
    setLandedBallIndexes([]);

    const width = 360;
    const height = 450;
    const centerX = width / 2;
    const horizontalStep = 20;
    const firstPegY = 56;
    const rowGap = 39;
    const ballRadius = 8;
    const pegRadius = 5.5;
    const contactOffset = ballRadius + pegRadius;
    const floorBallY = 433;
    const gravity = 1100;
    const pegs = Array.from({ length: 8 }, (_, row) => Array.from({ length: row + 3 }, (_, column) => ({
      x: centerX + (2 * column - row - 2) * horizontalStep,
      y: firstPegY + row * rowGap,
    }))).flat();
    const profiles = paths.map((path, ballIndex) => {
      let rights = 0;
      const contacts = path.map((direction, row) => {
        const point = {
          x: centerX + (2 * rights - row) * horizontalStep,
          y: firstPegY + row * rowGap - contactOffset,
        };
        if (direction > 0) rights += 1;
        return point;
      });
      const targetBin = Math.max(0, Math.min(8, winningBins[ballIndex] ?? rights));
      const initialDuration = 455 + Math.random() * 65;
      const bounceDurations = Array.from({ length: 7 }, () => 390 + Math.random() * 75);
      const finalDuration = 625 + Math.random() * 90;
      return {
        contacts,
        targetX: 20 + targetBin * 40,
        initialDuration,
        bounceDurations,
        finalDuration,
        totalDropDuration: initialDuration + bounceDurations.reduce((sum, duration) => sum + duration, 0) + finalDuration,
        startX: centerX + (ballIndex - (paths.length - 1) / 2) * 0.18,
      };
    });
    let frame = 0;
    const startedAt = performance.now();
    const settledBalls = new Set<number>();

    const finishBall = (index: number) => {
      if (settledBalls.has(index)) return;
      settledBalls.add(index);
      setLandedBallIndexes(Array.from(settledBalls));
      if (settledBalls.size === profiles.length) onSettledRef.current();
    };

    const context = canvas.getContext('2d');
    if (!context) return;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;

    const draw = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      context.lineWidth = 2;
      context.strokeStyle = 'rgba(34,211,238,0.22)';
      for (let index = 0; index <= 9; index += 1) {
        context.beginPath();
        context.moveTo(index * 40, 363);
        context.lineTo(index * 40, 443);
        context.stroke();
      }
      for (const peg of pegs) {
        context.beginPath();
        context.arc(peg.x, peg.y, pegRadius, 0, Math.PI * 2);
        context.shadowColor = 'rgba(103,232,249,0.8)';
        context.shadowBlur = 8;
        context.fillStyle = '#e2e8f0';
        context.fill();
      }
    };

    const ballisticPosition = (start: { x: number; y: number }, end: { x: number; y: number }, durationMs: number, elapsedMs: number) => {
      const duration = durationMs / 1000;
      const elapsed = Math.min(duration, Math.max(0, elapsedMs / 1000));
      const progress = duration > 0 ? elapsed / duration : 1;
      const initialVelocityY = (end.y - start.y - 0.5 * gravity * duration * duration) / duration;
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + initialVelocityY * elapsed + 0.5 * gravity * elapsed * elapsed,
      };
    };

    const getBallPosition = (profile: typeof profiles[number], elapsedMs: number) => {
      const start = { x: profile.startX, y: 18 };
      if (elapsedMs < profile.initialDuration) {
        const progress = Math.max(0, elapsedMs / profile.initialDuration);
        return {
          x: start.x + (profile.contacts[0].x - start.x) * progress,
          y: start.y + (profile.contacts[0].y - start.y) * progress * progress,
        };
      }

      let cursor = profile.initialDuration;
      for (let index = 0; index < profile.bounceDurations.length; index += 1) {
        const duration = profile.bounceDurations[index];
        if (elapsedMs < cursor + duration) {
          return ballisticPosition(profile.contacts[index], profile.contacts[index + 1], duration, elapsedMs - cursor);
        }
        cursor += duration;
      }

      if (elapsedMs < cursor + profile.finalDuration) {
        return ballisticPosition(profile.contacts[7], { x: profile.targetX, y: floorBallY }, profile.finalDuration, elapsedMs - cursor);
      }

      const bounceElapsed = elapsedMs - profile.totalDropDuration;
      if (bounceElapsed < 520) {
        const progress = bounceElapsed / 520;
        return { x: profile.targetX, y: floorBallY - Math.sin(Math.PI * progress) * 15 };
      }
      if (bounceElapsed < 850) {
        const progress = (bounceElapsed - 520) / 330;
        return { x: profile.targetX, y: floorBallY - Math.sin(Math.PI * progress) * 5 };
      }
      return { x: profile.targetX, y: floorBallY };
    };

    const drawBall = (position: { x: number; y: number }) => {
      context.shadowBlur = 0;
      context.beginPath();
      context.arc(position.x, position.y, ballRadius, 0, Math.PI * 2);
      context.shadowColor = 'rgba(253,224,71,0.95)';
      context.shadowBlur = 14;
      context.fillStyle = '#fde047';
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = '#fefce8';
      context.stroke();
      context.shadowBlur = 0;
    };

    const tick = (now: number) => {
      draw();
      const elapsed = now - startedAt;
      profiles.forEach((profile, index) => {
        drawBall(getBallPosition(profile, elapsed));
        if (elapsed >= profile.totalDropDuration) finishBall(index);
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [paths, winningBins]);

  const landedBinCounts = useMemo(() => {
    const counts = new Map<number, number>();
    landedBallIndexes.forEach(index => {
      const bin = winningBins[index];
      if (Number.isInteger(bin)) counts.set(bin, (counts.get(bin) || 0) + 1);
    });
    return counts;
  }, [landedBallIndexes, winningBins]);

  return (
    <div className="relative w-full max-w-md mx-auto aspect-[4/5] overflow-hidden rounded-t-lg border-x border-t border-cyan-400/30 bg-[#071016] shadow-[inset_0_0_45px_rgba(34,211,238,0.06)]">
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-cyan-400/10 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 grid grid-cols-9 h-[19%] z-10">
        {prizes.map((item, index) => {
          const landedCount = landedBinCounts.get(index) || 0;
          const selected = landedCount > 0;
          return (
            <div key={`${item.id}-${index}`} className={`relative min-w-0 flex flex-col items-center justify-start pt-2 px-0.5 overflow-hidden transition-colors duration-500 ${selected ? 'bg-yellow-400/10' : 'bg-slate-950/70'}`}>
              <div className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${selected ? 'opacity-100' : 'opacity-0'}`}>
                <div className="plinko-bin-glow absolute inset-x-0 bottom-0 h-full bg-gradient-to-t from-yellow-300/60 via-yellow-400/25 to-transparent" />
              </div>
              <ItemArtwork item={item} eager className="relative z-10 w-7 h-7 text-xl" />
              <span className={`relative z-10 mt-0.5 max-w-full truncate text-[7px] font-bold ${selected ? 'text-yellow-200' : 'text-slate-500'}`}>{formatMoney(getItemPrice(item))}</span>
              {landedCount > 1 && <span className="absolute z-20 right-0.5 bottom-0.5 min-w-4 h-4 px-0.5 rounded-full bg-yellow-300 text-[7px] font-black text-black flex items-center justify-center">×{landedCount}</span>}
            </div>
          );
        })}
      </div>
      <canvas ref={canvasRef} className="absolute inset-0 z-20 w-full h-full pointer-events-none" />
    </div>
  );
};

const QuantitySelector = ({ value, onChange }: { value: number, onChange: (val: number) => void }) => {
  const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const maxIndex = options.length - 1;
  const selectedIndex = Math.min(maxIndex, Math.max(0, value - 1));
  const cellWidthExpr = `(100% - 1rem) / ${options.length}`;

  return (
    <div className="relative bg-slate-800 rounded-xl p-2 mb-4 overflow-hidden">
      <div
        className="absolute top-1 bottom-1 bg-yellow-500 rounded-lg transition-all duration-300 ease-out shadow-[0_0_15px_rgba(234,179,8,0.5)]"
        style={{
          width: `calc(${cellWidthExpr})`,
          left: `calc(0.5rem + (${cellWidthExpr}) * ${selectedIndex})`,
        }}
      />

      <div className="relative z-10 grid grid-cols-10">
        {options.map((num) => (
          <button
            key={num}
            onClick={() => onChange(num)}
            className={`h-10 flex items-center justify-center font-bold text-sm transition-colors ${value === num ? 'text-black' : 'text-slate-400 hover:text-white'}`}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );
};

type InventoryGridItemProps = {
  item: InventoryItem;
  isSelected: boolean;
  onToggle: (id: string) => void;
};

const InventoryGridItem: React.FC<InventoryGridItemProps> = React.memo(({ item, isSelected, onToggle }) => {
  const rarityCol = getRarityColor(getItemRarity(item));
  const displayPrice = getItemPrice(item);
  const displayName = getItemName(item);

  return (
    <button
      onClick={() => onToggle(item.uniqueId)}
      className={`relative w-full rounded-xl border-2 flex flex-col items-center overflow-hidden p-0 transition-all hover:scale-[1.02] ${isSelected ? 'border-yellow-400 bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.3)]' : `${rarityCol} bg-opacity-40`}`}
      style={{ height: 176 }}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 bg-yellow-400 rounded-full p-0.5 z-20">
          <Check className="w-3 h-3 text-black stroke-[3]" />
        </div>
      )}

      <div className="flex min-h-0 w-full flex-1 flex-col items-center px-2 pt-3 pb-1">
        <ItemArtwork
          item={item}
          className="max-w-full shrink-0 text-5xl drop-shadow-lg"
          imageClassName="block"
          style={{ width: 101, height: 101 }}
        />

        <div className="mt-auto w-full text-center pb-0.5 relative -top-1">
          <div className="text-[11px] font-bold text-slate-300 truncate leading-tight mb-0.5">{displayName}</div>
          <div className="text-[9px] leading-none font-mono text-slate-500">#{item.serial}</div>
        </div>
      </div>

      <div className="w-full shrink-0 border-t border-black/50 bg-black/45 py-2 text-xs font-bold text-yellow-400 flex items-center justify-center gap-1">
        <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(displayPrice)}
      </div>
    </button>
  );
});

// --- MAIN APP ---

export default function App() {
  // SUPABASE & PLAYER STATE
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isTelegramUser, setIsTelegramUser] = useState(false);
  const [isTelegramFullscreen, setIsTelegramFullscreen] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Registration / Settings form state
  const [inputName, setInputName] = useState('');
  const [inputIsPublic, setInputIsPublic] = useState(false);
  const [inputShowProfileLink, setInputShowProfileLink] = useState(false);

  // GAME STATE
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [screen, setScreen] = useState<AppScreen>(AppScreen.GAMES_MENU);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [droppedItems, setDroppedItems] = useState<InventoryItem[]>([]);
  const [isOpeningCase, setIsOpeningCase] = useState(false);
  const [trashCaseLimit, setTrashCaseLimit] = useState<TrashCaseLimitState | null>(null);
  const [isLoadingTrashCaseLimit, setIsLoadingTrashCaseLimit] = useState(false);
  const [trashLimitClockMs, setTrashLimitClockMs] = useState(Date.now());
  
  const [activeTab, setActiveTab] = useState('games');
  const [openAmount, setOpenAmount] = useState(1);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Set<string>>(new Set());
  
  const [showSellAllConfirm, setShowSellAllConfirm] = useState(false);
  const [isSellAllPending, setIsSellAllPending] = useState(false);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<PlayerProfile[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);

  // Market State
  const [marketOffers, setMarketOffers] = useState<MarketOffer[]>([]);
  const [marketTabView, setMarketTabView] = useState<MarketViewTab>('MARKET');
  const [marketSearch, setMarketSearch] = useState('');
  const [marketSort, setMarketSort] = useState<MarketSort>('NEWEST');
  const [isMarketSortOpen, setIsMarketSortOpen] = useState(false);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [selectedMarketOffer, setSelectedMarketOffer] = useState<MarketOffer | null>(null);
  const [isBuyingMarketOffer, setIsBuyingMarketOffer] = useState(false);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [createOfferItem, setCreateOfferItem] = useState<InventoryItem | null>(null);
  const [createOfferPriceInput, setCreateOfferPriceInput] = useState('0');
  const [createOfferDescription, setCreateOfferDescription] = useState('');
  const [createOfferVisibility, setCreateOfferVisibility] = useState<OfferVisibility>('PUBLIC');
  const [createdOfferLink, setCreatedOfferLink] = useState<string | null>(null);
  const [createdOfferLotCode, setCreatedOfferLotCode] = useState<string | null>(null);
  const [isPublishingOffer, setIsPublishingOffer] = useState(false);
  const [isCancellingOffer, setIsCancellingOffer] = useState(false);
  const [isTelegramRequiredForOffer, setIsTelegramRequiredForOffer] = useState(false);
  const [uiToast, setUiToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [copyFallbackText, setCopyFallbackText] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pendingOfferIdRef = useRef<string | null>(null);
  const didHandleInitialOfferRef = useRef(false);
  const marketReturnTimerRef = useRef<number | null>(null);
  const marketRequestIdRef = useRef(0);
  const initialOfferId = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      const directParam = normalizeOfferId(url.searchParams.get('offer'));
      if (directParam) return directParam;

      const startCandidates: Array<string | null | undefined> = [
        url.searchParams.get('startapp'),
        url.searchParams.get('start'),
        url.searchParams.get('tgWebAppStartParam'),
        window.Telegram?.WebApp?.initDataUnsafe?.start_param,
      ];

      for (const candidate of startCandidates) {
        const parsed = parseOfferStartParam(candidate);
        if (parsed) return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Rocket Game State
  const [rocketBetItem, setRocketBetItem] = useState<InventoryItem | null>(null);
  const [rocketState, setRocketState] = useState<'IDLE' | 'FLYING' | 'CRASHED' | 'CASHED_OUT'>('IDLE');
  const [rocketMultiplier, setRocketMultiplier] = useState(1.00);
  const [rocketCrashPoint, setRocketCrashPoint] = useState(0);
  const [rocketWinnings, setRocketWinnings] = useState<BaseItem | null>(null);
  const rocketRequestRef = useRef<number | null>(null);
  const rocketStartTimeRef = useRef<number>(0);
  const rocketSessionIdRef = useRef<string | null>(null);
  const rocketCrashPointRef = useRef(0);

  // Upgrader Game State
  const [upgraderBetItem, setUpgraderBetItem] = useState<InventoryItem | null>(null);
  const [upgraderTargetItem, setUpgraderTargetItem] = useState<BaseItem | null>(null);
  const [upgraderSpinState, setUpgraderSpinState] = useState<'IDLE' | 'SPINNING' | 'WIN' | 'LOSE'>('IDLE');
  const [upgraderRotation, setUpgraderRotation] = useState(0);
  const upgraderServerResultRef = useRef<{ won: boolean } | null>(null);

  // Slots Game State
  const [slotsBet, setSlotsBet] = useState<number>(1000);
  const [slotsSpinState, setSlotsSpinState] = useState<'IDLE' | 'PRE_SPIN' | 'SPINNING' | 'FINISHED'>('IDLE');
  const [slotsWinItem, setSlotsWinItem] = useState<BaseItem | null>(null);
  const [slotsReelStrips, setSlotsReelStrips] = useState<{item: BaseItem, payout: number}[][]>([[], [], []]);
  const [plinkoBetInput, setPlinkoBetInput] = useState<string>('1000');
  const plinkoBetValue = Math.max(0, Math.trunc(Number(plinkoBetInput) || 0));
  const [plinkoBallCount, setPlinkoBallCount] = useState<number>(1);
  const [plinkoState, setPlinkoState] = useState<'IDLE' | 'LOADING' | 'DROPPING' | 'FINISHED'>('IDLE');
  const [plinkoPaths, setPlinkoPaths] = useState<number[][]>([]);
  const [plinkoBins, setPlinkoBins] = useState<number[]>([]);
  const [plinkoPrizes, setPlinkoPrizes] = useState<BaseItem[]>([]);
  const [plinkoWinItems, setPlinkoWinItems] = useState<InventoryItem[]>([]);
  const sellAllInFlightRef = useRef(false);

  // Business Game State
  const [businessState, setBusinessState] = useState<BusinessState>(EMPTY_BUSINESS_STATE);
  const [businessInvestmentInput, setBusinessInvestmentInput] = useState<string>('1000');
  const [businessClockMs, setBusinessClockMs] = useState<number>(Date.now());
  const [isBusinessHydrated, setIsBusinessHydrated] = useState<boolean>(false);
  const businessStateRef = useRef<BusinessState>(EMPTY_BUSINESS_STATE);

  // Player profile view state
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState<PlayerProfile | null>(null);
  const [isLoadingPlayerProfile, setIsLoadingPlayerProfile] = useState(false);

  const businessSecondsLeft = useMemo(() => {
    if (!businessState.active || businessState.pendingReward || businessState.nextDropAt === null) return 0;
    return Math.max(0, Math.ceil((businessState.nextDropAt - businessClockMs) / 1000));
  }, [businessState, businessClockMs]);

  const inventoryValueById = useMemo(() => {
    const valueById = new Map<string, number>();
    let total = 0;
    for (const item of inventory) {
      const value = getItemPrice(item);
      valueById.set(item.uniqueId, value);
      total += value;
    }
    return { valueById, total };
  }, [inventory]);

  const selectedSellValue = useMemo(() => {
    if (selectedInventoryIds.size === 0) return 0;
    let total = 0;
    for (const id of selectedInventoryIds) {
      total += inventoryValueById.valueById.get(id) ?? 0;
    }
    return total;
  }, [inventoryValueById, selectedInventoryIds]);

  const visibleMarketOffers = useMemo(() => {
    const query = marketSearch.trim().toLocaleLowerCase('ru-RU');
    const filtered = query
      ? marketOffers.filter(offer => [getItemName(offer.item), offer.description, offer.seller_name, offer.lot_code, offer.offer_id, getPermanentItemId(offer.item)]
          .some(value => value.toLocaleLowerCase('ru-RU').includes(query)))
      : [...marketOffers];
    if (marketSort === 'PRICE_ASC') filtered.sort((left, right) => left.price - right.price);
    if (marketSort === 'PRICE_DESC') filtered.sort((left, right) => right.price - left.price);
    if (marketSort === 'RARITY_DESC') filtered.sort((left, right) => {
      const rarityDifference = (RARITY_RANK[getItemRarity(right.item)] || 0) - (RARITY_RANK[getItemRarity(left.item)] || 0);
      return rarityDifference || getItemPrice(right.item) - getItemPrice(left.item);
    });
    return filtered;
  }, [marketOffers, marketSearch, marketSort]);

  const selectedSingleInventoryItem = useMemo(() => {
    if (selectedInventoryIds.size !== 1) return null;
    const onlyId = Array.from(selectedInventoryIds)[0];
    return inventory.find(item => item.uniqueId === onlyId) || null;
  }, [selectedInventoryIds, inventory]);

  const applyStatsDelta = useCallback((delta: StatsDelta) => {
    const addCases = Math.max(0, Math.floor(toSafeNumber(delta.casesOpened)));
    const addSpent = Math.max(0, Math.floor(toSafeNumber(delta.spent)));
    const addWon = Math.max(0, Math.floor(toSafeNumber(delta.won)));
    if (addCases === 0 && addSpent === 0 && addWon === 0) return;

    setPlayerProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        stats_cases_opened: Math.max(0, prev.stats_cases_opened + addCases),
        stats_total_spent: Math.max(0, prev.stats_total_spent + addSpent),
        stats_total_won: Math.max(0, prev.stats_total_won + addWon),
      };
    });
  }, []);

  useEffect(() => {
    setSelectedInventoryIds(prev => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (inventoryValueById.valueById.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [inventoryValueById]);

  useEffect(() => {
    businessStateRef.current = businessState;
  }, [businessState]);

  useEffect(() => {
    pendingOfferIdRef.current = initialOfferId;
  }, [initialOfferId]);

  useEffect(() => {
    return () => {
      if (marketReturnTimerRef.current !== null) {
        window.clearTimeout(marketReturnTimerRef.current);
        marketReturnTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    try {
      const current = new URL(window.location.href);
      const clean = new URL(`${current.origin}${current.pathname}`);
      if (initialOfferId) {
        clean.searchParams.set('offer', initialOfferId);
      }

      if (current.origin !== clean.origin || current.pathname !== clean.pathname || current.search !== clean.search) {
        window.history.replaceState({}, '', clean.toString());
      }
    } catch {
      // Ignore malformed URL states
    }
  }, [initialOfferId]);

  // --- INITIALIZATION ---
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const syncFullscreenState = () => setIsTelegramFullscreen(Boolean(tg.isFullscreen));
    tg.onEvent?.('fullscreenChanged', syncFullscreenState);
    tg.onEvent?.('fullscreenFailed', syncFullscreenState);
    syncFullscreenState();

    // Telegram owns the native chrome around a Mini App.  Keep every
    // supported launch surface on the same dark palette, then request the
    // full-screen mode where the client supports it. Unsupported clients
    // simply keep their normal header and ignore these optional methods.
    const appBackground = '#020617';
    const bottomBar = '#0f172a';
    try {
      tg.setHeaderColor?.(appBackground);
      tg.setBackgroundColor?.(appBackground);
      tg.setBottomBarColor?.(bottomBar);
    } catch {
      // Older Telegram clients can expose the object without newer methods.
    }
    try {
      tg.ready?.();
      tg.expand?.();
      tg.requestFullscreen?.();
    } catch {
      // Fullscreen is optional and may be declined by the host client.
    }

    // Some Android builds update isFullscreen one frame later without
    // dispatching the event immediately.
    const fullscreenCheck = window.setTimeout(syncFullscreenState, 350);
    return () => {
      window.clearTimeout(fullscreenCheck);
      tg.offEvent?.('fullscreenChanged', syncFullscreenState);
      tg.offEvent?.('fullscreenFailed', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    const initPlayer = async () => {
      const tg = window.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      const tgUser = tg?.initDataUnsafe?.user;
      const isTg = Boolean(tgUser?.id);
      setIsTelegramUser(isTg);
      setInitializationError(null);
      if (initialOfferId && !isTg) {
        setIsTelegramRequiredForOffer(true);
        setIsLoaded(true);
        return;
      }
      setIsTelegramRequiredForOffer(false);
      const userId = isTg ? String(tgUser?.id) : getOrCreateLocalPlayerId();

      const insertPayload: PlayerDbRow = {
        telegram_id: userId,
        username: tgUser?.username || null,
        first_name: tgUser?.first_name || null,
        balance: INITIAL_BALANCE,
        inventory_json: [],
        display_name: '',
        is_public: isTg,
        show_profile_link: isTg,
        stats_cases_opened: 0,
        stats_total_spent: 0,
        stats_total_won: 0,
      };

      let row: PlayerDbRow;
      try {
        row = await gameDatabase.getOrCreatePlayer(userId, insertPayload) as PlayerDbRow;
      } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (/заблокирован/i.test(message)) {
            setAccessBlocked(true);
            setIsLoaded(true);
            return;
          }
          console.error('Failed to initialize player profile', error);
          if (isTg) {
            setPlayerProfile(null);
            setInitializationError(message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c');
            setShowWelcomeModal(false);
            setIsLoaded(true);
            return;
          }
          setPlayerProfile({
            id: userId,
            name: tgUser?.first_name || '',
            balance: INITIAL_BALANCE,
            inventory: [],
            telegram_id: isTg ? userId : undefined,
            telegram_username: tgUser?.username,
            is_public: false,
            show_profile_link: false,
            stats_cases_opened: 0,
            stats_total_spent: 0,
            stats_total_won: 0,
          });
          setBalance(INITIAL_BALANCE);
          setInventory([]);
          setInputName(tgUser?.first_name || '');
          setInputIsPublic(isTg);
          setInputShowProfileLink(isTg);
          setShowWelcomeModal(true);
          setIsLoaded(true);
          return;
      }

      const profile = mapDbRowToProfile(row);
      profile.telegram_id = isTg ? userId : undefined;
      profile.telegram_username = row.username || tgUser?.username || undefined;
      if (!profile.name && tgUser?.first_name) {
        profile.name = tgUser.first_name;
      }

      setPlayerProfile(profile);
      setBalance(profile.balance);
      setInventory(profile.inventory);
      const registeredName = (row.display_name || '').trim();
      setInputName(registeredName || tgUser?.first_name || profile.name || '');
      setInputIsPublic(isTg ? (row.is_public ?? true) : Boolean(row.is_public));
      setInputShowProfileLink(isTg ? (row.show_profile_link ?? row.is_public ?? true) : Boolean(row.show_profile_link));
      setShowWelcomeModal(!registeredName);
      setIsLoaded(true);
    };

    initPlayer();
  }, [initialOfferId, initializationAttempt]);

  const retryInitialization = () => {
    setInitializationError(null);
    setIsLoaded(false);
    setInitializationAttempt(previous => previous + 1);
  };

  const refreshTrashCaseLimit = useCallback(async () => {
    setIsLoadingTrashCaseLimit(true);
    try {
      if (gameDatabase.isOnline()) {
        const limit = await gameDatabase.getTrashCaseLimit();
        setTrashCaseLimit({
          limit: Math.max(1, Math.floor(toSafeNumber(limit.limit) || 100)),
          used: Math.max(0, Math.floor(toSafeNumber(limit.used))),
          remaining: Math.max(0, Math.floor(toSafeNumber(limit.remaining))),
          resetsAt: new Date(limit.resets_at).getTime(),
        });
      } else {
        setTrashCaseLimit(previous => previous && previous.resetsAt > Date.now() ? previous : {
          limit: 100,
          used: 0,
          remaining: 100,
          resetsAt: getNextHourTimestamp(),
        });
      }
    } catch (error) {
      console.error('Failed to load trash case limit', error);
    } finally {
      setTrashLimitClockMs(Date.now());
      setIsLoadingTrashCaseLimit(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCase?.key !== 'trash_case' || screen !== AppScreen.CASE_DETAIL) return;
    void refreshTrashCaseLimit();
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTrashLimitClockMs(now);
      setTrashCaseLimit(previous => {
        if (!previous || previous.resetsAt > now) return previous;
        window.setTimeout(() => { void refreshTrashCaseLimit(); }, 0);
        return { limit: 100, used: 0, remaining: 100, resetsAt: getNextHourTimestamp(now) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshTrashCaseLimit, screen, selectedCase?.key]);

  const grantBusinessReward = useCallback((dropAt = Date.now()) => {
    setBusinessState(prev => {
      if (!prev.active || prev.pendingReward || prev.nextDropAt === null) return prev;

      const reward = createBusinessReward(prev.investment, prev.targetTotal - prev.earnedTotal, dropAt);
      const rewardPrice = getItemPrice(reward.item);
      const earnedTotal = prev.earnedTotal + rewardPrice;

      return {
        ...prev,
        earnedTotal,
        rewardsCount: prev.rewardsCount + 1,
        active: true,
        pendingReward: reward,
        completedAt: null,
        nextDropAt: null,
      };
    });
  }, []);

  const applyAuthoritativePlayer = useCallback((row: PlayerDbRow) => {
    const profile = mapDbRowToProfile(row);
    setBalance(profile.balance);
    setInventory(profile.inventory);
    setPlayerProfile(previous => previous ? {
      ...previous,
      balance: profile.balance,
      inventory: profile.inventory,
      stats_cases_opened: profile.stats_cases_opened,
      stats_total_spent: profile.stats_total_spent,
      stats_total_won: profile.stats_total_won,
    } : previous);
  }, []);

  const runBusinessCatchup = useCallback(() => {
    const now = Date.now();
    const snapshot = businessStateRef.current;
    const { nextState } = simulateBusinessCatchup(snapshot, now);
    if (nextState === snapshot) return;

    setBusinessState(nextState);
  }, []);

  useEffect(() => {
    if (!playerProfile?.id) return;
    setIsBusinessHydrated(false);

    if (gameDatabase.isOnline()) {
      let cancelled = false;
      gameDatabase.getBusinessState()
        .then(({ session }) => {
          if (cancelled) return;
          const nextState = mapServerBusinessState(session);
          setBusinessState(nextState);
          businessStateRef.current = nextState;
          if (nextState.investment > 0) setBusinessInvestmentInput(String(nextState.investment));
          setBusinessClockMs(Date.now());
          setIsBusinessHydrated(true);
        })
        .catch(error => {
          console.error('Failed to load business state', error);
          if (!cancelled) setIsBusinessHydrated(true);
        });
      return () => { cancelled = true; };
    }

    const storageKey = getBusinessStorageKey(playerProfile.id);
    let parsed = EMPTY_BUSINESS_STATE;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        parsed = normalizeBusinessState(JSON.parse(raw));
      } catch {
        parsed = EMPTY_BUSINESS_STATE;
      }
    }

    const now = Date.now();
    const { nextState } = simulateBusinessCatchup(parsed, now);
    setBusinessState(nextState);
    businessStateRef.current = nextState;
    setBusinessClockMs(now);
    if (parsed.investment > 0) {
      setBusinessInvestmentInput(String(parsed.investment));
    }

    setIsBusinessHydrated(true);
  }, [playerProfile?.id]);

  useEffect(() => {
    if (!playerProfile?.id || !isBusinessHydrated || gameDatabase.isOnline()) return;
    const storageKey = getBusinessStorageKey(playerProfile.id);
    localStorage.setItem(storageKey, JSON.stringify(businessState));
  }, [businessState, playerProfile?.id, isBusinessHydrated]);

  useEffect(() => {
    if (gameDatabase.isOnline()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setBusinessClockMs(now);

      const snapshot = businessStateRef.current;
      if (!snapshot.active || snapshot.pendingReward || snapshot.nextDropAt === null) return;
      if (snapshot.nextDropAt > now) return;

      grantBusinessReward(now);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [grantBusinessReward]);

  useEffect(() => {
    if (!gameDatabase.isOnline() || !playerProfile?.id || !isBusinessHydrated) return;
    let cancelled = false;
    const refresh = () => gameDatabase.getBusinessState()
      .then(({ session }) => {
        if (cancelled) return;
        const nextState = mapServerBusinessState(session);
        setBusinessState(nextState);
        businessStateRef.current = nextState;
        setBusinessClockMs(Date.now());
      })
      .catch(error => console.error('Failed to refresh business state', error));
    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [playerProfile?.id, isBusinessHydrated]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      setBusinessClockMs(Date.now());
      if (!gameDatabase.isOnline()) runBusinessCatchup();
    };

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [runBusinessCatchup]);

  // --- SYNC TO DB ---
  useEffect(() => {
    if (!isLoaded || !playerProfile || gameDatabase.isOnline()) return;

    const timer = setTimeout(async () => {
      try {
        await gameDatabase.syncPlayer(playerProfile.id, {
          balance: balance,
          inventory_json: inventory,
          stats_cases_opened: playerProfile.stats_cases_opened,
          stats_total_spent: playerProfile.stats_total_spent,
          stats_total_won: playerProfile.stats_total_won,
        });
      } catch (error) {
        console.error('Error syncing:', error);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [balance, inventory, isLoaded, playerProfile]);


  const handleRegister = async () => {
    if (!playerProfile) return;
    if (!inputName.trim()) {
      alert("Введите имя!");
      return;
    }

    const nextShowProfileLink = isTelegramUser ? inputShowProfileLink : playerProfile.show_profile_link;

    const newProfile = {
      ...playerProfile,
      name: inputName.trim(),
      is_public: inputIsPublic,
      show_profile_link: nextShowProfileLink,
    };

    const updatePayload: Record<string, unknown> = {
      display_name: inputName.trim(),
      is_public: inputIsPublic,
    };
    if (isTelegramUser) {
      updatePayload.show_profile_link = inputShowProfileLink;
    }

    try {
      await gameDatabase.updateProfile(playerProfile.id, updatePayload);
    } catch (error) {
      alert("Ошибка регистрации: " + (error instanceof Error ? error.message : 'неизвестная ошибка'));
      return;
    }

    setPlayerProfile(newProfile);
    setIsLoaded(true);
    setShowWelcomeModal(false);
  };

  const handleUpdateSettings = async () => {
     if (!playerProfile) return;
     if (!inputName.trim()) {
       alert("Введите имя!");
       return;
     }
     
     const nextShowProfileLink = isTelegramUser ? inputShowProfileLink : playerProfile.show_profile_link;

     const updated = {
       ...playerProfile,
       name: inputName.trim(),
       is_public: inputIsPublic,
       show_profile_link: nextShowProfileLink,
     };

     const updatePayload: Record<string, unknown> = {
       display_name: inputName.trim(),
       is_public: inputIsPublic,
     };
     if (isTelegramUser) {
       updatePayload.show_profile_link = inputShowProfileLink;
     }

      try {
        await gameDatabase.updateProfile(playerProfile.id, updatePayload);
        setPlayerProfile(updated);
        setShowSettingsModal(false);
      } catch (error) {
        alert("Ошибка сохранения: " + (error instanceof Error ? error.message : 'неизвестная ошибка'));
      }
  };

  const fetchLeaderboard = async () => {
    setIsLoadingLeaderboard(true);
    try {
      const data = await gameDatabase.getLeaderboard();
      const mapped = (data as PlayerDbRow[]).map((row) => {
        const profile = mapDbRowToProfile(row);
        profile.telegram_id = row.telegram_id;
        profile.telegram_username = row.username || undefined;
        return profile;
      });
      setLeaderboard(mapped);
    } catch (error) {
      console.error('Failed to load leaderboard', error);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  const openPlayerProfileById = useCallback(async (playerId: string) => {
    const normalizedPlayerId = String(playerId || '').trim();
    if (!normalizedPlayerId) return;

    setIsLoadingPlayerProfile(true);
    const data = await gameDatabase.getPlayer(normalizedPlayerId).catch(error => {
      console.error('Failed to load player profile', error);
      return null;
    });

    if (!data) {
      setIsLoadingPlayerProfile(false);
      return;
    }

    const row = data as PlayerDbRow;
    const profile = mapDbRowToProfile(row);
    profile.telegram_id = row.telegram_id;
    profile.telegram_username = row.username || undefined;
    setSelectedPlayerProfile(profile);
    setScreen(AppScreen.PLAYER_PROFILE);
    setIsLoadingPlayerProfile(false);
  }, []);

  const buildOfferLink = useCallback((offerId: string) => {
    const normalizedOfferId = normalizeOfferId(offerId);
    if (!normalizedOfferId) return '';

    if (TELEGRAM_BOT_USERNAME) {
      const startParam = encodeOfferStartParam(normalizedOfferId);
      return buildTelegramMiniAppUrl(startParam);
    }

    const url = new URL(`${window.location.origin}${window.location.pathname}`);
    url.searchParams.set('offer', normalizedOfferId);
    return url.toString();
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    setUiToast({ message, type });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setUiToast(null);
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Ссылка скопирована', 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (copied) showToast('Ссылка скопирована', 'success');
      else setCopyFallbackText(text);
    }
  }, [showToast]);

  const fetchMarketOffers = useCallback(async (view: MarketViewTab = marketTabView, searchQuery = '') => {
    const requestId = ++marketRequestIdRef.current;
    setIsLoadingMarket(true);
    const currentPlayerId = String(playerProfile?.id || '').trim();
    if (view === 'MY_OFFERS') {
      if (!currentPlayerId) {
        if (requestId === marketRequestIdRef.current) {
          setMarketOffers([]);
          setIsLoadingMarket(false);
        }
        return;
      }
    }

    let result: { offers: Record<string, unknown>[]; sellers: Record<string, unknown>[] };
    try {
      result = await gameDatabase.listMarketOffers(view, currentPlayerId, searchQuery);
    } catch (error) {
      console.error('Failed to fetch market offers', error);
      if (requestId === marketRequestIdRef.current) setIsLoadingMarket(false);
      return;
    }

    if (requestId !== marketRequestIdRef.current) return;

    const rows = result.offers as MarketOfferDbRow[];
    const sellersById = new Map<string, PlayerDbRow>();
    for (const row of result.sellers as PlayerDbRow[]) {
      const id = String(row.telegram_id || '');
      if (!id) continue;
      sellersById.set(id, row);
    }

    const mapped = rows
      .map(row => mapOfferRow(row, sellersById))
      .filter(Boolean) as MarketOffer[];
    setMarketOffers(mapped);
    setIsLoadingMarket(false);
  }, [marketTabView, playerProfile?.id]);

  const handleMarketTabChange = useCallback((view: MarketViewTab) => {
    if (view === marketTabView) return;
    marketRequestIdRef.current += 1;
    setMarketTabView(view);
    setMarketOffers([]);
    setIsLoadingMarket(true);
    setIsMarketSortOpen(false);
  }, [marketTabView]);

  const fetchSingleOffer = useCallback(async (offerId: string) => {
    let result: { offer: Record<string, unknown> | null; seller: Record<string, unknown> | null };
    try {
      result = await gameDatabase.getMarketOffer(offerId);
    } catch (error) {
      console.error('Failed to fetch market offer', error);
      return null;
    }
    if (!result.offer) return null;

    const offerRow = result.offer as MarketOfferDbRow;
    const sellerId = String(offerRow.seller_telegram_id || '');
    const sellersById = new Map<string, PlayerDbRow>();
    if (sellerId && result.seller) {
      sellersById.set(sellerId, result.seller as PlayerDbRow);
    }

    return mapOfferRow(offerRow, sellersById);
  }, []);

  const openOfferById = useCallback(async (offerId: string) => {
    const offer = await fetchSingleOffer(offerId);
    if (!offer) {
      showToast('Лот не найден или уже недоступен');
      return false;
    }
    setSelectedMarketOffer(offer);
    setScreen(AppScreen.MARKET_OFFER);
    setActiveTab('market');
    return true;
  }, [fetchSingleOffer, showToast]);

  const openCreateOfferModal = useCallback(() => {
    if (selectedInventoryIds.size !== 1) return;
    const onlyId = Array.from(selectedInventoryIds)[0];
    const item = inventory.find(i => i.uniqueId === onlyId) || null;
    if (!item) return;

    setCreateOfferItem(item);
    setCreateOfferPriceInput(String(Math.max(0, getItemPrice(item))));
    setCreateOfferDescription('');
    setCreateOfferVisibility('PUBLIC');
    setCreatedOfferLink(null);
    setCreatedOfferLotCode(null);
    setShowCreateOfferModal(true);
  }, [inventory, selectedInventoryIds]);

  const closeCreateOfferModal = useCallback(() => {
    if (isPublishingOffer) return;
    setShowCreateOfferModal(false);
    setCreateOfferItem(null);
    setCreateOfferPriceInput('0');
    setCreateOfferDescription('');
    setCreateOfferVisibility('PUBLIC');
    setCreatedOfferLink(null);
    setCreatedOfferLotCode(null);
  }, [isPublishingOffer]);

  const handlePublishOffer = useCallback(async () => {
    if (!playerProfile || !createOfferItem) return;
    const price = Math.max(0, Math.floor(toSafeNumber(createOfferPriceInput)));
    const description = createOfferDescription.trim();

    const exists = inventory.some(item => item.uniqueId === createOfferItem.uniqueId);
    if (!exists) {
      showToast('Предмет уже отсутствует в инвентаре');
      return;
    }

    const offerId = `offer_${generateUUID()}`;
    const lotCode = generateLotCode();
    setIsPublishingOffer(true);

    const payload = {
      offer_id: offerId,
      lot_code: lotCode,
      seller_telegram_id: playerProfile.id,
      item_json: createOfferItem,
      price,
      description,
      visibility: createOfferVisibility,
      status: 'ACTIVE',
    };

    try {
      const createdOffer = await gameDatabase.createMarketOffer(payload);
      setCreatedOfferLotCode(normalizeLotCode(createdOffer.lot_code) || lotCode);
    } catch (error) {
      showToast(`Ошибка публикации: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
      setIsPublishingOffer(false);
      return;
    }

    setInventory(prev => prev.filter(item => item.uniqueId !== createOfferItem.uniqueId));
    setSelectedInventoryIds(new Set());
    setCreatedOfferLink(buildOfferLink(offerId));
    await fetchMarketOffers(marketTabView);
    setIsPublishingOffer(false);
  }, [
    playerProfile,
    createOfferItem,
    createOfferPriceInput,
    createOfferDescription,
    createOfferVisibility,
    inventory,
    buildOfferLink,
    fetchMarketOffers,
    marketTabView,
    showToast,
  ]);

  const handleCancelMarketOffer = useCallback(async (offer: MarketOffer) => {
    if (!playerProfile) return;
    if (offer.status !== 'ACTIVE') return;
    if (offer.seller_telegram_id !== playerProfile.id) return;

    setIsCancellingOffer(true);
    try {
      await gameDatabase.cancelMarketOffer(offer.offer_id, playerProfile.id);
    } catch (error) {
      console.error('Failed to cancel market offer', error);
      showToast('Не удалось снять товар с продажи');
      setIsCancellingOffer(false);
      await fetchMarketOffers(marketTabView);
      return;
    }

    setInventory(prev => {
      const exists = prev.some(item => item.uniqueId === offer.item.uniqueId);
      if (exists) return prev;
      return [offer.item, ...prev];
    });

    if (selectedMarketOffer?.offer_id === offer.offer_id) {
      setSelectedMarketOffer({
        ...offer,
        status: 'CANCELLED',
      });
      setScreen(AppScreen.MARKET_MENU);
    }

    await fetchMarketOffers(marketTabView);
    setIsCancellingOffer(false);
  }, [fetchMarketOffers, marketTabView, playerProfile, selectedMarketOffer, showToast]);

  const handleBuySelectedOffer = useCallback(async () => {
    if (!selectedMarketOffer || !playerProfile) return;
    const buyerId = String(playerProfile.telegram_id || playerProfile.id || '');
    if (!buyerId) {
      showToast('Не удалось определить аккаунт покупателя');
      return;
    }
    if (selectedMarketOffer.status !== 'ACTIVE') {
      showToast('Лот уже недоступен');
      return;
    }
    if (selectedMarketOffer.seller_telegram_id === buyerId) {
      showToast('Нельзя купить собственный лот');
      return;
    }
    if (balance < selectedMarketOffer.price) {
      showToast('Недостаточно звезд');
      return;
    }

    setIsBuyingMarketOffer(true);
    let purchase: { offer: Record<string, unknown>; buyer: Record<string, unknown> };
    try {
      purchase = await gameDatabase.buyMarketOffer(selectedMarketOffer.offer_id, buyerId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Лот уже куплен другим игроком');
      setIsBuyingMarketOffer(false);
      await fetchMarketOffers(marketTabView);
      return;
    }

    const buyerProfile = mapDbRowToProfile(purchase.buyer as PlayerDbRow);
    setBalance(buyerProfile.balance);
    setInventory(buyerProfile.inventory);
    setPlayerProfile(prev => prev ? {
      ...prev,
      balance: buyerProfile.balance,
      inventory: buyerProfile.inventory,
      stats_total_spent: buyerProfile.stats_total_spent,
      stats_total_won: buyerProfile.stats_total_won,
    } : prev);

    setSelectedMarketOffer(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'SOLD',
        buyer_telegram_id: buyerId,
        sold_at: String((purchase.offer as MarketOfferDbRow).sold_at || new Date().toISOString()),
      };
    });

    await fetchMarketOffers(marketTabView);
    setIsBuyingMarketOffer(false);
    if (marketReturnTimerRef.current !== null) {
      window.clearTimeout(marketReturnTimerRef.current);
    }
    marketReturnTimerRef.current = window.setTimeout(() => {
      setSelectedMarketOffer(null);
      setScreen(AppScreen.MARKET_MENU);
      setActiveTab('market');
      marketReturnTimerRef.current = null;
    }, 1000);
  }, [selectedMarketOffer, playerProfile, balance, fetchMarketOffers, marketTabView, showToast]);

  useEffect(() => {
    if (screen !== AppScreen.MARKET_MENU) return;
    const exactLotCode = normalizeLotCode(marketSearch) || '';
    const initialTimer = window.setTimeout(() => fetchMarketOffers(marketTabView, exactLotCode), exactLotCode ? 120 : 0);
    const timer = window.setInterval(() => {
      fetchMarketOffers(marketTabView, exactLotCode);
    }, 10000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [screen, fetchMarketOffers, marketTabView, marketSearch]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isLoaded || !playerProfile || didHandleInitialOfferRef.current) return;
    didHandleInitialOfferRef.current = true;
    const offerId = pendingOfferIdRef.current;
    if (!offerId) return;
    openOfferById(offerId);
  }, [isLoaded, playerProfile, openOfferById]);

  useEffect(() => {
    if (screen === AppScreen.PROFILE) setActiveTab('profile');
    else if (screen === AppScreen.LEADERBOARD || screen === AppScreen.PLAYER_PROFILE) {
      setActiveTab('leaderboard');
      if (screen === AppScreen.LEADERBOARD) fetchLeaderboard();
    }
    else if (screen === AppScreen.MARKET_MENU || screen === AppScreen.MARKET_OFFER) setActiveTab('market');
    else if (screen === AppScreen.GAMES_MENU || screen === AppScreen.CASE_LIST || screen === AppScreen.ROCKET_MENU || screen === AppScreen.UPGRADER_MENU || screen === AppScreen.SLOTS_MENU || screen === AppScreen.BUSINESS_MENU || screen === AppScreen.PLINKO_MENU || screen === AppScreen.PLINKO_GAME) setActiveTab('games');
  }, [screen]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'games') setScreen(AppScreen.GAMES_MENU);
    if (tab === 'profile') setScreen(AppScreen.PROFILE);
    if (tab === 'leaderboard') setScreen(AppScreen.LEADERBOARD);
    if (tab === 'market') {
      setMarketTabView('MARKET');
      setScreen(AppScreen.MARKET_MENU);
    }
  };

  const handlePlinkoStart = async () => {
    if (plinkoState === 'LOADING') return;
    const bet = plinkoBetValue;
    const ballCount = Math.trunc(plinkoBallCount);
    if (bet < MIN_PLINKO_BET || bet > MAX_PLINKO_BET) {
      showToast(`Ставка Plinko: от ${formatMoney(MIN_PLINKO_BET)} до ${formatMoney(MAX_PLINKO_BET)}`);
      return;
    }
    if (ballCount < 1 || ballCount > MAX_PLINKO_BALLS) {
      showToast(`Можно запустить от 1 до ${MAX_PLINKO_BALLS} шариков`);
      return;
    }
    if (inventory.length + ballCount > MAX_INVENTORY_ITEMS) { showToast(INVENTORY_LIMIT_MESSAGE); return; }
    const totalBet = bet * ballCount;
    if (balance < totalBet) { showToast('Недостаточно звезд'); return; }

    setPlinkoState('LOADING');
    try {
      let paths: number[][];
      let prizes: BaseItem[];
      let winningBins: number[];
      let wonItems: InventoryItem[];

      if (gameDatabase.isOnline()) {
        const response = await gameDatabase.playPlinko(bet, ballCount, `plinko_${generateUUID()}`);
        prizes = response.result.prizes.map(item => item as unknown as BaseItem);
        paths = response.result.balls.map(ball => ball.path);
        winningBins = response.result.balls.map(ball => ball.winning_bin);
        wonItems = response.result.won_items.map(item => item as unknown as InventoryItem);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
      } else {
        prizes = buildLocalPlinkoPrizes(bet);
        paths = Array.from({ length: ballCount }, () => Array.from({ length: 8 }, () => Math.random() < 0.5 ? -1 : 1));
        winningBins = paths.map(path => path.reduce((sum, direction) => sum + (direction > 0 ? 1 : 0), 0));
        wonItems = winningBins.map(winningBin => ({ ...prizes[winningBin], uniqueId: generateUUID(), serial: generateSerial(), obtainedAt: Date.now() }));
        setBalance(value => value - totalBet);
        applyStatsDelta({ spent: totalBet, won: wonItems.reduce((sum, item) => sum + getItemPrice(item), 0) });
        setInventory(items => [...wonItems, ...items]);
      }

      setPlinkoPaths(paths);
      setPlinkoPrizes(prizes);
      setPlinkoBins(winningBins);
      setPlinkoWinItems(wonItems);
      setPlinkoState('DROPPING');
      setScreen(AppScreen.PLINKO_GAME);
    } catch (error) {
      setPlinkoState('IDLE');
      showToast(error instanceof Error ? error.message : 'Не удалось запустить Plinko');
    }
  };

  // --- SLOTS LOGIC ---
  const handleSlotsStart = async () => {
    if (inventory.length >= MAX_INVENTORY_ITEMS) {
      showToast(INVENTORY_LIMIT_MESSAGE);
      return;
    }
    if (balance < slotsBet) {
      showToast('Недостаточно звезд');
      return;
    }

    let variantData: { item: BaseItem; payout: number }[];
    let resultIndices: number[];
    let winnerIndex = -1;
    let authoritativeWinItem: InventoryItem | null = null;

    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.spinSlots(slotsBet, `slots_${generateUUID()}`);
        const variants = response.result.variants.map(item => item as unknown as BaseItem);
        variantData = variants.map(item => ({ item, payout: getItemPrice(item) }));
        resultIndices = response.result.result_indices;
        winnerIndex = response.result.winner_index;
        authoritativeWinItem = response.result.won_item as unknown as InventoryItem | null;
        applyAuthoritativePlayer(response.player as PlayerDbRow);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось запустить слот');
        return;
      }
    } else {
      setBalance(prev => prev - slotsBet);
      applyStatsDelta({ spent: slotsBet });
      const multipliers = [0.5, 1.5, 5.0, 20.0];
      const variants = multipliers.map(multiplier => getRandomItemNearPrice(slotsBet * multiplier));
      variantData = variants.map(item => ({ item, payout: getItemPrice(item) }));
      const sumPrices = variantData.reduce((acc, variant) => acc + variant.payout, 0);
      const totalWinProb = Math.min(0.99, 4 * ((GAME_RTP * slotsBet) / sumPrices));
      const roll = Math.random();
      if (roll < totalWinProb) winnerIndex = Math.min(3, Math.floor((roll / totalWinProb) * 4));
      if (winnerIndex !== -1) {
        resultIndices = [winnerIndex, winnerIndex, winnerIndex];
      } else {
        const first = Math.floor(Math.random() * 4);
        let second = Math.floor(Math.random() * 4);
        while (second === first) second = Math.floor(Math.random() * 4);
        resultIndices = [first, second, Math.floor(Math.random() * 4)];
      }
    }

    const STRIP_LENGTH = 25;
    const TARGET_INDEX = 20;
    const newStrips = [[], [], []] as {item: BaseItem, payout: number}[][];
    for (let reel = 0; reel < 3; reel++) {
      const strip = [];
      for (let index = 0; index < STRIP_LENGTH; index++) {
        strip.push(index === TARGET_INDEX
          ? variantData[resultIndices[reel]]
          : variantData[Math.floor(Math.random() * 4)]);
      }
      newStrips[reel] = strip;
    }

    setSlotsReelStrips(newStrips);
    setSlotsWinItem(winnerIndex >= 0 ? variantData[winnerIndex].item : null);

    setScreen(AppScreen.SLOTS_GAME);
    setSlotsSpinState('PRE_SPIN'); 

    setTimeout(() => {
        setSlotsSpinState('SPINNING');
    }, 50);

    setTimeout(() => {
        setSlotsSpinState('FINISHED');
        if (winnerIndex >= 0 && !authoritativeWinItem) {
            const newItem: InventoryItem = {
              ...variantData[winnerIndex].item,
              uniqueId: generateUUID(),
              serial: generateSerial(),
              obtainedAt: Date.now()
            };
            applyStatsDelta({ won: getItemPrice(newItem) });
            setInventory(prev => [newItem, ...prev]);
        }
    }, 3500);
  };

  // --- UPGRADER LOGIC ---
  const startUpgrader = async () => {
    if (!upgraderBetItem || !upgraderTargetItem) return;
    setUpgraderSpinState('SPINNING');

    let chance = Math.min(1, (getItemPrice(upgraderBetItem) * GAME_RTP) / getItemPrice(upgraderTargetItem));
    let isWin: boolean;
    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.playUpgrader(upgraderBetItem.uniqueId, upgraderTargetItem.id, `upgrader_${generateUUID()}`);
        chance = response.result.chance;
        isWin = response.result.won;
        upgraderServerResultRef.current = { won: isWin };
        applyAuthoritativePlayer(response.player as PlayerDbRow);
      } catch (error) {
        upgraderServerResultRef.current = null;
        setUpgraderSpinState('IDLE');
        showToast(error instanceof Error ? error.message : 'Не удалось запустить улучшение');
        return;
      }
    } else {
      isWin = Math.random() < chance;
      upgraderServerResultRef.current = null;
    }

    const winSectorDegrees = 360 * chance;
    let targetAngle = 0;
    
    if (isWin) {
      const buffer = Math.min(5, winSectorDegrees / 4); 
      const randomInSector = Math.random() * (winSectorDegrees - 2 * buffer) + buffer;
      targetAngle = randomInSector;
    } else {
      const loseSectorSize = 360 - winSectorDegrees;
      const buffer = Math.min(5, loseSectorSize / 4);
      const randomInSector = Math.random() * (loseSectorSize - 2 * buffer) + buffer;
      targetAngle = winSectorDegrees + randomInSector;
    }

    const fullSpins = 360 * (Math.floor(Math.random() * 4) + 3); 
    const finalRotation = fullSpins + targetAngle;

    setUpgraderRotation(finalRotation);
  };

  const handleUpgraderComplete = () => {
    if (!upgraderBetItem || !upgraderTargetItem) return;

    const chance = Math.min(1, (getItemPrice(upgraderBetItem) * GAME_RTP) / getItemPrice(upgraderTargetItem));
    const winSectorDegrees = 360 * chance;
    const normalizedAngle = upgraderRotation % 360;
    const isWin = upgraderServerResultRef.current?.won ?? normalizedAngle <= winSectorDegrees;
    if (gameDatabase.isOnline()) {
      setUpgraderSpinState(isWin ? 'WIN' : 'LOSE');
      upgraderServerResultRef.current = null;
      return;
    }
    applyStatsDelta({
      spent: getItemPrice(upgraderBetItem),
      won: isWin ? getItemPrice(upgraderTargetItem) : 0,
    });

    if (isWin) {
      setUpgraderSpinState('WIN');
      const wonItem: InventoryItem = {
        ...upgraderTargetItem,
        uniqueId: generateUUID(),
        serial: generateSerial(),
        obtainedAt: Date.now()
      };
      setInventory(prev => {
        const filtered = prev.filter(i => i.uniqueId !== upgraderBetItem.uniqueId);
        return [wonItem, ...filtered];
      });
    } else {
      setUpgraderSpinState('LOSE');
      setInventory(prev => prev.filter(i => i.uniqueId !== upgraderBetItem.uniqueId));
    }
  };

  // --- ROCKET LOGIC ---
  const startRocketGame = async () => {
    if (!rocketBetItem) return;

    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.startRocket(rocketBetItem.uniqueId, `rocket_start_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        rocketSessionIdRef.current = response.result.session_id;
        rocketCrashPointRef.current = response.result.crash_multiplier;
        setRocketCrashPoint(response.result.crash_multiplier);
        const serverStartedAt = new Date(response.result.started_at).getTime();
        rocketStartTimeRef.current = Number.isFinite(serverStartedAt) ? serverStartedAt : Date.now();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось запустить ракетку');
        return;
      }
    } else {
      applyStatsDelta({ spent: getItemPrice(rocketBetItem) });
      const r = Math.random();
      const crash = GAME_RTP / (1 - r);
      rocketCrashPointRef.current = Math.max(GAME_RTP, crash);
      setRocketCrashPoint(rocketCrashPointRef.current);
      rocketStartTimeRef.current = Date.now();
    }

    setRocketState('FLYING');
    setRocketMultiplier(1.00);
    setRocketWinnings(null);
    rocketRequestRef.current = requestAnimationFrame(rocketTick);
  };

  const rocketTick = () => {
    const now = Date.now();
    const elapsed = (now - rocketStartTimeRef.current) / 1000;
    const currentMult = Math.pow(Math.E, 0.06 * elapsed);
    setRocketMultiplier(currentMult);

    if (currentMult >= rocketCrashPointRef.current) {
       setRocketState('CRASHED');
       if (!gameDatabase.isOnline()) setInventory(prev => prev.filter(i => i.uniqueId !== rocketBetItem?.uniqueId));
       setRocketBetItem(null);
    } else {
       rocketRequestRef.current = requestAnimationFrame(rocketTick);
    }
  };

  const stopRocketGame = async () => {
    if (rocketState !== 'FLYING' || !rocketBetItem) return;
    cancelAnimationFrame(rocketRequestRef.current!);

    if (gameDatabase.isOnline()) {
      const sessionId = rocketSessionIdRef.current;
      if (!sessionId) return;
      try {
        const response = await gameDatabase.cashoutRocket(sessionId, `rocket_cashout_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        setRocketMultiplier(response.result.multiplier);
        if (response.result.crashed || !response.result.cashed_out) {
          setRocketState('CRASHED');
          setRocketWinnings(null);
        } else {
          const wonItem = response.result.won_item as unknown as InventoryItem;
          setRocketState('CASHED_OUT');
          setRocketWinnings(wonItem);
        }
        setRocketBetItem(null);
        rocketSessionIdRef.current = null;
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось забрать выигрыш');
        setRocketState('CRASHED');
        setRocketBetItem(null);
      }
      return;
    }

    setRocketState('CASHED_OUT');
    
    const winValue = getItemPrice(rocketBetItem) * rocketMultiplier;
    const wonItemBase = findClosestItemByPrice(winValue);
    
    const wonItem: InventoryItem = {
      ...wonItemBase,
      uniqueId: generateUUID(),
      serial: generateSerial(),
      obtainedAt: Date.now()
    };
    applyStatsDelta({ won: getItemPrice(wonItem) });
    
    setRocketWinnings(wonItemBase);
    
    setInventory(prev => {
      const filtered = prev.filter(i => i.uniqueId !== rocketBetItem.uniqueId);
      return [wonItem, ...filtered];
    });
    setRocketBetItem(null);
  };

  useEffect(() => {
    return () => {
      if (rocketRequestRef.current) cancelAnimationFrame(rocketRequestRef.current);
    };
  }, []);

  // --- CASE LOGIC ---
  const handleOpenCase = async () => {
    if (!selectedCase || isOpeningCase) return;
    const totalCost = selectedCase.price * openAmount;
    const isTrashCase = selectedCase.key === 'trash_case';

    if (isTrashCase && (!trashCaseLimit || isLoadingTrashCaseLimit)) {
      showToast('Загружаем лимит мусорных кейсов');
      return;
    }
    if (isTrashCase && trashCaseLimit && openAmount > trashCaseLimit.remaining) {
      showToast(`Можно открыть ещё ${trashCaseLimit.remaining} из 100 до следующего часа`);
      return;
    }

    if (inventory.length + openAmount > MAX_INVENTORY_ITEMS) {
      showToast(INVENTORY_LIMIT_MESSAGE);
      return;
    }
    
    if (balance < totalCost) {
      showToast('Недостаточно звезд');
      return;
    }

    if (gameDatabase.isOnline()) {
      setIsOpeningCase(true);
      try {
        const response = await gameDatabase.openCases(selectedCase.key, openAmount, `cases_${generateUUID()}`);
        const drops = response.result.drops.map(item => item as unknown as InventoryItem);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        const serverLimit = response.result.trash_limit;
        if (isTrashCase && serverLimit) {
          setTrashCaseLimit({
            limit: Math.max(1, Math.floor(toSafeNumber(serverLimit.limit) || 100)),
            used: Math.max(0, Math.floor(toSafeNumber(serverLimit.used))),
            remaining: Math.max(0, Math.floor(toSafeNumber(serverLimit.remaining))),
            resetsAt: new Date(String(serverLimit.resets_at || '')).getTime(),
          });
          setTrashLimitClockMs(Date.now());
        }
        setDroppedItems(drops);
        setScreen(AppScreen.ROULETTE);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось открыть кейс');
        if (isTrashCase) void refreshTrashCaseLimit();
      } finally {
        setIsOpeningCase(false);
      }
      return;
    }

    setBalance(prev => prev - totalCost);
    
    const newItems: InventoryItem[] = [];
    for (let i = 0; i < openAmount; i++) {
      const drop = getRandomItemFromCase(selectedCase);
      const baseItem = getItemById(drop.id);
      if (baseItem) {
        newItems.push({
          ...baseItem,
          uniqueId: generateUUID(),
          serial: Math.floor(Math.random() * 10000) + 1,
          obtainedAt: Date.now()
        });
      }
    }
    const wonTotal = sumItemPrices(newItems);
    applyStatsDelta({
      casesOpened: openAmount,
      spent: totalCost,
      won: wonTotal,
    });
    if (isTrashCase) {
      setTrashCaseLimit(previous => previous ? {
        ...previous,
        used: previous.used + openAmount,
        remaining: Math.max(0, previous.remaining - openAmount),
      } : previous);
    }
    
    setDroppedItems(newItems);
    setScreen(AppScreen.ROULETTE);
  };

  const handleRouletteSequenceComplete = () => {
     if (!gameDatabase.isOnline()) setInventory(prev => [...droppedItems, ...prev]);
     setScreen(AppScreen.DROP_SUMMARY);
  };

  const sellSelected = async () => {
    if (selectedInventoryIds.size === 0) return;
    const idsToSell = new Set<string>(selectedInventoryIds);
    const totalValue = selectedSellValue;

    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.sellItems(Array.from(idsToSell), `sell_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        setSelectedInventoryIds(new Set());
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось продать предметы');
      }
      return;
    }

    setInventory(prev => prev.filter(i => !idsToSell.has(i.uniqueId)));
    setBalance(prev => prev + totalValue);
    setSelectedInventoryIds(new Set());
  };

  const handleSellAll = async () => {
    if (sellAllInFlightRef.current) return;
    if (inventory.length === 0) {
      setShowSellAllConfirm(false);
      return;
    }

    const totalValue = inventoryValueById.total;
    sellAllInFlightRef.current = true;
    setIsSellAllPending(true);
    setShowSellAllConfirm(false);
    setSelectedInventoryIds(new Set());

    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.sellAllItems(`sell_all_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось продать инвентарь');
      } finally {
        setIsSellAllPending(false);
        sellAllInFlightRef.current = false;
      }
      return;
    }

    window.setTimeout(() => {
      setInventory([]);
      setBalance(prev => prev + totalValue);
      setIsSellAllPending(false);
      sellAllInFlightRef.current = false;
    }, 0);
  };

  const handleStartBusiness = async () => {
    if (businessState.active) return;
    if (inventory.length >= MAX_INVENTORY_ITEMS) {
      showToast(INVENTORY_LIMIT_MESSAGE);
      return;
    }
    const parsed = Math.floor(toSafeNumber(businessInvestmentInput));
    const investment = Number.isFinite(parsed) ? parsed : 0;
    if (investment < MIN_BUSINESS_INVESTMENT) {
      setBusinessInvestmentInput(String(MIN_BUSINESS_INVESTMENT));
      showToast(`Минимальный вклад — ${MIN_BUSINESS_INVESTMENT} звезд`);
      return;
    }
    if (balance < investment) {
      return;
    }

    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.startBusiness(investment, `business_start_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        const nextState = mapServerBusinessState(response.result.session);
        setBusinessState(nextState);
        businessStateRef.current = nextState;
        setBusinessClockMs(Date.now());
        setBusinessInvestmentInput(String(investment));
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось запустить бизнес');
      }
      return;
    }

    const targetTotal = Math.round(investment * BUSINESS_RTP);
    const now = Date.now();

    setBalance(prev => prev - investment);
    applyStatsDelta({ spent: investment });
    setBusinessState({
      active: true,
      investment,
      targetTotal,
      earnedTotal: 0,
      nextDropAt: now + BUSINESS_TICK_MS,
      pendingReward: null,
      completedAt: null,
      rewardsCount: 0,
    });
    setBusinessClockMs(now);
    setBusinessInvestmentInput(String(investment));
  };

  const handleClaimBusinessReward = async () => {
    if (inventory.length >= MAX_INVENTORY_ITEMS) {
      showToast(INVENTORY_LIMIT_MESSAGE);
      return;
    }
    if (gameDatabase.isOnline()) {
      try {
        const response = await gameDatabase.claimBusinessReward(`business_claim_${generateUUID()}`);
        applyAuthoritativePlayer(response.player as PlayerDbRow);
        const nextState = mapServerBusinessState(response.result.session);
        setBusinessState(nextState);
        businessStateRef.current = nextState;
        setBusinessClockMs(Date.now());
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Не удалось забрать предмет');
      }
      return;
    }

    const pending = businessStateRef.current.pendingReward;
    if (!pending) return;

    setInventory(prev => prev.some(item => item.uniqueId === pending.item.uniqueId) ? prev : [pending.item, ...prev]);
    applyStatsDelta({ won: getItemPrice(pending.item) });
    setBusinessState(prev => {
      if (!prev.active || !prev.pendingReward) return prev;
      const completed = prev.earnedTotal >= prev.targetTotal;
      return {
        ...prev,
        active: !completed,
        pendingReward: null,
        completedAt: completed ? Date.now() : null,
        nextDropAt: completed ? null : Date.now() + BUSINESS_TICK_MS,
      };
    });
  };

  const handleResetBusiness = () => {
    if (businessState.active) return;
    setBusinessState(EMPTY_BUSINESS_STATE);
    setBusinessClockMs(Date.now());
  };

  const toggleInventorySelection = useCallback((id: string) => {
    setSelectedInventoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearInventorySelection = useCallback(() => {
    setSelectedInventoryIds(new Set());
  }, []);
  // --- RENDERERS ---

  const renderWelcomeModal = () => (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6 animate-in fade-in">
       <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-4 text-center">Добро пожаловать!</h2>
          <p className="text-slate-400 text-sm text-center mb-6">Создайте профиль, чтобы начать игру и сохранять прогресс.</p>
          
          <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ваше имя</label>
                <input 
                  type="text" 
                  value={inputName} 
                  onChange={(e) => setInputName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white outline-none focus:border-yellow-500"
                  placeholder="Введите никнейм"
                />
             </div>
             
             <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                <input 
                  type="checkbox"
                  id="isPublic"
                  checked={inputIsPublic}
                  onChange={(e) => setInputIsPublic(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-yellow-500"
                />
                <label htmlFor="isPublic" className="text-sm text-slate-300">
                  Показывать мой профиль в таблице лидеров
                </label>
             </div>
             {isTelegramUser && (
               <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input
                    type="checkbox"
                    id="showProfileLink"
                    checked={inputShowProfileLink}
                    onChange={(e) => setInputShowProfileLink(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-yellow-500"
                  />
                  <label htmlFor="showProfileLink" className="text-sm text-slate-300">
                    Отображать ссылку на мой профиль
                  </label>
               </div>
             )}

             <Button onClick={handleRegister} className="w-full py-4 mt-2">
               Начать игру
             </Button>
          </div>
       </div>
    </div>
  );

  const renderSettingsModal = () => (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-in fade-in">
       <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative">
          <button onClick={() => setShowSettingsModal(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">
             ✕
          </button>

          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
             <Settings className="w-6 h-6" /> Настройки
          </h2>
          
          <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ваше имя</label>
                <input 
                  type="text" 
                  value={inputName} 
                  onChange={(e) => setInputName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white outline-none focus:border-yellow-500"
                />
             </div>
             
             <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                <input 
                  type="checkbox"
                  id="isPublicEdit"
                  checked={inputIsPublic}
                  onChange={(e) => setInputIsPublic(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-yellow-500"
                />
                <label htmlFor="isPublicEdit" className="text-sm text-slate-300">
                  Показывать мой профиль в таблице лидеров
                </label>
             </div>
             {isTelegramUser && (
               <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input
                    type="checkbox"
                    id="showProfileLinkEdit"
                    checked={inputShowProfileLink}
                    onChange={(e) => setInputShowProfileLink(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-yellow-500"
                  />
                  <label htmlFor="showProfileLinkEdit" className="text-sm text-slate-300">
                    Отображать ссылку на мой профиль
                  </label>
               </div>
             )}

             <Button onClick={handleUpdateSettings} className="w-full py-4 mt-2">
               Сохранить
             </Button>
          </div>
       </div>
    </div>
  );

  const renderLeaderboard = () => (
      <div className="flex flex-col h-full bg-slate-950 pb-20">
          <div className="p-4 bg-slate-900/80 backdrop-blur border-b border-slate-800 sticky top-0 z-10 flex items-center justify-between">
              <h2 className="min-w-0 text-xl font-bold text-white flex items-center gap-2">
                 <Trophy className="w-6 h-6 text-yellow-500" /> Таблица Лидеров
              </h2>
              <div className="ml-3 flex-shrink-0">
                <BalanceBadge balance={balance} />
              </div>
          </div>

          <div className="p-4 overflow-y-auto custom-scrollbar">
             {isLoadingLeaderboard ? (
               <div className="py-20 flex justify-center text-yellow-500"><Loader2 className="w-8 h-8 animate-spin"/></div>
             ) : (
               <div className="space-y-2">
                  {leaderboard.map((p, index) => {
                     const isMe = p.id === playerProfile?.id;
                     const rank = index + 1;
                     const isTop3 = rank <= 3;
                     const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-500';

                     return (
                       <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl border ${isMe ? 'bg-yellow-500/10 border-yellow-500/50' : 'bg-slate-900 border-slate-800'}`}>
                          <div className="flex items-center gap-4">
                             <div className={`font-black text-xl w-8 text-center ${rankColor}`}>
                                {isTop3 ? (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉') : rank}
                             </div>
                             <div>
                                <div className="font-bold text-white flex items-center gap-2">
                                   <button
                                     onClick={() => { void openPlayerProfileById(p.id); }}
                                     className="hover:text-yellow-300 transition-colors text-left"
                                   >
                                     {p.name || 'Unknown'}
                                   </button>
                                   {p.show_profile_link && p.telegram_username && (
                                     <a
                                       href={`https://t.me/${p.telegram_username}`}
                                       target="_blank"
                                       rel="noopener noreferrer"
                                       className="text-slate-400 hover:text-blue-400 transition-colors"
                                     >
                                       <ExternalLink className="w-3 h-3" />
                                     </a>
                                   )}
                                   {isMe && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 rounded ml-1">ВЫ</span>}
                                </div>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className="text-yellow-400 font-bold text-sm flex items-center justify-end gap-1">
                                {formatMoney(p.balance)} <Star className="w-3 h-3 fill-yellow-400" />
                             </div>
                          </div>
                       </div>
                     )
                  })}
                  {leaderboard.length === 0 && (
                     <div className="text-center py-10 text-slate-500">Пока пусто...</div>
                  )}
               </div>
             )}
          </div>
      </div>
  );

  const renderStatsCards = (profile: PlayerProfile) => (
    <div className="grid grid-cols-3 gap-2">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
        <div className="text-[10px] text-slate-500 uppercase font-bold">Кейсы</div>
        <div className="text-sm font-bold text-white">{formatMoney(profile.stats_cases_opened)}</div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
        <div className="text-[10px] text-slate-500 uppercase font-bold">Потрачено</div>
        <div className="text-sm font-bold text-red-300">{formatMoney(profile.stats_total_spent)}</div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
        <div className="text-[10px] text-slate-500 uppercase font-bold">Выиграно</div>
        <div className="text-sm font-bold text-green-300">{formatMoney(profile.stats_total_won)}</div>
      </div>
    </div>
  );

  const renderPlayerProfile = () => (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="p-4 bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-10 flex items-center gap-2">
        <button onClick={() => setScreen(AppScreen.LEADERBOARD)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-white truncate">Профиль игрока</h2>
        <div className="ml-auto">
          <BalanceBadge balance={balance} />
        </div>
      </div>

      <div className="p-4 pb-24 overflow-y-auto custom-scrollbar space-y-4">
        {isLoadingPlayerProfile ? (
          <div className="py-20 flex justify-center text-yellow-500"><Loader2 className="w-8 h-8 animate-spin"/></div>
        ) : !selectedPlayerProfile ? (
          <div className="text-center text-slate-500 py-12">Профиль не найден</div>
        ) : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-white">{selectedPlayerProfile.name || 'Unknown'}</div>
                  <div className="text-xs text-slate-500 mt-1">{`ID: ${selectedPlayerProfile.id.slice(0, 12)}`}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase text-slate-500 font-bold">Баланс</div>
                  <div className="text-yellow-400 font-bold flex items-center justify-end gap-1">
                    <Star className="w-3 h-3 fill-yellow-400" />
                    {formatMoney(selectedPlayerProfile.balance)}
                  </div>
                </div>
              </div>
              {selectedPlayerProfile.show_profile_link && selectedPlayerProfile.telegram_username && (
                <a
                  href={`https://t.me/${selectedPlayerProfile.telegram_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-3"
                >
                  @{selectedPlayerProfile.telegram_username} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {renderStatsCards(selectedPlayerProfile)}

            <div className="space-y-2">
              <div className="text-xs uppercase text-slate-500 font-bold">{`Предметов: ${selectedPlayerProfile.inventory.length}`}</div>
              {selectedPlayerProfile.inventory.length === 0 ? (
                <div className="text-slate-500 text-sm py-8 text-center bg-slate-900 border border-slate-800 rounded-xl">Инвентарь пуст</div>
              ) : (
                selectedPlayerProfile.inventory.map((item) => (
                  <div key={item.uniqueId} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                    <ItemArtwork item={item} className="w-12 h-12 bg-slate-800 rounded-lg border border-slate-700 text-2xl" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-white truncate">{getItemName(item)}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{`ID: ${getPermanentItemId(item)}`}</div>
                    </div>
                    <div className="text-yellow-400 font-bold text-xs flex items-center gap-1">
                      <Star className="w-3 h-3 fill-yellow-400" />
                      {formatMoney(getItemPrice(item))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderCreateOfferModal = () => {
    if (!showCreateOfferModal) return null;
    const rarity = createOfferItem ? getItemRarity(createOfferItem) : '';
    const rarityStyle = getMarketRarityStyle(rarity);

    return createPortal(
      <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4 animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="create-offer-title">
        <div className="w-full max-w-sm max-h-[calc(100dvh-24px)] overflow-y-auto bg-[#111419] border border-slate-700 rounded-lg shadow-2xl">
          <div className="h-14 px-4 flex items-center gap-3 border-b border-slate-800 sticky top-0 z-10 bg-[#111419]">
            <div className="w-8 h-8 rounded-md bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
              <Store className="w-4 h-4 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <h3 id="create-offer-title" className="text-sm font-bold text-white">{createdOfferLink ? 'Лот опубликован' : 'Новый лот'}</h3>
              <div className="text-[9px] text-slate-500">Рынок предметов</div>
            </div>
            <button
              type="button"
              onClick={closeCreateOfferModal}
              disabled={isPublishingOffer}
              className="ml-auto w-8 h-8 inline-flex items-center justify-center border border-slate-700 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40"
              aria-label="Закрыть"
              title="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {createdOfferLink ? (
            <div className="p-4 space-y-4">
              <div className="py-6 text-center border-b border-slate-800">
                <div className="w-12 h-12 mx-auto mb-3 rounded-md bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
                  <Check className="w-6 h-6 text-emerald-300" />
                </div>
                <div className="font-bold text-white">Предмет появился на рынке</div>
                {createdOfferLotCode && <div className="mt-2 text-sm text-emerald-300 font-black font-mono">{createdOfferLotCode}</div>}
              </div>
              <div className="bg-[#090b0e] border border-slate-800 rounded-md px-3 py-2.5 text-[10px] text-slate-400 font-mono break-all">{createdOfferLink}</div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => copyText(createdOfferLink)} className="h-11 rounded-md bg-emerald-400 text-[#07130e] text-xs font-black uppercase hover:bg-emerald-300">Копировать</button>
                <button type="button" onClick={closeCreateOfferModal} className="h-11 rounded-md border border-slate-700 text-slate-300 text-xs font-bold uppercase hover:bg-slate-800">Закрыть</button>
              </div>
            </div>
          ) : (
            <div key={createOfferItem?.uniqueId || 'empty'}>
              {createOfferItem && (
                <div className={`px-4 py-4 flex items-center gap-4 border-b ${rarityStyle.border} ${rarityStyle.bg}`}>
                  <ItemArtwork item={createOfferItem} className="w-16 h-16 text-5xl flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className={`inline-block mb-1 text-[9px] font-bold uppercase ${rarityStyle.text}`}>{rarity}</span>
                    <div className="font-bold text-white truncate">{getItemName(createOfferItem)}</div>
                    <div className="text-xs text-amber-200 font-black font-mono">{getPermanentItemId(createOfferItem)}</div>
                  </div>
                </div>
              )}

              <div className="p-4 space-y-4">
                <div>
                  <label htmlFor="market-offer-price" className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase mb-2"><Star className="w-3.5 h-3.5" /> Цена</label>
                  <div className="relative">
                    <input
                      id="market-offer-price"
                      name="market-offer-price"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={createOfferPriceInput}
                      disabled={isPublishingOffer}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setCreateOfferPriceInput(event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 15))}
                      className="w-full h-12 bg-[#090b0e] border border-slate-700 rounded-md pl-3 pr-10 text-white font-bold outline-none focus:border-emerald-400 disabled:opacity-50"
                      aria-label="Цена лота"
                    />
                    <Star className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-300 fill-amber-300 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label htmlFor="market-offer-description" className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase mb-2"><Tag className="w-3.5 h-3.5" /> Описание <span className="text-slate-700 normal-case">необязательно</span></label>
                  <textarea
                    id="market-offer-description"
                    name="market-offer-description"
                    value={createOfferDescription}
                    disabled={isPublishingOffer}
                    onChange={(event) => setCreateOfferDescription(event.currentTarget.value.slice(0, 280))}
                    rows={3}
                    maxLength={280}
                    placeholder="Добавьте детали о предмете"
                    className="w-full bg-[#090b0e] border border-slate-700 rounded-md px-3 py-3 text-sm text-white outline-none focus:border-emerald-400 resize-none disabled:opacity-50 placeholder:text-slate-700"
                  />
                  <div className="mt-1 text-right text-[9px] text-slate-600 font-mono">{createOfferDescription.length}/280</div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase mb-2"><EyeOff className="w-3.5 h-3.5" /> Доступ</div>
                  <div className="grid grid-cols-2 gap-1 bg-[#090b0e] border border-slate-800 p-1 rounded-md">
                    <button type="button" disabled={isPublishingOffer} onClick={() => setCreateOfferVisibility('PUBLIC')} className={`h-10 rounded text-xs font-bold flex items-center justify-center gap-1.5 ${createOfferVisibility === 'PUBLIC' ? 'bg-emerald-400 text-[#07130e]' : 'text-slate-400 hover:bg-slate-800'}`}>
                      <Globe2 className="w-3.5 h-3.5" /> Для всех
                    </button>
                    <button type="button" disabled={isPublishingOffer} onClick={() => setCreateOfferVisibility('LINK_ONLY')} className={`h-10 rounded text-xs font-bold flex items-center justify-center gap-1.5 ${createOfferVisibility === 'LINK_ONLY' ? 'bg-emerald-400 text-[#07130e]' : 'text-slate-400 hover:bg-slate-800'}`}>
                      <Link2 className="w-3.5 h-3.5" /> По ссылке
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { void handlePublishOffer(); }}
                  disabled={isPublishingOffer || createOfferPriceInput === ''}
                  className="w-full h-12 rounded-md bg-emerald-400 text-[#07130e] text-sm font-black uppercase flex items-center justify-center gap-2 hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isPublishingOffer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
                  {isPublishingOffer ? 'Публикуем' : 'Выставить на рынок'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>,
      document.body,
    );
  };

  const renderMarketMenu = () => (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="p-4 bg-slate-900/80 backdrop-blur border-b border-slate-800 sticky top-0 z-10 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Banknote className="w-6 h-6 text-yellow-500" /> {'Рынок'}
        </h2>
        <button
          onClick={() => fetchMarketOffers(marketTabView)}
          className="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-700"
        >
          {'Обновить'}
        </button>
      </div>

      <div className="px-4 pt-3">
        <div className="grid grid-cols-2 gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setMarketTabView('MARKET')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors ${marketTabView === 'MARKET' ? 'bg-yellow-500 text-black' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            {'Рынок'}
          </button>
          <button
            onClick={() => setMarketTabView('MY_OFFERS')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors ${marketTabView === 'MY_OFFERS' ? 'bg-yellow-500 text-black' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            {'Мои товары'}
          </button>
        </div>
      </div>

      <div className="p-4 pb-24 overflow-y-auto custom-scrollbar space-y-3">
        {isLoadingMarket ? (
          <div className="py-20 flex justify-center text-yellow-500"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : marketOffers.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            {marketTabView === 'MY_OFFERS' ? 'У вас нет активных товаров' : 'Пока нет активных предложений'}
          </div>
        ) : (
          marketOffers.map((offer) => (
            <div
              key={offer.offer_id}
              onClick={() => { void openOfferById(offer.offer_id); }}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-left hover:border-yellow-500/40 transition-all"
            >
              <div className="flex items-start gap-3">
                <ItemArtwork item={offer.item} className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-lg text-2xl" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm truncate">{getItemName(offer.item)}</div>
                  <div className="text-[11px] text-slate-400">{`ID: ${offer.item.uniqueId.slice(0, 10)}`}</div>
                  <div className="text-yellow-400 text-xs font-bold flex items-center gap-1 mt-1">
                    <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(offer.price)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {offer.description}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    {offer.seller_show_profile_link && offer.seller_username ? (
                      <a href={`https://t.me/${offer.seller_username}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {`Продавец: ${offer.seller_name} (@${offer.seller_username})`}
                      </a>
                    ) : (
                      <span>{`Продавец: ${offer.seller_name}`}</span>
                    )}
                  </div>
                </div>
              </div>

              {marketTabView === 'MY_OFFERS' && (
                <Button
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    void handleCancelMarketOffer(offer);
                  }}
                  variant="danger"
                  disabled={isCancellingOffer}
                  className="w-full mt-3 py-2"
                >
                  {isCancellingOffer ? 'Снимаем...' : 'Снять с продажи'}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderMarketOffer = () => {
    if (!selectedMarketOffer) return null;

    const offer = selectedMarketOffer;
    const currentUserId = String(playerProfile?.id || '');
    const isOwnOffer = Boolean(currentUserId) && offer.seller_telegram_id === currentUserId;
    const isBoughtByCurrentUser = offer.status !== 'ACTIVE' && Boolean(currentUserId) && offer.buyer_telegram_id === currentUserId;
    const canBuy = offer.status === 'ACTIVE' && !isOwnOffer && balance >= offer.price;
    const offerLink = buildOfferLink(offer.offer_id);

    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
          <button onClick={() => setScreen(AppScreen.MARKET_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-white truncate">{'Товар на рынке'}</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => copyText(offerLink)}
              className="p-2 bg-slate-900 rounded-full hover:bg-slate-800 text-slate-300"
              title="Копировать ссылку"
            >
              <Link2 className="w-4 h-4" />
            </button>
            <BalanceBadge balance={balance} />
          </div>
        </div>

        <div className="p-4 pb-24 overflow-y-auto custom-scrollbar space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <ItemArtwork item={offer.item} className="w-14 h-14 bg-slate-800 border border-slate-700 rounded-xl text-3xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-white">{getItemName(offer.item)}</div>
                <div className="text-xs text-slate-400">{`ID: ${offer.item.uniqueId}`}</div>
                <div className="text-yellow-400 font-bold text-sm mt-1 flex items-center gap-1">
                  <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(offer.price)}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-400 whitespace-pre-wrap break-words">
              {offer.description}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              {offer.seller_show_profile_link && offer.seller_username ? (
                <a href={`https://t.me/${offer.seller_username}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                  {`Продавец: ${offer.seller_name} (@${offer.seller_username})`}
                </a>
              ) : (
                <span>{`Продавец: ${offer.seller_name}`}</span>
              )}
            </div>
          </div>

          {offer.status !== 'ACTIVE' ? (
            <Button disabled variant="secondary" className="w-full">
              {isBoughtByCurrentUser ? 'Куплено!' : 'Товар уже недоступен'}
            </Button>
          ) : isOwnOffer ? (
            <Button onClick={() => { void handleCancelMarketOffer(offer); }} disabled={isCancellingOffer} variant="danger" className="w-full">
              {isCancellingOffer ? 'Снимаем...' : 'Снять с продажи'}
            </Button>
          ) : (
            <Button onClick={handleBuySelectedOffer} disabled={!canBuy || isBuyingMarketOffer} className="w-full py-4 text-lg">
              {isBuyingMarketOffer ? 'Покупка...' : (canBuy ? 'Купить' : 'Недостаточно звезд')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderMarketMenuV2 = () => (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0d10]">
      <div className="px-4 pt-4 pb-3 bg-[#111419] border-b border-slate-800 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
              <Store className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Рынок</h2>
              <div className="text-[10px] text-slate-500">{`${marketOffers.length} активных предложений`}</div>
            </div>
          </div>
          <div className="ml-3 flex items-center gap-2 flex-shrink-0">
            <BalanceBadge balance={balance} />
            <button
              onClick={() => fetchMarketOffers(marketTabView)}
              className="w-9 h-9 inline-flex items-center justify-center text-slate-400 border border-slate-700 rounded-md hover:text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={isLoadingMarket}
              title="Обновить предложения"
              aria-label="Обновить предложения"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingMarket ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1 bg-[#090b0e] border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => handleMarketTabChange('MARKET')}
            className={`h-9 text-xs font-bold rounded-md transition-colors ${marketTabView === 'MARKET' ? 'bg-emerald-400 text-[#07100c]' : 'text-slate-400 hover:text-white'}`}
          >
            Все лоты
          </button>
          <button
            onClick={() => handleMarketTabChange('MY_OFFERS')}
            className={`h-9 text-xs font-bold rounded-md transition-colors ${marketTabView === 'MY_OFFERS' ? 'bg-emerald-400 text-[#07100c]' : 'text-slate-400 hover:text-white'}`}
          >
            Мои лоты
          </button>
        </div>

        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_112px] gap-2">
          <label className="h-10 flex items-center gap-2 px-3 bg-[#090b0e] border border-slate-800 rounded-md focus-within:border-emerald-500/60">
            <Search className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <input
              type="search"
              name="market-search"
              autoComplete="off"
              value={marketSearch}
              onChange={(event) => setMarketSearch(event.target.value)}
              placeholder="Название, #ID или LOT-..."
              className="min-w-0 w-full bg-transparent outline-none text-xs text-white placeholder:text-slate-600"
            />
          </label>
          <div className="relative z-30">
            <button
              type="button"
              onClick={() => setIsMarketSortOpen(value => !value)}
              className="w-full h-10 px-2.5 flex items-center justify-between gap-1 bg-[#090b0e] border border-slate-800 rounded-md text-[11px] font-bold text-slate-300 focus:border-emerald-500/60"
              aria-haspopup="listbox"
              aria-expanded={isMarketSortOpen}
            >
              <span>{MARKET_SORT_OPTIONS.find(option => option.value === marketSort)?.label}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMarketSortOpen ? 'rotate-180' : ''}`} />
            </button>
            {isMarketSortOpen && (
              <div className="absolute right-0 top-11 w-36 overflow-hidden bg-[#15191f] border border-slate-700 rounded-md shadow-2xl" role="listbox">
                {MARKET_SORT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setMarketSort(option.value); setIsMarketSortOpen(false); }}
                    className={`w-full h-10 px-3 flex items-center gap-2 text-left text-xs font-bold hover:bg-slate-800 ${marketSort === option.value ? 'text-emerald-300 bg-emerald-400/5' : 'text-slate-300'}`}
                    role="option"
                    aria-selected={marketSort === option.value}
                  >
                    {option.value === 'RARITY_DESC' && <Gem className="w-3.5 h-3.5" />}
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 pb-24 overflow-y-auto custom-scrollbar">
        {isLoadingMarket && marketOffers.length === 0 ? (
          <div className="py-20 flex justify-center text-emerald-300"><Loader2 className="w-7 h-7 animate-spin" /></div>
        ) : visibleMarketOffers.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Store className="w-10 h-10 mx-auto mb-3 text-slate-700" />
            <div className="text-sm font-bold text-slate-400">
              {marketSearch ? 'Ничего не найдено' : marketTabView === 'MY_OFFERS' ? 'Нет активных лотов' : 'Рынок пока пуст'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {visibleMarketOffers.map((offer) => {
              const rarity = getItemRarity(offer.item);
              const style = getMarketRarityStyle(rarity);
              return (
                <article key={offer.offer_id} className={`min-w-0 overflow-hidden bg-[#12161b] border ${style.border} rounded-lg`}>
                  <button onClick={() => { void openOfferById(offer.offer_id); }} className="w-full text-left">
                    <div className={`relative aspect-[5/4] ${style.bg} border-b border-slate-800 flex items-center justify-center`}>
                      <ItemArtwork item={offer.item} className="w-20 h-20 text-5xl" />
                      <div className={`absolute left-2 top-2 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-black/45 ${style.text}`}>
                        {rarity}
                      </div>
                      {offer.visibility === 'LINK_ONLY' && (
                        <div className="absolute right-2 top-2 w-6 h-6 rounded-md bg-black/45 flex items-center justify-center" title="Только по ссылке">
                          <EyeOff className="w-3.5 h-3.5 text-slate-300" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-bold text-white truncate">{getItemName(offer.item)}</div>
                      <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[9px]">
                        <span className="text-amber-200 font-bold">{getPermanentItemId(offer.item)}</span>
                        <span className="text-slate-500 truncate">{offer.lot_code}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-amber-300 font-black text-sm min-w-0">
                          <Star className="w-3.5 h-3.5 fill-amber-300 flex-shrink-0" />
                          <span className="truncate">{formatMoney(offer.price)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-600 flex-shrink-0">
                          <Clock3 className="w-3 h-3" />
                          {formatMarketAge(offer.created_at)}
                        </div>
                      </div>
                      <div className="mt-2 text-[9px] text-slate-500 truncate">{offer.seller_name}</div>
                    </div>
                  </button>
                  {marketTabView === 'MY_OFFERS' && (
                    <button
                      onClick={() => { void handleCancelMarketOffer(offer); }}
                      disabled={isCancellingOffer}
                      className="w-full h-9 border-t border-slate-800 text-[10px] font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      {isCancellingOffer ? 'Снимаем...' : 'Снять с продажи'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderMarketOfferV2 = () => {
    if (!selectedMarketOffer) return null;
    const offer = selectedMarketOffer;
    const currentUserId = String(playerProfile?.id || '');
    const isOwnOffer = Boolean(currentUserId) && offer.seller_telegram_id === currentUserId;
    const isBoughtByCurrentUser = offer.status !== 'ACTIVE' && Boolean(currentUserId) && offer.buyer_telegram_id === currentUserId;
    const canBuy = offer.status === 'ACTIVE' && !isOwnOffer && balance >= offer.price;
    const offerLink = buildOfferLink(offer.offer_id);
    const rarity = getItemRarity(offer.item);
    const style = getMarketRarityStyle(rarity);

    return (
      <div className="flex flex-col h-full min-h-0 bg-[#0b0d10]">
        <div className="h-14 px-3 flex items-center gap-2 bg-[#111419] sticky top-0 z-10 border-b border-slate-800">
          <button onClick={() => setScreen(AppScreen.MARKET_MENU)} className="w-9 h-9 inline-flex items-center justify-center border border-slate-700 rounded-md hover:bg-slate-800" aria-label="Назад к рынку">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">Лот</div>
            <div className="text-[9px] text-emerald-300/80 font-mono truncate">{offer.lot_code}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => copyText(offerLink)} className="w-9 h-9 inline-flex items-center justify-center border border-slate-700 rounded-md hover:bg-slate-800 text-slate-300" title="Копировать ссылку" aria-label="Копировать ссылку">
              <Link2 className="w-4 h-4" />
            </button>
            <BalanceBadge balance={balance} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pb-28">
          <div className={`relative min-h-[clamp(210px,36vh,300px)] ${style.bg} border-b ${style.border} flex items-center justify-center`}>
            <div className="absolute left-4 top-4 flex items-center gap-2">
              <span className={`px-2 py-1 bg-black/45 rounded-md text-[9px] font-bold uppercase ${style.text}`}>{rarity}</span>
              {offer.visibility === 'LINK_ONLY' && (
                <span className="px-2 py-1 bg-black/45 rounded-md text-[9px] font-bold text-slate-300 flex items-center gap-1"><EyeOff className="w-3 h-3" /> По ссылке</span>
              )}
            </div>
            <ItemArtwork item={offer.item} className="w-40 h-40 text-8xl" />
          </div>

          <div className="px-4 py-4 border-b border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white break-words">{getItemName(offer.item)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="px-2 py-1 rounded bg-amber-300/10 border border-amber-300/25 text-xs text-amber-200 font-black font-mono">{getPermanentItemId(offer.item)}</span>
                  <span className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 font-mono">{offer.lot_code}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-amber-300 font-black text-xl flex-shrink-0">
                <Star className="w-5 h-5 fill-amber-300" /> {formatMoney(offer.price)}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 border-b border-slate-800">
            <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold mb-2"><Tag className="w-3.5 h-3.5" /> Описание</div>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{offer.description || 'Без описания'}</p>
          </div>

          <div className="px-4 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9px] text-slate-600 uppercase font-bold">Продавец</div>
              <div className="text-sm text-white font-bold truncate">{offer.seller_name}</div>
            </div>
            {offer.seller_show_profile_link && offer.seller_username && (
              <a href={`https://t.me/${offer.seller_username}`} target="_blank" rel="noopener noreferrer" className="h-9 px-3 inline-flex items-center gap-1.5 border border-slate-700 rounded-md text-xs text-slate-300 hover:bg-slate-800">
                @{offer.seller_username} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="telegram-safe-bottom fixed bottom-0 left-0 right-0 z-30 max-w-md mx-auto p-3 bg-[#111419]/95 backdrop-blur border-t border-slate-800">
          {offer.status !== 'ACTIVE' ? (
            <Button disabled variant="secondary" className="w-full h-12">{isBoughtByCurrentUser ? 'Куплено' : 'Лот недоступен'}</Button>
          ) : isOwnOffer ? (
            <Button onClick={() => { void handleCancelMarketOffer(offer); }} disabled={isCancellingOffer} variant="danger" className="w-full h-12">{isCancellingOffer ? 'Снимаем...' : 'Снять с продажи'}</Button>
          ) : (
            <Button onClick={handleBuySelectedOffer} disabled={!canBuy || isBuyingMarketOffer} className="w-full h-12 text-base">
              {isBuyingMarketOffer ? 'Покупка...' : (canBuy ? `Купить за ${formatMoney(offer.price)}` : 'Недостаточно звезд')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderGamesMenu = () => (
    <div className="h-full min-h-0 p-4 flex flex-col gap-4 pb-24 overflow-y-auto custom-scrollbar">
      <div className="mb-4 px-2 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">Игры</h2>
        <BalanceBadge balance={balance} />
      </div>
      
      <button 
        onClick={() => setScreen(AppScreen.CASE_LIST)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-yellow-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          📦
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">Кейсы</h3>
          <p className="text-slate-400 text-sm">Испытай удачу открывая кейсы с предметами!</p>
        </div>
      </button>

      <button 
        onClick={() => setScreen(AppScreen.ROCKET_MENU)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-purple-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          🚀
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">Ракетка</h3>
          <p className="text-slate-400 text-sm">Ставь предметы и успей забрать до краша!</p>
        </div>
      </button>

      <button 
        onClick={() => setScreen(AppScreen.UPGRADER_MENU)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-green-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Zap className="w-10 h-10 text-green-400" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">Улучшения</h3>
          <p className="text-slate-400 text-sm">Рискни предметом ради более дорогого!</p>
        </div>
      </button>

      <button
        onClick={() => setScreen(AppScreen.SLOTS_MENU)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-red-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Coins className="w-10 h-10 text-red-400" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">Слоты</h3>
          <p className="text-slate-400 text-sm">Собери 3 предмета и забери награду!</p>
        </div>
      </button>

      <button
        onClick={() => setScreen(AppScreen.PLINKO_MENU)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-cyan-400/60 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
          <CircleDotDashed className="w-11 h-11 text-cyan-300" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">Plinko</h3>
          <p className="text-slate-400 text-sm">Запусти шарик и забери предмет из выигрышной ячейки!</p>
        </div>
      </button>

      <button
        onClick={() => setScreen(AppScreen.BUSINESS_MENU)}
        className="w-full bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-blue-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 shrink-0 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Banknote className="w-10 h-10 text-blue-400" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <h3 className="text-xl font-bold text-white mb-1">{'\u0411\u0438\u0437\u043d\u0435\u0441'}</h3>
          <p className="text-slate-400 text-sm">{'\u0412\u043b\u043e\u0436\u0438\u0442\u0435 \u0437\u0432\u0435\u0437\u0434\u044b \u0438 \u043f\u043e\u043b\u0443\u0447\u0430\u0439\u0442\u0435 \u043f\u0440\u0435\u0434\u043c\u0435\u0442\u044b \u043a\u0430\u0436\u0434\u0443\u044e \u043c\u0438\u043d\u0443\u0442\u0443.'}</p>
        </div>
      </button>
    </div>
  );

  const renderBusinessMenu = () => {
    const canStart = !businessState.active;
    const parsedInvestment = Math.floor(toSafeNumber(businessInvestmentInput));
    const normalizedInvestment = Number.isFinite(parsedInvestment) ? parsedInvestment : 0;
    const hasValidInvestment = normalizedInvestment >= MIN_BUSINESS_INVESTMENT;
    const hasEnoughBalance = balance >= normalizedInvestment;
    const canStartBusiness = canStart && hasValidInvestment && hasEnoughBalance;
    const pendingReward = businessState.pendingReward;

    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
          <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-white">{'\u0411\u0438\u0437\u043d\u0435\u0441'}</h2>
          <div className="ml-auto">
            <BalanceBadge balance={balance} />
          </div>
        </div>

        <div className="p-4 pb-24 overflow-y-auto custom-scrollbar space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-bold mb-2">{'\u0412\u043a\u043b\u0430\u0434'}</div>
            <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 focus-within:border-yellow-500">
              <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={businessInvestmentInput}
                onChange={(e) => setBusinessInvestmentInput(sanitizePositiveIntegerInput(e.target.value))}
                className="bg-transparent text-white font-mono text-xl outline-none w-full"
                disabled={!canStart}
              />
            </div>
            {canStart && hasValidInvestment && !hasEnoughBalance && (
              <div className="mt-2 text-xs text-red-400 font-bold">
                {'\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u0437\u0432\u0435\u0437\u0434 \u0434\u043b\u044f \u0442\u0430\u043a\u043e\u0433\u043e \u0432\u043a\u043b\u0430\u0434\u0430'}
              </div>
            )}
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[1000, 5000, 10000, 50000].map((amount) => (
                <button
                  key={amount}
                  onClick={() => setBusinessInvestmentInput(String(amount))}
                  disabled={!canStart}
                  className="py-2 bg-slate-800 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  {amount >= 1000 ? `${amount / 1000}k` : amount}
                </button>
              ))}
            </div>

            <Button onClick={handleStartBusiness} disabled={!canStartBusiness} className="w-full mt-4 py-4 text-lg">
              {canStart ? '\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0431\u0438\u0437\u043d\u0435\u0441' : '\u0411\u0438\u0437\u043d\u0435\u0441 \u0443\u0436\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442'}
            </Button>
          </div>

          {(businessState.active || businessState.completedAt) && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase text-slate-500 font-bold">{'\u0421\u0442\u0430\u0442\u0443\u0441'}</div>
                  <div className={`font-bold ${businessState.active ? 'text-blue-300' : 'text-yellow-300'}`}>
                    {businessState.active ? '\u0412 \u0440\u0430\u0431\u043e\u0442\u0435' : '\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase text-slate-500 font-bold">{'\u0426\u0438\u043a\u043b\u043e\u0432'}</div>
                  <div className="font-bold text-white">{businessState.rewardsCount}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-slate-950 rounded-xl p-2 border border-slate-800">
                  <div className="text-[10px] uppercase text-slate-500 font-bold">{'\u0412\u043b\u043e\u0436\u0435\u043d\u043e'}</div>
                  <div className="text-yellow-400 font-bold text-sm">{formatMoney(businessState.investment)}</div>
                </div>
                <div className="bg-slate-950 rounded-xl p-2 border border-slate-800">
                  <div className="text-[10px] uppercase text-slate-500 font-bold">{'\u0417\u0430\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e'}</div>
                  <div className="text-green-400 font-bold text-sm">{formatMoney(businessState.earnedTotal)}</div>
                </div>
              </div>

              {businessState.active && !pendingReward && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-center">
                  <div className="text-xs uppercase text-slate-500 font-bold">{'\u0414\u043e \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0439 \u0432\u044b\u0434\u0430\u0447\u0438'}</div>
                  <div className="font-mono text-4xl text-white mt-2">{formatSecondsLeft(businessSecondsLeft)}</div>
                  <div className="text-xs text-slate-500 mt-1">{'\u041f\u043e\u0441\u043b\u0435 \u0442\u0430\u0439\u043c\u0435\u0440\u0430 \u0432\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u043f\u0440\u0435\u0434\u043c\u0435\u0442.'}</div>
                </div>
              )}

              {businessState.active && pendingReward && (
                <div className="bg-slate-950 border border-yellow-500/40 rounded-xl p-4">
                  <div className="text-xs uppercase text-slate-500 font-bold mb-3">{'\u041d\u043e\u0432\u044b\u0439 \u043f\u0440\u0435\u0434\u043c\u0435\u0442'}</div>
                  <div className="flex items-center gap-3">
                    <ItemArtwork item={pendingReward.item} className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-700 text-3xl" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white text-sm truncate">{getItemName(pendingReward.item)}</div>
                      <div className="text-xs text-slate-400">#{pendingReward.item.serial.toString().padStart(4, '0')}</div>
                      <div className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
                        <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(getItemPrice(pendingReward.item))}
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleClaimBusinessReward} className="w-full mt-4 py-3">
                    {'\u0417\u0430\u0431\u0440\u0430\u0442\u044c \u0438 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0442\u0430\u0439\u043c\u0435\u0440'}
                  </Button>
                </div>
              )}

              {!businessState.active && businessState.completedAt && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                  <div className="text-sm font-bold text-yellow-300 mb-2">{'\u0411\u0438\u0437\u043d\u0435\u0441 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d'}</div>
                  <div className="text-sm text-slate-300">
                    {'\u0412\u043b\u043e\u0436\u0435\u043d\u043e:'} <span className="font-bold text-white">{formatMoney(businessState.investment)}</span>
                  </div>
                  <div className="text-sm text-slate-300">
                    {'\u0417\u0430\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e:'} <span className="font-bold text-green-400">{formatMoney(businessState.earnedTotal)}</span>
                  </div>
                  <Button onClick={handleResetBusiness} variant="secondary" className="w-full mt-4 py-3">
                    {'\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u043e\u0432\u044b\u0439 \u0431\u0438\u0437\u043d\u0435\u0441'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRocketMenu = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
         <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
           <ArrowLeft className="w-5 h-5" />
         </button>
         <h2 className="text-xl font-bold text-white">Ракетка: Выбор ставки</h2>
         <div className="ml-auto">
           <BalanceBadge balance={balance} />
         </div>
      </div>

      <div className="p-4 pb-24 grid grid-cols-3 gap-3 overflow-y-auto custom-scrollbar">
          {isSellAllPending ? (
                <div className="col-span-3 py-20 text-center text-slate-500">Продажа всех предметов...</div>
            ) : inventory.length === 0 ? (
              <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                  <Box className="w-16 h-16 mb-4 opacity-50" />
                  <p>Инвентарь пуст</p>
              </div>
          ) : (
              inventory.map(item => {
                  const rarityCol = getRarityColor(getItemRarity(item));
                  return (
                      <button 
                          key={item.uniqueId}
                          onClick={() => {
                            setRocketBetItem(item);
                            setScreen(AppScreen.ROCKET_GAME);
                            setRocketState('IDLE');
                            setRocketMultiplier(1.00);
                            setRocketWinnings(null);
                          }}
                          className={`relative aspect-[4/5] rounded-xl border-2 flex flex-col items-center justify-between p-2 transition-all hover:scale-[1.02] ${rarityCol} bg-opacity-40`}
                      >
                          <ItemArtwork item={item} className="w-12 h-12 text-4xl mt-2 drop-shadow-lg" />
                          <div className="w-full text-center">
                              <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{getItemName(item)}</div>
                              <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
                                  <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(getItemPrice(item))}
                              </div>
                          </div>
                      </button>
                  );
              })
          )}
      </div>
    </div>
  );

  const renderRocketGame = () => {
    if (!rocketBetItem && rocketState === 'IDLE') {
        return <div className="p-10">Error: No bet item</div>;
    }

    return (
        <div className="flex flex-col h-screen bg-slate-950 relative overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] animate-pan" />
            
            <div className="p-4 flex items-center justify-between relative z-10">
                <button onClick={() => {
                    if(rocketState === 'FLYING') return; 
                    setScreen(AppScreen.ROCKET_MENU);
                }} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-0" disabled={rocketState === 'FLYING'}>
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <BalanceBadge balance={balance} />
            </div>

            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
                 {rocketState === 'CRASHED' ? (
                     <div className="text-center animate-in zoom-in duration-300">
                         <div className="text-6xl mb-4">💥</div>
                         <h2 className="text-4xl font-black text-red-500 uppercase tracking-widest">CRASHED</h2>
                         <div className="text-xl text-slate-400 mt-2 font-mono">{rocketMultiplier.toFixed(2)}x</div>
                     </div>
                 ) : rocketState === 'CASHED_OUT' ? (
                    <div className="text-center animate-in zoom-in duration-300">
                        <div className="text-6xl mb-4">🏆</div>
                        <h2 className="text-4xl font-black text-green-500 uppercase tracking-widest">WIN!</h2>
                        <div className="text-xl text-slate-400 mt-2 font-mono">{rocketMultiplier.toFixed(2)}x</div>
                        {rocketWinnings && (
                            <div className="mt-6 bg-slate-900/80 p-4 rounded-xl border border-green-500/30 flex flex-col items-center gap-2">
                                <span className="text-xs text-slate-400 uppercase">Выигран предмет</span>
                                <ItemArtwork item={rocketWinnings} className="w-14 h-14 text-4xl" />
                                <span className="font-bold text-white">{getItemName(rocketWinnings)}</span>
                                <span className="text-yellow-400 font-bold flex items-center gap-1 text-sm">
                                    <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(getItemPrice(rocketWinnings))}
                                </span>
                            </div>
                        )}
                    </div>
                 ) : (
                     <div className="flex flex-col items-center">
                        <div className={`text-6xl transition-transform duration-100 ${rocketState === 'FLYING' ? 'animate-bounce-slight mb-8 scale-110' : 'mb-0'}`}>
                            🚀
                        </div>
                        <div className={`font-black text-6xl tabular-nums tracking-tighter ${rocketState === 'FLYING' ? 'text-yellow-400 scale-110' : 'text-white'}`}>
                            {rocketMultiplier.toFixed(2)}x
                        </div>
                        {rocketState === 'FLYING' && (
                            <div className="text-sm text-slate-400 mt-2 font-mono">Win: {rocketBetItem ? formatMoney(getItemPrice(rocketBetItem) * rocketMultiplier) : 0}</div>
                        )}
                     </div>
                 )}
            </div>

            <div className="p-6 bg-slate-900 border-t border-slate-800 relative z-20 pb-10">
                {rocketState === 'IDLE' && rocketBetItem && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-3 bg-slate-800 p-3 rounded-xl border border-slate-700">
                            <ItemArtwork item={rocketBetItem} className="w-10 h-10 text-3xl flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold truncate">{getItemName(rocketBetItem)}</div>
                                <div className="text-xs text-yellow-400 flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400"/> {formatMoney(getItemPrice(rocketBetItem))}</div>
                            </div>
                            <div className="text-xs text-slate-500 uppercase font-bold">СТАВКА</div>
                        </div>
                        <Button onClick={startRocketGame} className="w-full py-4 text-lg bg-purple-600 hover:bg-purple-500 shadow-purple-500/20 text-white">
                            <Play className="w-5 h-5 fill-current" /> ЗАПУСТИТЬ
                        </Button>
                    </div>
                )}

                {rocketState === 'FLYING' && (
                     <Button onClick={stopRocketGame} className="w-full py-6 text-xl bg-green-600 hover:bg-green-500 shadow-green-500/20 text-white animate-pulse">
                        <StopCircle className="w-6 h-6 fill-current" /> ЗАБРАТЬ
                     </Button>
                )}

                {(rocketState === 'CRASHED' || rocketState === 'CASHED_OUT') && (
                    <Button onClick={() => setScreen(AppScreen.ROCKET_MENU)} variant="secondary" className="w-full py-4">
                        Попробовать снова
                    </Button>
                )}
            </div>
        </div>
    );
  };

  const renderUpgraderMenu = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
         <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
           <ArrowLeft className="w-5 h-5" />
         </button>
         <h2 className="text-xl font-bold text-white">Улучшения: Выбор предмета</h2>
         <div className="ml-auto">
           <BalanceBadge balance={balance} />
         </div>
      </div>

      <div className="p-4 pb-24 grid grid-cols-3 gap-3 overflow-y-auto custom-scrollbar">
          {isSellAllPending ? (
                <div className="col-span-3 py-20 text-center text-slate-500">Продажа всех предметов...</div>
            ) : inventory.length === 0 ? (
              <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                  <Box className="w-16 h-16 mb-4 opacity-50" />
                  <p>Инвентарь пуст</p>
              </div>
          ) : (
              inventory.map(item => {
                  const rarityCol = getRarityColor(getItemRarity(item));
                  return (
                      <button 
                          key={item.uniqueId}
                          onClick={() => {
                            setUpgraderBetItem(item);
                            setScreen(AppScreen.UPGRADER_SELECT_TARGET);
                          }}
                          className={`relative aspect-[4/5] rounded-xl border-2 flex flex-col items-center justify-between p-2 transition-all hover:scale-[1.02] ${rarityCol} bg-opacity-40`}
                      >
                          <ItemArtwork item={item} className="w-12 h-12 text-4xl mt-2 drop-shadow-lg" />
                          <div className="w-full text-center">
                              <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{getItemName(item)}</div>
                              <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
                                  <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(getItemPrice(item))}
                              </div>
                          </div>
                      </button>
                  );
              })
          )}
      </div>
    </div>
  );

  const renderUpgraderSelectTarget = () => {
    if (!upgraderBetItem) return null;

    const targets = ITEMS_DATA["items_db"]
        .filter(i => getItemPrice(i) > getItemPrice(upgraderBetItem))
        .sort((a, b) => getItemPrice(a) - getItemPrice(b))
        .slice(0, 10);

    return (
        <div className="flex flex-col h-full bg-slate-950">
            <div className="p-4 flex items-center gap-2 bg-slate-900 border-b border-slate-800">
                <button onClick={() => setScreen(AppScreen.UPGRADER_MENU)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-xl font-bold text-white">Выберите цель</h2>
                <div className="ml-auto">
                  <BalanceBadge balance={balance} />
                </div>
            </div>

            <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-3">
                <ItemArtwork item={upgraderBetItem} className="w-12 h-12 text-3xl bg-slate-800 rounded-lg" />
                <div>
                    <div className="text-xs text-slate-500 uppercase font-bold">Ваша ставка</div>
                    <div className="font-bold text-sm">{getItemName(upgraderBetItem)}</div>
                    <div className="text-xs text-yellow-400 font-bold">{formatMoney(getItemPrice(upgraderBetItem))} <Star className="inline w-3 h-3"/></div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {targets.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">Нет доступных улучшений (этот предмет слишком дорогой)</div>
                ) : (
                    targets.map(target => {
                        const chance = Math.min(100, ((getItemPrice(upgraderBetItem) * GAME_RTP) / getItemPrice(target)) * 100);
                        const rarityCol = getRarityColor(getItemRarity(target));
                        
                        return (
                            <button
                                key={target.id}
                                onClick={() => {
                                    setUpgraderTargetItem(target);
                                    setUpgraderRotation(0);
                                    setUpgraderSpinState('IDLE');
                                    setScreen(AppScreen.UPGRADER_GAME);
                                }}
                                className={`w-full bg-slate-900 border-l-4 rounded-r-xl p-3 flex items-center justify-between hover:bg-slate-800 transition-all active:scale-[0.98] ${rarityCol.replace('border', 'border-l')}`}
                            >
                                <div className="flex items-center gap-3">
                                    <ItemArtwork item={target} className="w-10 h-10 text-3xl flex-shrink-0" />
                                    <div className="text-left">
                                        <div className="font-bold text-sm text-white">{getItemName(target)}</div>
                                        <div className="text-xs text-yellow-400 font-bold flex items-center gap-1">
                                            {formatMoney(getItemPrice(target))} <Star className="w-3 h-3 fill-yellow-400"/>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-slate-500 uppercase font-bold">Шанс</div>
                                    <div className={`font-black text-lg ${chance < 10 ? 'text-red-400' : chance < 30 ? 'text-yellow-400' : 'text-green-400'}`}>
                                        {chance.toFixed(2)}%
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
  };

  const renderUpgraderGame = () => {
      if (!upgraderBetItem || !upgraderTargetItem) return null;

      const chance = Math.min(1, (getItemPrice(upgraderBetItem) * GAME_RTP) / getItemPrice(upgraderTargetItem));
      const percent = (chance * 100).toFixed(2);
      
      const r = 100;
      const c = 2 * Math.PI * r;
      const filledLength = c * chance;
      const gapLength = c * (1 - chance);

      return (
          <div className="flex flex-col h-screen bg-slate-950">
              <div className="p-4 flex items-center justify-between z-10">
                  <button onClick={() => {
                      if(upgraderSpinState === 'SPINNING') return;
                      setScreen(AppScreen.UPGRADER_SELECT_TARGET);
                  }} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-0" disabled={upgraderSpinState === 'SPINNING'}>
                      <ArrowLeft className="w-6 h-6" />
                  </button>
                  <BalanceBadge balance={balance} />
              </div>

              <div className="flex-1 flex flex-col items-center justify-center gap-8 relative">
                   {/* Main Wheel Container */}
                   <div className="relative w-64 h-64 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 240 240">
                            <circle cx="120" cy="120" r={r} fill="none" stroke="#1e293b" strokeWidth="20" />
                            <circle 
                                cx="120" 
                                cy="120" 
                                r={r} 
                                fill="none" 
                                stroke="#10b981" 
                                strokeWidth="20" 
                                strokeDasharray={`${filledLength} ${gapLength}`}
                                strokeLinecap="butt"
                            />
                        </svg>

                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                             {upgraderSpinState === 'WIN' ? (
                                 <div className="animate-in zoom-in text-green-500 font-black text-4xl">WIN</div>
                             ) : upgraderSpinState === 'LOSE' ? (
                                 <div className="animate-in zoom-in text-red-500 font-black text-4xl">LOSE</div>
                             ) : (
                                 <div className="text-white font-black text-3xl">{percent}%</div>
                             )}
                        </div>

                        <div 
                            className="absolute inset-0 w-full h-full"
                            style={{
                                transform: `rotate(${upgraderRotation}deg)`,
                                transition: upgraderSpinState === 'SPINNING' ? 'transform 3.5s cubic-bezier(0.15, 0.85, 0.35, 1)' : 'none'
                            }}
                            onTransitionEnd={handleUpgraderComplete}
                        >
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
                                <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[20px] border-t-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]" />
                            </div>
                        </div>
                   </div>

                   {/* Items Info */}
                   <div className="flex items-center gap-4 px-6 w-full max-w-sm">
                        <div className={`flex-1 bg-slate-900 border rounded-xl p-3 flex flex-col items-center relative ${upgraderSpinState === 'WIN' ? 'opacity-30 grayscale' : 'border-slate-700'}`}>
                             <ItemArtwork item={upgraderBetItem} className="w-11 h-11 text-3xl mb-1" />
                             <div className="text-xs font-bold text-center leading-tight">{getItemName(upgraderBetItem)}</div>
                             <div className="text-xs text-yellow-500 mt-1">{formatMoney(getItemPrice(upgraderBetItem))}</div>
                             {upgraderSpinState === 'LOSE' && <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl text-red-500 font-bold text-xl rotate-12 uppercase border-2 border-red-500">Потеряно</div>}
                        </div>
                        
                        <div className="text-slate-500"><ArrowRightIcon /></div>

                        <div className={`flex-1 bg-slate-900 border rounded-xl p-3 flex flex-col items-center relative ${upgraderSpinState === 'LOSE' ? 'opacity-30 grayscale' : 'border-green-500/50 bg-green-900/10'}`}>
                             <ItemArtwork item={upgraderTargetItem} className="w-11 h-11 text-3xl mb-1" />
                             <div className="text-xs font-bold text-center leading-tight">{getItemName(upgraderTargetItem)}</div>
                             <div className="text-xs text-yellow-500 mt-1">{formatMoney(getItemPrice(upgraderTargetItem))}</div>
                             {upgraderSpinState === 'WIN' && <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl text-green-400 font-bold text-xl -rotate-12 uppercase border-2 border-green-500">Получено</div>}
                        </div>
                   </div>
              </div>

              <div className="p-6 bg-slate-900 border-t border-slate-800 pb-10">
                   {upgraderSpinState === 'IDLE' && (
                       <Button onClick={startUpgrader} className="w-full py-4 text-xl" variant="success">
                           УЛУЧШИТЬ ({percent}%)
                       </Button>
                   )}
                   {(upgraderSpinState === 'WIN' || upgraderSpinState === 'LOSE') && (
                       <Button onClick={() => setScreen(AppScreen.UPGRADER_MENU)} variant="secondary" className="w-full">
                           {upgraderSpinState === 'WIN' ? 'Отлично' : 'В меню'}
                       </Button>
                   )}
                   {upgraderSpinState === 'SPINNING' && (
                       <Button disabled className="w-full py-4 text-xl opacity-50">
                           Крутим...
                       </Button>
                   )}
              </div>
          </div>
      );
  };

  const renderPlinkoMenu = () => (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="p-4 flex items-center gap-2 border-b border-slate-800">
        <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-white">Plinko</h2>
        <div className="ml-auto"><BalanceBadge balance={balance} /></div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <CircleDotDashed className="w-16 h-16 text-cyan-300 mx-auto mb-3" />
            <h3 className="text-3xl font-black text-white">PLINKO</h3>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
            <label className="text-xs uppercase text-slate-400 font-bold block mb-2">Ваша ставка</label>
            <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800 focus-within:border-cyan-400">
              <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              <input type="number" min={MIN_PLINKO_BET} max={MAX_PLINKO_BET} value={plinkoBetInput}
                onChange={event => setPlinkoBetInput(event.target.value)}
                className="bg-transparent text-white font-mono text-xl outline-none w-full" />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[100, 1000, 10000, 100000].map(amount => (
                <button key={amount} onClick={() => setPlinkoBetInput(String(amount))} className="py-2 bg-slate-800 rounded-md text-xs font-bold text-slate-300 hover:bg-slate-700">
                  {amount >= 1000 ? `${amount / 1000}k` : amount}
                </button>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-slate-500">Ставка от {formatMoney(MIN_PLINKO_BET)} до {formatMoney(MAX_PLINKO_BET)} звезд</div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-slate-400 font-bold">Шарики</div>
                <div className="mt-1 text-[10px] text-slate-500">Максимум {MAX_PLINKO_BALLS}</div>
              </div>
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950 overflow-hidden">
                <button type="button" onClick={() => setPlinkoBallCount(value => Math.max(1, value - 1))} disabled={plinkoBallCount <= 1} className="w-11 h-11 flex items-center justify-center text-slate-300 disabled:text-slate-700 hover:bg-slate-800" aria-label="Уменьшить количество шариков">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input type="number" min={1} max={MAX_PLINKO_BALLS} value={plinkoBallCount}
                  onChange={event => setPlinkoBallCount(Math.max(1, Math.min(MAX_PLINKO_BALLS, Math.trunc(Number(event.target.value) || 1))))}
                  className="w-14 h-11 bg-transparent border-x border-slate-800 text-center text-lg font-black text-white outline-none" aria-label="Количество шариков" />
                <button type="button" onClick={() => setPlinkoBallCount(value => Math.min(MAX_PLINKO_BALLS, value + 1))} disabled={plinkoBallCount >= MAX_PLINKO_BALLS} className="w-11 h-11 flex items-center justify-center text-slate-300 disabled:text-slate-700 hover:bg-slate-800" aria-label="Увеличить количество шариков">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4 text-sm">
              <span className="text-slate-400">Общая ставка</span>
              <span className="flex items-center gap-1 font-black text-yellow-300"><Star className="w-4 h-4 fill-yellow-300" />{formatMoney(plinkoBetValue * plinkoBallCount)}</span>
            </div>
            <Button onClick={handlePlinkoStart} disabled={plinkoState === 'LOADING'} className="w-full mt-5 py-4 text-lg">
              {plinkoState === 'LOADING' ? <Loader2 className="w-5 h-5 animate-spin" /> : plinkoBallCount === 1 ? 'ЗАПУСТИТЬ ШАРИК' : `ЗАПУСТИТЬ ×${plinkoBallCount}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPlinkoGame = () => (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      <div className="p-3 flex items-center gap-2 border-b border-slate-800 bg-slate-950 z-10">
        <button disabled={plinkoState !== 'FINISHED'} onClick={() => { setPlinkoState('IDLE'); setScreen(AppScreen.PLINKO_MENU); }} className="p-2 bg-slate-900 rounded-full disabled:opacity-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="font-bold text-white">Plinko</h2>
          <div className="text-[10px] text-slate-500">{formatMoney(plinkoBetValue)} × {plinkoBallCount} = {formatMoney(plinkoBetValue * plinkoBallCount)} звезд</div>
        </div>
        <div className="ml-auto"><BalanceBadge balance={balance} /></div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pb-6">
        <PlinkoBoard
          paths={plinkoPaths}
          prizes={plinkoPrizes}
          winningBins={plinkoBins}
          onSettled={() => setPlinkoState('FINISHED')}
        />
        <div className="min-h-24 mt-3 flex items-center justify-center text-center">
          {plinkoState === 'FINISHED' && plinkoWinItems.length > 0 ? (
            <div className="w-full bg-slate-900 border border-yellow-400/40 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-left">
                  <div className="text-[10px] uppercase font-bold text-yellow-400">Получено предметов</div>
                  <div className="text-xl font-black text-white">{plinkoWinItems.length}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Общая цена</div>
                  <div className="flex items-center justify-end gap-1 font-black text-yellow-300"><Star className="w-4 h-4 fill-yellow-300" />{formatMoney(plinkoWinItems.reduce((sum, item) => sum + getItemPrice(item), 0))}</div>
                </div>
              </div>
              <div className={`grid gap-2 ${plinkoWinItems.length === 1 ? 'grid-cols-1' : 'grid-cols-4'}`}>
                {plinkoWinItems.map(item => (
                  <div key={item.uniqueId} className="min-w-0 bg-slate-950 border border-slate-800 rounded-md p-2 flex flex-col items-center">
                    <ItemArtwork item={item} eager className="w-10 h-10 text-3xl" />
                    <div className="mt-1 w-full truncate text-[8px] font-bold text-slate-200">{getItemName(item)}</div>
                    <div className="text-[8px] text-yellow-300 flex items-center gap-0.5"><Star className="w-2.5 h-2.5 fill-yellow-300" />{formatMoney(getItemPrice(item))}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="text-sm text-cyan-200 animate-pulse">{plinkoBallCount === 1 ? 'Шарик падает...' : 'Шарики падают...'}</div>}
        </div>
        {plinkoState === 'FINISHED' && (
          <Button onClick={() => { setPlinkoState('IDLE'); setScreen(AppScreen.PLINKO_MENU); }} className="w-full py-4">ИГРАТЬ ЕЩЁ</Button>
        )}
      </div>
    </div>
  );

  const renderSlotsMenu = () => (
      <div className="flex flex-col h-full bg-slate-950">
          <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
             <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
               <ArrowLeft className="w-5 h-5" />
             </button>
             <h2 className="text-xl font-bold text-white">Слоты</h2>
             <div className="ml-auto">
               <BalanceBadge balance={balance} />
             </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-4 pb-20">
              <div className="text-center mb-8">
                  <Coins className="w-16 h-16 text-red-500 mx-auto mb-2" />
                  <h2 className="text-3xl font-black text-white uppercase">Слоты</h2>
              </div>

              <div className="w-full max-w-sm bg-slate-900 p-6 rounded-2xl border border-slate-700">
                  <label className="text-sm font-bold text-slate-400 uppercase mb-2 block">Ваша ставка</label>
                  <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 mb-4 focus-within:border-yellow-500">
                      <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                      <input 
                          type="number" 
                          value={slotsBet}
                          onChange={(e) => setSlotsBet(Math.max(1, parseInt(e.target.value) || 0))}
                          className="bg-transparent text-white font-mono text-xl outline-none w-full"
                      />
                  </div>

                  <div className="flex gap-2 mb-6">
                      {[100, 1000, 10000, 100000].map(amt => (
                          <button 
                            key={amt}
                            onClick={() => setSlotsBet(amt)}
                            className="flex-1 py-2 bg-slate-800 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-700"
                          >
                              {amt >= 1000 ? `${amt/1000}k` : amt}
                          </button>
                      ))}
                  </div>

                  <Button onClick={() => {
                      handleSlotsStart();
                  }} className="w-full py-4 text-xl">
                      ИГРАТЬ
                  </Button>
              </div>
          </div>
      </div>
  );

  const renderSlotsGame = () => {
    // Constants for reel animation
    const ITEM_HEIGHT = 160; 
    const REEL_TARGET_INDEX = 20;

    return (
        <div className="flex flex-col h-screen bg-slate-950">
             <div className="p-4 flex items-center justify-between z-10">
                <button onClick={() => {
                    if(slotsSpinState === 'SPINNING') return;
                    setScreen(AppScreen.SLOTS_MENU);
                }} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-0" disabled={slotsSpinState === 'SPINNING'}>
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-yellow-400 font-bold flex items-center gap-2 bg-slate-900 px-3 py-1 rounded-lg">
                      Ставка: {formatMoney(slotsBet)} <Star className="w-4 h-4 fill-yellow-400" />
                  </div>
                  <BalanceBadge balance={balance} />
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center p-4">
                
                {/* REELS CONTAINER */}
                <div className="flex gap-2 md:gap-4 p-4 bg-gradient-to-b from-slate-900 to-slate-950 rounded-2xl border-4 border-slate-700 shadow-2xl relative">
                    <div className="absolute top-1/2 left-0 right-0 h-1 bg-red-500/20 z-0 -translate-y-1/2" />
                    
                    {[0, 1, 2].map((reelIndex) => {
                        const strip = slotsReelStrips[reelIndex];
                        const duration = 2000 + (reelIndex * 500); // 2s, 2.5s, 3s

                        const translateY = slotsSpinState === 'PRE_SPIN' ? 0 : -(REEL_TARGET_INDEX * ITEM_HEIGHT) + (ITEM_HEIGHT * 0.2); 
                        // Offset by a bit to center the item (container height approx 1.5 * ITEM_HEIGHT)

                        return (
                          <div key={reelIndex} className="w-28 h-48 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden relative shadow-inner">
                              <div 
                                  className="w-full flex flex-col items-center"
                                  style={{
                                      transform: `translateY(${translateY}px)`,
                                      transition: slotsSpinState === 'SPINNING' || slotsSpinState === 'FINISHED' 
                                          ? `transform ${duration}ms cubic-bezier(0.1, 0.7, 0.1, 1)` 
                                          : 'none'
                                  }}
                              >
                                  {/* RENDER STRIP */}
                                  {strip.map((itemData, i) => (
                                      <div 
                                        key={i} 
                                        className="flex flex-col items-center justify-center shrink-0"
                                        style={{ height: `${ITEM_HEIGHT}px` }}
                                      >
                                          <ItemArtwork item={itemData.item} className="w-16 h-16 text-5xl mb-2 drop-shadow-lg" />
                                          <div className="text-[10px] font-bold text-slate-300 text-center leading-none px-1 line-clamp-2 max-w-full">
                                              {getItemName(itemData.item)}
                                          </div>
                                          <div className="text-[10px] text-yellow-500 font-mono mt-1">
                                              {formatMoney(getItemPrice(itemData.item))}
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                        );
                    })}
                </div>

                {/* INFO / WIN */}
                <div className="mt-8 text-center h-32 flex flex-col items-center justify-center">
                    {slotsSpinState === 'FINISHED' ? (
                        slotsWinItem ? (
                            <div className="animate-in zoom-in duration-300 fill-mode-forwards">
                                <h2 className="text-3xl font-black text-green-500 uppercase">ПОБЕДА!</h2>
                                <div className="text-white mt-1">Получен предмет:</div>
                                <div className="text-xl font-bold flex flex-col items-center justify-center text-yellow-400 mt-2 bg-slate-900 px-4 py-2 rounded-xl border border-yellow-500/50">
                                     <div className="flex items-center gap-2">
                                        <ItemArtwork item={slotsWinItem} className="w-8 h-8 text-2xl" /> {getItemName(slotsWinItem)}
                                     </div>
                                     <div className="text-sm text-slate-400 mt-1">
                                        Цена: {formatMoney(getItemPrice(slotsWinItem))}
                                     </div>
                                </div>
                            </div>
                        ) : (
                            <div className="animate-in fade-in zoom-in duration-300">
                                <h2 className="text-3xl font-black text-slate-600 uppercase">НИЧЕГО</h2>
                                <div className="text-slate-500 mt-1">Попробуйте еще раз</div>
                            </div>
                        )
                    ) : (
                        <div className="text-slate-500 text-sm max-w-xs animate-pulse">
                             Крутим...
                        </div>
                    )}
                </div>

            </div>

            <div className="p-6 bg-slate-900 border-t border-slate-800 pb-10">
                <Button 
                    onClick={() => {
                        if (slotsSpinState === 'FINISHED') {
                            setScreen(AppScreen.SLOTS_MENU);
                        }
                    }} 
                    disabled={slotsSpinState !== 'FINISHED'} 
                    className={`w-full py-4 text-xl ${slotsSpinState === 'FINISHED' && slotsWinItem ? 'bg-green-600 hover:bg-green-500' : ''} ${slotsSpinState !== 'FINISHED' ? 'opacity-0 pointer-events-none' : ''}`}
                >
                    {slotsSpinState === 'FINISHED' ? 'ИГРАТЬ СНОВА' : '...'}
                </Button>
            </div>
        </div>
    );
  }

  const renderCaseList = () => {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
           <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
             <ArrowLeft className="w-5 h-5" />
           </button>
           <h2 className="text-xl font-bold text-white">Магазин Кейсов</h2>
           <div className="ml-auto">
             <BalanceBadge balance={balance} />
           </div>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-24 space-y-6 p-4 custom-scrollbar">
          {Object.entries(casesByType).map(([type, cases]) => (
            <div key={type} className="flex flex-col gap-3">
               <div className="flex items-center justify-between px-1">
                 <h3 className="text-slate-300 font-bold uppercase tracking-wider text-sm">{type}</h3>
                 <span className="text-xs text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">{cases.length}</span>
               </div>
               
               <div className="flex overflow-x-auto gap-3 pb-4 -mx-4 px-4 snap-x hide-scrollbar">
                 {cases.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => {
                        setSelectedCase(c);
                        setScreen(AppScreen.CASE_DETAIL);
                      }}
                      className="flex-shrink-0 snap-start w-36 bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden hover:border-yellow-500/50 transition-all active:scale-95 group shadow-lg flex flex-col"
                    >
                      <div className="w-full aspect-square bg-slate-950 relative flex items-center justify-center">
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent opacity-80 z-10" />
                        <div className="z-20 transform group-hover:scale-110 transition-transform duration-500">
                          <CaseIcon emoji={c.categoryEmoji} className="text-4xl" />
                        </div>
                      </div>
                      
                      <div className="p-3 bg-slate-900 border-t border-slate-800 z-30 flex-1 flex flex-col justify-between w-full">
                        <div className="font-bold text-xs text-slate-200 leading-tight line-clamp-2 mb-2 text-left">{c.name}</div>
                        <div className="flex items-center gap-1 text-yellow-400 font-bold text-xs bg-black/30 px-2 py-1 rounded-lg w-fit">
                          <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(c.price)}
                        </div>
                      </div>
                    </button>
                 ))}
                 <div className="w-2 flex-shrink-0" />
               </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCaseDetail = () => {
    if (!selectedCase) return null;
    const isTrashCase = selectedCase.key === 'trash_case';
    const trashLimitExceeded = isTrashCase && Boolean(trashCaseLimit && openAmount > trashCaseLimit.remaining);
    const trashLimitCountdown = trashCaseLimit
      ? formatLimitCountdown(trashCaseLimit.resetsAt - trashLimitClockMs)
      : '--:--';
    
    const drops = selectedCase.items
      .map(drop => {
        const item = getItemById(drop.id);
        return item ? { ...item, chance: drop.chance_percent } : null;
      })
      .filter(Boolean) as (BaseItem & { chance: number })[];
      
    drops.sort((a,b) => b.chance - a.chance);

    return (
      <div className="flex flex-col h-full bg-slate-950 relative">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20">
          <button onClick={() => { setScreen(AppScreen.CASE_LIST); setOpenAmount(1); }} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="font-bold text-lg text-white truncate">{selectedCase.name}</h2>
          <div className="ml-auto">
            <BalanceBadge balance={balance} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-72 custom-scrollbar">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 p-8 flex flex-col items-center justify-center border-b border-slate-800 shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5" />
             <div className="z-10 animate-pulse-slow transform scale-150">
                <CaseIcon emoji={selectedCase.categoryEmoji} className="text-8xl" />
             </div>
             <div className="mt-8 flex items-center gap-2 bg-black/40 px-4 py-1 rounded-full border border-yellow-500/30 backdrop-blur-md">
               <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
               <span className="font-bold text-yellow-100 text-xl">{formatMoney(selectedCase.price)}</span>
             </div>
          </div>

          <div className="p-4">
             <h3 className="text-slate-500 text-xs uppercase font-bold mb-4 tracking-widest pl-2 border-l-2 border-yellow-500">Содержимое кейса</h3>
             <div className="space-y-2">
               {drops.map((item) => (
                 <div key={item.id} className={`flex items-center justify-between p-2 rounded-r-lg border-l-4 bg-slate-900/50 ${getRarityColor(getItemRarity(item)).replace('border', 'border-l')}`}>
                   <div className="flex items-center gap-3">
                     <ItemArtwork item={item} className="w-10 h-10 bg-slate-800 rounded text-xl shadow-inner" />
                     <div>
                       <div className="font-bold text-sm text-slate-200">{getItemName(item)}</div>
                       <div className="text-[10px] text-slate-400 uppercase tracking-wide">{getItemRarity(item)}</div>
                     </div>
                   </div>
                   <div className="text-right pr-2">
                     <div className="text-xs font-bold text-slate-400">{item.chance.toFixed(2)}%</div>
                     <div className="text-xs text-yellow-500 flex items-center justify-end gap-1">
                       {getItemPrice(item)} <Star className="w-2 h-2 fill-yellow-500" />
                     </div>
                   </div>
                 </div>
               ))}
             </div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 w-full bg-slate-900/95 backdrop-blur-md p-4 border-t border-slate-800 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-40 max-w-md mx-auto right-0">
          {isTrashCase && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200/70">Почасовой лимит</div>
                <div className="text-sm font-black text-amber-200">
                  Осталось: {isLoadingTrashCaseLimit || !trashCaseLimit ? '…' : `${trashCaseLimit.remaining}/100`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">До обновления</div>
                <div className="font-mono text-sm font-bold text-white">{trashLimitCountdown}</div>
              </div>
            </div>
          )}
          <QuantitySelector value={openAmount} onChange={setOpenAmount} />
          <Button onClick={handleOpenCase} className="w-full py-4 text-lg" disabled={isOpeningCase || balance < selectedCase.price * openAmount || (isTrashCase && (isLoadingTrashCaseLimit || !trashCaseLimit || trashLimitExceeded))}>
            {isOpeningCase ? <Loader2 className="w-5 h-5 animate-spin" /> : trashLimitExceeded ? `Осталось ${trashCaseLimit?.remaining || 0} из 100` : balance < selectedCase.price * openAmount ? "Недостаточно звезд" : (
               <span className="flex items-center gap-2">
                 Открыть {openAmount} за <Star className="w-5 h-5 fill-black" /> {formatMoney(selectedCase.price * openAmount)}
               </span>
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderDropSummary = () => {
    const totalDropValue = sumItemPrices(droppedItems);
    const isTrashCase = selectedCase?.key === 'trash_case';
    const trashRepeatBlocked = Boolean(isTrashCase && (
      isLoadingTrashCaseLimit || !trashCaseLimit || trashCaseLimit.remaining < openAmount
    ));
    return (
      <div className="telegram-full-height min-h-0 bg-slate-950 p-3 flex flex-col items-center overflow-y-auto custom-scrollbar">
        <h1 className="text-2xl font-black text-white mb-5 uppercase tracking-widest text-center drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] mt-6">
           Полученные предметы
        </h1>

        <div className="grid grid-cols-3 gap-2 w-full mb-6">
           {droppedItems.map((item, idx) => {
              const rarityCol = getRarityColor(getItemRarity(item));
              const glow = getRarityGlow(getItemRarity(item));
              
              return (
                <div key={item.uniqueId || idx} className={`relative group min-w-0 bg-slate-900 border rounded-lg p-0 flex flex-col items-center overflow-hidden animate-in zoom-in duration-500 fill-mode-backwards ${rarityCol} ${glow}`} style={{animationDelay: `${idx * 70}ms`}}>
                   <div className="relative flex min-h-0 w-full flex-1 flex-col items-center px-2 pt-3 pb-1">
                     <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
                     <ItemArtwork
                       item={item}
                       className="max-w-full shrink-0 text-5xl drop-shadow-lg z-10"
                       imageClassName="block"
                       style={{ width: 72, height: 72 }}
                     />
                     <div className="mt-auto w-full text-center z-10 pb-0.5 relative -top-1">
                       <div className="w-full font-bold text-white leading-tight text-[11px] truncate">{getItemName(item)}</div>
                       <div className="text-[9px] leading-none text-slate-400 mt-0.5 font-mono">{getPermanentItemId(item)}</div>
                     </div>
                   </div>
                   <div className="w-full shrink-0 border-t border-black/50 bg-black/55 py-2 text-yellow-400 text-xs font-bold flex items-center justify-center gap-1 z-10">
                     <Star className="w-3 h-3 fill-yellow-400 shrink-0" /> <span className="truncate">{formatMoney(getItemPrice(item))}</span>
                   </div>
                </div>
              )
           })}
         </div>

         {droppedItems.length > 1 && (
           <div className="w-full mb-5 flex items-center justify-between rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-4 py-3">
             <span className="text-xs font-black uppercase text-slate-300">Общая цена:</span>
             <span className="flex items-center gap-1.5 text-lg font-black text-yellow-300">
               <Star className="w-4 h-4 fill-yellow-300" /> {formatMoney(totalDropValue)}
             </span>
           </div>
         )}

         <div className="mt-auto w-full flex flex-col gap-3 pb-8">
           <Button onClick={() => { setScreen(AppScreen.CASE_LIST); setDroppedItems([]); setSelectedCase(null); setOpenAmount(1); }} variant="secondary" className="w-full">
             К списку кейсов
           </Button>
            {selectedCase && balance >= selectedCase.price * openAmount && (
              <Button
                onClick={() => { void handleOpenCase(); }}
                disabled={isOpeningCase || trashRepeatBlocked}
                variant={trashRepeatBlocked ? 'secondary' : 'primary'}
                className="w-full"
              >
                 {isOpeningCase
                   ? <Loader2 className="w-5 h-5 animate-spin" />
                   : trashRepeatBlocked
                     ? (trashCaseLimit?.remaining === 0 ? 'ЛИМИТ ЗАКОНЧИЛСЯ' : `ОСТАЛОСЬ ${trashCaseLimit?.remaining ?? 0} ИЗ 100`)
                     : `Открыть еще раз (${formatMoney(selectedCase.price * openAmount)})`}
              </Button>
            )}
        </div>
      </div>
    );
  }

  const renderProfile = () => {
    const sellAmount = isSellAllPending ? 0 : selectedSellValue;
    const selectedCount = selectedInventoryIds.size;
    const totalInvValue = isSellAllPending ? 0 : inventoryValueById.total;

    return (
      <div className="flex flex-col h-full bg-slate-950 relative">
        {showSellAllConfirm && createPortal(
          <div className="fixed inset-0 z-[160] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="sell-all-title">
             <div className="bg-[#111419] border border-slate-700 rounded-lg p-6 w-full max-w-sm shadow-2xl">
                <div className="flex flex-col items-center text-center gap-4">
                   <div className="w-14 h-14 bg-red-500/10 border border-red-500/30 rounded-md flex items-center justify-center mb-2">
                      <AlertTriangle className="w-8 h-8 text-red-500" />
                   </div>
                   <h3 id="sell-all-title" className="text-xl font-bold text-white">Продать весь инвентарь?</h3>
                   <p className="text-slate-400 text-sm">
                      Вы собираетесь продать <span className="text-white font-bold">{inventory.length} предметов</span> за <span className="text-yellow-400 font-bold">{formatMoney(totalInvValue)}</span> звезд. Это действие нельзя отменить.
                   </p>
                   <div className="grid grid-cols-2 gap-3 w-full mt-2">
                      <Button onClick={() => setShowSellAllConfirm(false)} variant="secondary" className="w-full">Отмена</Button>
                      <Button onClick={handleSellAll} disabled={isSellAllPending} variant="danger" className="w-full">{isSellAllPending ? 'Продаем...' : 'Продать все'}</Button>
                   </div>
                </div>
             </div>
          </div>,
          document.body,
        )}

        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <User className="w-6 h-6 text-slate-300" />
            <div className="min-w-0">
              <h2 className="font-bold text-lg text-white truncate">{playerProfile?.name || 'Профиль'}</h2>
              <div className="text-[10px] text-slate-500 uppercase">{playerProfile?.id ? 'ID: ' + playerProfile.id.slice(0, 8) : ''}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <BalanceBadge balance={balance} />
             <button
               onClick={() => {
                 setInputName(playerProfile?.name || '');
                 setInputIsPublic(playerProfile?.is_public || false);
                 setInputShowProfileLink(playerProfile?.show_profile_link || false);
                 setShowSettingsModal(true);
               }}
               className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 text-slate-300"
             >
               <Settings className="w-5 h-5" />
             </button>
          </div>
        </div>

        <div className="p-4 bg-slate-900 border-b border-slate-800 grid grid-cols-3 gap-3 items-center shadow-md z-10">
          <div>
             <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Предметов</div>
             <div className="font-bold text-2xl text-white">{inventory.length}</div>
          </div>
          <div className="flex justify-center">
            {inventory.length > 0 ? (
              <button 
                onClick={() => setShowSellAllConfirm(true)}
                className="text-xs font-bold text-red-400 hover:text-red-300 bg-red-900/20 px-3 py-2 rounded-lg border border-red-900/50 flex items-center gap-2 transition-all active:scale-95"
              >
                <Trash2 className="w-3 h-3" /> ПРОДАТЬ ВСЕ
              </button>
            ) : (
              <div className="text-xs text-slate-600">&nbsp;</div>
            )}
          </div>
          <div className="text-right">
             <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Общая стоимость</div>
             <div className="font-bold text-2xl text-yellow-400 flex items-center justify-end gap-2">
               <Star className="w-5 h-5 fill-yellow-400" /> 
               {formatMoney(totalInvValue)}
             </div>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 p-4 pb-32 grid grid-cols-3 content-start items-start gap-3 overflow-y-auto custom-scrollbar"
          style={{ gridAutoRows: '176px' }}
        >
            {isSellAllPending ? (
                <div className="col-span-3 py-20 text-center text-slate-500">Продажа всех предметов...</div>
            ) : inventory.length === 0 ? (
                <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                    <Box className="w-16 h-16 mb-4 opacity-50" />
                    <p>Инвентарь пуст</p>
                </div>
            ) : (
                inventory.map(item => {
                    return (
                        <InventoryGridItem
                            key={item.uniqueId}
                            item={item}
                            isSelected={selectedInventoryIds.has(item.uniqueId)}
                            onToggle={toggleInventorySelection}
                        />
                    );
                })
            )}
        </div>

        <div className={`fixed bottom-20 left-0 w-full bg-slate-900 border-t border-slate-800 p-4 transition-transform duration-300 max-w-md mx-auto right-0 z-30 ${selectedCount > 0 ? 'translate-y-0' : 'translate-y-[150%]'}`}>
           <div className="flex items-center justify-between mb-3">
              <div className="text-slate-400 text-sm">Выбрано: <span className="text-white font-bold">{selectedCount}</span></div>
              <button onClick={clearInventorySelection} className="text-slate-400 hover:text-white text-sm">Снять выделение</button>
           </div>
           <Button onClick={sellSelected} variant="success" className="w-full py-3 shadow-green-500/20">
               Продать за {formatMoney(sellAmount)} <Star className="w-4 h-4 fill-white" />
           </Button>
           {selectedCount === 1 && selectedSingleInventoryItem && (
             <Button onClick={openCreateOfferModal} variant="secondary" className="w-full py-3 mt-2">
               {'Выставить на продажу'}
             </Button>
           )}
        </div>
      </div>
    );
  };

  const ArrowRightIcon = () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
  );

  if (accessBlocked) {
    return (
      <div className="telegram-app-frame min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-5">
          <Ban className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-2xl font-black">Доступ заблокирован</h1>
        <p className="mt-3 text-sm text-slate-400">Вы были заблокированы администратором.</p>
      </div>
    );
  }

  if (initializationError && isTelegramUser) {
    return (
      <div className="telegram-app-frame min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center mb-5">
          <RefreshCw className="w-8 h-8 text-yellow-400" />
        </div>
        <h1 className="text-2xl font-black">Не удалось подключиться</h1>
        <p className="mt-3 text-sm text-slate-400">Профиль сохранен. Проверьте соединение и попробуйте еще раз.</p>
        <button
          type="button"
          onClick={retryInitialization}
          className="mt-6 w-full max-w-xs h-12 rounded-lg bg-yellow-500 text-black text-sm font-black uppercase flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <RefreshCw className="w-4 h-4" /> Повторить
        </button>
      </div>
    );
  }

  if (!isLoaded && !showWelcomeModal) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
          <Loader2 className="w-10 h-10 animate-spin text-yellow-500 mb-4" />
          <p className="text-slate-400">Загрузка профиля...</p>
      </div>
    )
  }

  if (isTelegramRequiredForOffer) {
    const deepLink = initialOfferId
      ? buildTelegramMiniAppUrl(encodeOfferStartParam(initialOfferId))
      : '';
    return (
      <div className="min-h-screen bg-slate-950 text-white max-w-md mx-auto p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-yellow-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Откройте в Telegram</h2>
        <p className="text-slate-400 text-sm mb-6">
          Ссылки на товары работают только внутри Telegram WebApp.
        </p>
        {deepLink ? (
          <Button
            onClick={() => {
              const tg = window.Telegram?.WebApp;
              if (tg?.openTelegramLink) tg.openTelegramLink(deepLink);
              else window.location.assign(deepLink);
            }}
            className="w-full max-w-xs"
          >
            Открыть в Telegram
          </Button>
        ) : (
          <p className="text-xs text-slate-500">Не удалось определить имя бота для deep-link.</p>
        )}
      </div>
    );
  }

  return (
    <div className={`telegram-app-frame ${isTelegramFullscreen ? 'telegram-fullscreen-guard' : ''} ${initialOfferId ? 'telegram-offer-entry' : ''} bg-slate-950 text-white font-sans selection:bg-yellow-500/30 max-w-md mx-auto relative border-x border-slate-900 shadow-2xl overflow-x-hidden overflow-y-auto`}>
      {uiToast && createPortal(
        <div className={`telegram-toast fixed left-1/2 z-[220] -translate-x-1/2 px-4 py-3 bg-[#171c22] border rounded-md shadow-2xl text-xs font-bold text-white flex items-center gap-2 ${uiToast.type === 'success' ? 'border-emerald-400/45' : 'border-red-400/55'}`} role="status">
          {uiToast.type === 'success'
            ? <Check className="w-4 h-4 text-emerald-300" />
            : <X className="w-4 h-4 text-red-400" />}
          {uiToast.message}
        </div>,
        document.body,
      )}
      {copyFallbackText && createPortal(
        <div className="fixed inset-0 z-[210] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="copy-link-title">
          <div className="w-full max-w-sm bg-[#111419] border border-slate-700 rounded-lg p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 id="copy-link-title" className="font-bold text-white">Скопировать ссылку</h3>
              <button type="button" onClick={() => setCopyFallbackText(null)} className="w-8 h-8 flex items-center justify-center border border-slate-700 rounded-md" aria-label="Закрыть"><X className="w-4 h-4" /></button>
            </div>
            <textarea readOnly value={copyFallbackText} onFocus={event => event.currentTarget.select()} rows={4} className="mt-4 w-full bg-[#090b0e] border border-slate-700 rounded-md p-3 text-xs text-slate-300 outline-none focus:border-emerald-400 resize-none" />
            <button type="button" onClick={() => { void copyText(copyFallbackText); }} className="mt-3 w-full h-11 rounded-md bg-emerald-400 text-[#07130e] text-xs font-black uppercase flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Копировать</button>
          </div>
        </div>,
        document.body,
      )}
      
      {showWelcomeModal && renderWelcomeModal()}
      {showSettingsModal && renderSettingsModal()}
      {showCreateOfferModal && renderCreateOfferModal()}

      {screen === AppScreen.GAMES_MENU && renderGamesMenu()}
      {screen === AppScreen.BUSINESS_MENU && renderBusinessMenu()}
      {screen === AppScreen.MARKET_MENU && renderMarketMenuV2()}
      {screen === AppScreen.MARKET_OFFER && renderMarketOfferV2()}
      {screen === AppScreen.CASE_LIST && renderCaseList()}
      {screen === AppScreen.CASE_DETAIL && renderCaseDetail()}
      
      {screen === AppScreen.ROULETTE && selectedCase && (
        <RouletteScreen 
            selectedCase={selectedCase} 
            droppedItems={droppedItems} 
            onComplete={handleRouletteSequenceComplete} 
        />
      )}
      
      {screen === AppScreen.DROP_SUMMARY && renderDropSummary()}
      {screen === AppScreen.PROFILE && renderProfile()}
      {screen === AppScreen.LEADERBOARD && renderLeaderboard()}
      {screen === AppScreen.PLAYER_PROFILE && renderPlayerProfile()}
      
      {screen === AppScreen.ROCKET_MENU && renderRocketMenu()}
      {screen === AppScreen.ROCKET_GAME && renderRocketGame()}

      {screen === AppScreen.UPGRADER_MENU && renderUpgraderMenu()}
      {screen === AppScreen.UPGRADER_SELECT_TARGET && renderUpgraderSelectTarget()}
      {screen === AppScreen.UPGRADER_GAME && renderUpgraderGame()}

      {screen === AppScreen.SLOTS_MENU && renderSlotsMenu()}
      {screen === AppScreen.SLOTS_GAME && renderSlotsGame()}
      {screen === AppScreen.PLINKO_MENU && renderPlinkoMenu()}
      {screen === AppScreen.PLINKO_GAME && renderPlinkoGame()}

      {/* Bottom Nav */}
      {screen !== AppScreen.ROULETTE && screen !== AppScreen.DROP_SUMMARY && screen !== AppScreen.CASE_DETAIL && screen !== AppScreen.ROCKET_GAME && screen !== AppScreen.UPGRADER_GAME && screen !== AppScreen.UPGRADER_SELECT_TARGET && screen !== AppScreen.SLOTS_GAME && screen !== AppScreen.PLINKO_GAME && screen !== AppScreen.MARKET_OFFER && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}

    </div>
  );
}




