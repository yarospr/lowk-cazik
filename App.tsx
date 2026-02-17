
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Star, ArrowLeft, User, Box, Check, Gamepad2, Trophy, Banknote, Menu, ChevronRight, Trash2, AlertTriangle, Rocket, Play, StopCircle, Info, Zap, ArrowUp, Coins, Settings, Loader2, ExternalLink, Link2 } from 'lucide-react';
import { BaseItem, Case, CaseItemDrop, InventoryItem, AppScreen, PlayerProfile } from './types';
import { ITEMS_DATA, CASES_DATA, INITIAL_BALANCE } from './constants';
import { supabase } from './supabaseClient';

// --- UTILS ---
const BUILD_MARKER = 'v5069015-r20';
const TELEGRAM_BOT_USERNAME = (((import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME as string) || '').trim().replace(/^@/, '');
const OFFER_ID_PREFIX = 'offer_';
const ALL_ITEMS = ITEMS_DATA["items_db"];
const ITEM_BY_ID = new Map<number, BaseItem>(ALL_ITEMS.map(item => [item.id, item]));
const IGNORED_NUMERIC_KEYS = new Set(['id', 'serial', 'obtainedAt', 'chance_percent', 'chance', 'payout']);
const ITEM_NAME_KEY = '\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435';
const ITEM_PRICE_KEY = '\u0446\u0435\u043d\u0430';
const ITEM_RARITY_KEY = '\u0440\u0435\u0434\u043a\u043e\u0441\u0442\u044c';
const BUSINESS_TICK_MS = 60_000;

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

const createBusinessReward = (investment: number, obtainedAt: number): BusinessRewardNotice => {
  const percent = Math.floor(Math.random() * 20) + 1;
  const targetPrice = Math.max(1, Math.floor((investment * percent) / 100));
  const closest = findClosestItemByPrice(targetPrice);

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

  const reward = createBusinessReward(state.investment, state.nextDropAt);
  const rewardPrice = getItemPrice(reward.item);
  const earnedTotal = state.earnedTotal + rewardPrice;
  const isCompleted = earnedTotal > state.targetTotal;

  return {
    nextState: {
      ...state,
      earnedTotal,
      rewardsCount: state.rewardsCount + 1,
      active: !isCompleted,
      pendingReward: isCompleted ? null : reward,
      completedAt: isCompleted ? reward.createdAt : state.completedAt,
      nextDropAt: null,
    },
    rewards: [reward],
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
type StatsDelta = {
  casesOpened?: number;
  spent?: number;
  won?: number;
};

type MarketOfferDbRow = {
  offer_id?: string;
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
    ...(record as InventoryItem),
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

const BalanceBadge = ({ balance, showMarker = false }: { balance: number; showMarker?: boolean }) => (
  <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-full border border-slate-800 shadow-inner">
    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
    <span className="font-mono font-bold text-yellow-100 text-base">{formatMoney(balance)}</span>
    {showMarker && <span className="text-[10px] text-slate-500 ml-1">{BUILD_MARKER}</span>}
  </div>
);

const Header = ({ balance }: { balance: number }) => (
  <div className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-lg border-b border-slate-800 p-4 flex justify-between items-center">
    <BalanceBadge balance={balance} showMarker />
  </div>
);

const BottomNav = ({ activeTab, onTabChange }: { activeTab: string, onTabChange: (tab: string) => void }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 pb-safe pt-2 px-4 flex justify-around items-center z-50 max-w-md mx-auto">
      <button 
        onClick={() => onTabChange('games')}
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'games' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Gamepad2 className="w-6 h-6" />
      </button>
      <button 
        onClick={() => onTabChange('leaderboard')}
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'leaderboard' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Trophy className="w-6 h-6" />
      </button>
      <button 
        onClick={() => onTabChange('profile')}
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'profile' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <User className="w-6 h-6" />
      </button>
      <button 
        onClick={() => onTabChange('market')}
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${activeTab === 'market' ? 'text-yellow-400 bg-yellow-500/10' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <Banknote className="w-6 h-6" />
      </button>

    </div>
  );
};

// --- ROULETTE COMPONENT ---

const CARD_WIDTH_PX = 112;
const MARGIN_PX = 4;
const TOTAL_SLOT_WIDTH = CARD_WIDTH_PX + (MARGIN_PX * 2);
const WINNER_INDEX = 40;
const TOTAL_ITEMS_IN_STRIP = 60;

type RouletteStripEntry = {
  item: BaseItem;
  chance: number;
};

const buildRouletteStrip = (caseData: Case, winner: BaseItem): RouletteStripEntry[] => {
  const itemChanceMap = new Map<number, number>();
  for (const drop of caseData.items) {
    itemChanceMap.set(drop.id, drop.chance_percent);
  }

  const winnerChance = itemChanceMap.get(winner.id) ?? 0;
  const strip: RouletteStripEntry[] = [];

  for (let i = 0; i < TOTAL_ITEMS_IN_STRIP; i += 1) {
    if (i === WINNER_INDEX) {
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

const Roulette: React.FC<{ caseData: Case, winner: BaseItem, onComplete: () => void }> = React.memo(({ caseData, winner, onComplete }) => {
  const [strip] = useState<RouletteStripEntry[]>(() => buildRouletteStrip(caseData, winner));
  const [isSpinning, setIsSpinning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [finalTranslate, setFinalTranslate] = useState(0);

  useEffect(() => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
    const containerCenter = containerWidth / 2;
    const winnerCenterPosition = (WINNER_INDEX * TOTAL_SLOT_WIDTH) + (TOTAL_SLOT_WIDTH / 2);
    const jitter = (Math.random() * (CARD_WIDTH_PX * 0.7)) - (CARD_WIDTH_PX * 0.35);
    const translate = containerCenter - winnerCenterPosition + jitter;

    setFinalTranslate(translate);

    const timer = window.setTimeout(() => setIsSpinning(true), 100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-44 bg-slate-950 overflow-hidden border-y-4 border-yellow-500 shadow-2xl mb-4 rounded-lg flex-shrink-0">
      <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-yellow-400 z-20 shadow-[0_0_15px_rgba(250,204,21,1)] -translate-x-1/2" />
      <div className="absolute left-1/2 top-0 -translate-x-1/2 z-20 text-yellow-400 text-2xl drop-shadow-lg">▼</div>

      <div
        className="flex h-full items-center absolute left-0 will-change-transform"
        style={{
          transform: `translate3d(${isSpinning ? finalTranslate : 0}px, 0, 0)`,
          transition: 'transform 4s cubic-bezier(0.1, 0.85, 0.1, 1)',
        }}
        onTransitionEnd={onComplete}
      >
        {strip.map(({ item, chance }, idx) => {
           const cardStyle = getRouletteCardStyle(getItemRarity(item));

           return (
            <div
              key={idx}
              className={`flex-shrink-0 flex flex-col items-center justify-between p-2 relative shadow-lg rounded-lg border-4 ${cardStyle}`}
              style={{
                width: `${CARD_WIDTH_PX}px`,
                height: '140px',
                marginLeft: `${MARGIN_PX}px`,
                marginRight: `${MARGIN_PX}px`
              }}
            >
              <div className="text-[10px] font-bold opacity-90 w-full text-right bg-black/20 px-1 rounded">{chance.toFixed(2)}%</div>
              <div className="text-5xl drop-shadow-xl my-auto">{item.emg}</div>
              <div className="w-full text-[9px] text-center leading-tight font-black bg-black/30 rounded px-1 py-1 text-white uppercase">
                {getItemName(item)}
              </div>
            </div>
           );
        })}
      </div>

      <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />
    </div>
  );
});

const NOOP = () => {};

const RouletteScreen = ({ 
  selectedCase, 
  droppedItems, 
  onComplete 
}: { 
  selectedCase: Case, 
  droppedItems: InventoryItem[], 
  onComplete: () => void 
}) => {
  
  useEffect(() => {
     const timer = setTimeout(() => {
       onComplete();
     }, 4500); 
     return () => clearTimeout(timer);
  }, []);

  return (
      <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
        <div className="p-6 text-center sticky top-0 bg-slate-900/90 z-20 backdrop-blur border-b border-slate-800">
           <h2 className="text-2xl font-black text-white uppercase tracking-widest animate-pulse">Открытие...</h2>
        </div>
        <div className="flex-1 flex flex-col items-center gap-4 p-4 pb-20 overflow-y-auto custom-scrollbar w-full">
           {droppedItems.map((item) => (
             <Roulette 
                key={item.uniqueId} 
                caseData={selectedCase} 
                winner={item} 
                onComplete={NOOP} 
             />
           ))}
        </div>
      </div>
  );
}

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
      className={`relative aspect-[4/5] rounded-xl border-2 flex flex-col items-center justify-between p-2 transition-all hover:scale-[1.02] ${isSelected ? 'border-yellow-400 bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.3)]' : `${rarityCol} bg-opacity-40`}`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 bg-yellow-400 rounded-full p-0.5 z-20">
          <Check className="w-3 h-3 text-black stroke-[3]" />
        </div>
      )}

      <div className="text-4xl mt-2 drop-shadow-lg">{item.emg}</div>

      <div className="w-full text-center">
        <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{displayName}</div>
        <div className="text-[9px] font-mono text-slate-500">#{item.serial}</div>
        <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
          <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(displayPrice)}
        </div>
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
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
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
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [selectedMarketOffer, setSelectedMarketOffer] = useState<MarketOffer | null>(null);
  const [isBuyingMarketOffer, setIsBuyingMarketOffer] = useState(false);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);
  const [createOfferItem, setCreateOfferItem] = useState<InventoryItem | null>(null);
  const [createOfferPriceInput, setCreateOfferPriceInput] = useState('0');
  const [createOfferDescription, setCreateOfferDescription] = useState('');
  const [createOfferVisibility, setCreateOfferVisibility] = useState<OfferVisibility>('PUBLIC');
  const [createdOfferLink, setCreatedOfferLink] = useState<string | null>(null);
  const [isPublishingOffer, setIsPublishingOffer] = useState(false);
  const [isCancellingOffer, setIsCancellingOffer] = useState(false);
  const [runtimeBotUsername, setRuntimeBotUsername] = useState('');
  const [isTelegramRequiredForOffer, setIsTelegramRequiredForOffer] = useState(false);
  const pendingOfferIdRef = useRef<string | null>(null);
  const didHandleInitialOfferRef = useRef(false);
  const marketReturnTimerRef = useRef<number | null>(null);
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

  // Upgrader Game State
  const [upgraderBetItem, setUpgraderBetItem] = useState<InventoryItem | null>(null);
  const [upgraderTargetItem, setUpgraderTargetItem] = useState<BaseItem | null>(null);
  const [upgraderSpinState, setUpgraderSpinState] = useState<'IDLE' | 'SPINNING' | 'WIN' | 'LOSE'>('IDLE');
  const [upgraderRotation, setUpgraderRotation] = useState(0);

  // Slots Game State
  const [slotsBet, setSlotsBet] = useState<number>(1000);
  const [slotsSpinState, setSlotsSpinState] = useState<'IDLE' | 'PRE_SPIN' | 'SPINNING' | 'FINISHED'>('IDLE');
  const [slotsWinItem, setSlotsWinItem] = useState<BaseItem | null>(null);
  const [slotsReelStrips, setSlotsReelStrips] = useState<{item: BaseItem, payout: number}[][]>([[], [], []]);
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

  const resolvedBotUsername = useMemo(() => {
    if (TELEGRAM_BOT_USERNAME) return TELEGRAM_BOT_USERNAME;
    return runtimeBotUsername.trim().replace(/^@/, '');
  }, [runtimeBotUsername]);

  const selectedSellValue = useMemo(() => {
    if (selectedInventoryIds.size === 0) return 0;
    let total = 0;
    for (const id of selectedInventoryIds) {
      total += inventoryValueById.valueById.get(id) ?? 0;
    }
    return total;
  }, [inventoryValueById, selectedInventoryIds]);

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
    const initPlayer = async () => {
      const tg = window.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      const tgUser = tg?.initDataUnsafe?.user;
      const tgChatUsername = tg?.initDataUnsafe?.chat?.username || '';
      setRuntimeBotUsername(String(tgChatUsername || '').trim().replace(/^@/, ''));
      const isTg = Boolean(tgUser?.id);
      setIsTelegramUser(isTg);
      if (initialOfferId && !isTg) {
        setIsTelegramRequiredForOffer(true);
        setIsLoaded(true);
        return;
      }
      setIsTelegramRequiredForOffer(false);
      const userId = isTg ? String(tgUser?.id) : getOrCreateLocalPlayerId();

      const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('telegram_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch player profile', error);
      }

      let row: PlayerDbRow | null = data as PlayerDbRow | null;
      if (!row) {
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

        const { data: inserted, error: insertError } = await supabase
          .from('players')
          .insert(insertPayload)
          .select('*')
          .single();

        if (insertError) {
          console.error('Failed to create player profile', insertError);
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

        row = inserted as PlayerDbRow;
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
  }, [initialOfferId]);

  const grantBusinessReward = useCallback((dropAt = Date.now()) => {
    let reward: BusinessRewardNotice | null = null;

    setBusinessState(prev => {
      if (!prev.active || prev.pendingReward || prev.nextDropAt === null) return prev;

      reward = createBusinessReward(prev.investment, dropAt);
      const rewardPrice = getItemPrice(reward.item);
      const earnedTotal = prev.earnedTotal + rewardPrice;
      const isCompleted = earnedTotal > prev.targetTotal;

      return {
        ...prev,
        earnedTotal,
        rewardsCount: prev.rewardsCount + 1,
        active: !isCompleted,
        pendingReward: !isCompleted ? reward : null,
        completedAt: isCompleted ? dropAt : prev.completedAt,
        nextDropAt: null,
      };
    });

    if (reward) {
      // Reward item is committed to inventory immediately at drop time.
      applyStatsDelta({ won: getItemPrice(reward.item) });
      setInventory(prev => [reward.item, ...prev]);
    }
  }, [applyStatsDelta]);

  const runBusinessCatchup = useCallback(() => {
    const now = Date.now();
    const snapshot = businessStateRef.current;
    const { nextState, rewards } = simulateBusinessCatchup(snapshot, now);
    if (rewards.length === 0) return;

    setBusinessState(nextState);
    const generatedItems = rewards.map(entry => entry.item).reverse();
    applyStatsDelta({ won: sumItemPrices(generatedItems) });
    setInventory(prev => [...generatedItems, ...prev]);
  }, [applyStatsDelta]);

  useEffect(() => {
    if (!playerProfile?.id) return;
    setIsBusinessHydrated(false);

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
    const { nextState, rewards } = simulateBusinessCatchup(parsed, now);
    setBusinessState(nextState);
    businessStateRef.current = nextState;
    setBusinessClockMs(now);
    if (parsed.investment > 0) {
      setBusinessInvestmentInput(String(parsed.investment));
    }

    if (rewards.length > 0) {
      const generatedItems = rewards.map(entry => entry.item).reverse();
      applyStatsDelta({ won: sumItemPrices(generatedItems) });
      setInventory(prev => [...generatedItems, ...prev]);
    }
    setIsBusinessHydrated(true);
  }, [playerProfile?.id, applyStatsDelta]);

  useEffect(() => {
    if (!playerProfile?.id || !isBusinessHydrated) return;
    const storageKey = getBusinessStorageKey(playerProfile.id);
    localStorage.setItem(storageKey, JSON.stringify(businessState));
  }, [businessState, playerProfile?.id, isBusinessHydrated]);

  useEffect(() => {
    const pending = businessState.pendingReward;
    if (!pending) return;

    setInventory(prev => {
      const exists = prev.some(item => item.uniqueId === pending.item.uniqueId);
      if (exists) return prev;
      return [pending.item, ...prev];
    });
  }, [businessState.pendingReward]);

  useEffect(() => {
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
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      setBusinessClockMs(Date.now());
      runBusinessCatchup();
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
    if (!isLoaded || !playerProfile) return;

    const timer = setTimeout(async () => {
      const { error } = await supabase
        .from('players')
        .update({
          balance: balance,
          inventory_json: inventory,
          stats_cases_opened: playerProfile.stats_cases_opened,
          stats_total_spent: playerProfile.stats_total_spent,
          stats_total_won: playerProfile.stats_total_won,
        })
        .eq('telegram_id', playerProfile.id);
      
      if (error) console.error('Error syncing:', error);
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

    const { error } = await supabase
      .from('players')
      .update(updatePayload)
      .eq('telegram_id', playerProfile.id);

    if (error) {
      alert("Ошибка регистрации: " + error.message);
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

     const { error } = await supabase
        .from('players')
        .update(updatePayload)
        .eq('telegram_id', playerProfile.id);
      
      if (error) {
        alert("Ошибка сохранения: " + error.message);
      } else {
        setPlayerProfile(updated);
        setShowSettingsModal(false);
      }
  };

  const fetchLeaderboard = async () => {
    setIsLoadingLeaderboard(true);
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('is_public', true)
      .order('balance', { ascending: false })
      .limit(10);
    
    if (!error && data) {
      const mapped = (data as PlayerDbRow[]).map((row) => {
        const profile = mapDbRowToProfile(row);
        profile.telegram_id = row.telegram_id;
        profile.telegram_username = row.username || undefined;
        return profile;
      });
      setLeaderboard(mapped);
    }
    setIsLoadingLeaderboard(false);
  };

  const openPlayerProfileById = useCallback(async (playerId: string) => {
    const normalizedPlayerId = String(playerId || '').trim();
    if (!normalizedPlayerId) return;

    setIsLoadingPlayerProfile(true);
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('telegram_id', normalizedPlayerId)
      .maybeSingle();

    if (error || !data) {
      console.error('Failed to load player profile', error);
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

    if (resolvedBotUsername) {
      const startParam = encodeOfferStartParam(normalizedOfferId);
      return `https://t.me/${resolvedBotUsername}/app?startapp=${encodeURIComponent(startParam)}`;
    }

    const url = new URL(`${window.location.origin}${window.location.pathname}`);
    url.searchParams.set('offer', normalizedOfferId);
    return url.toString();
  }, [resolvedBotUsername]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Ссылка скопирована');
    } catch {
      window.prompt('Скопируйте ссылку', text);
    }
  }, []);

  const fetchMarketOffers = useCallback(async (view: MarketViewTab = marketTabView) => {
    setIsLoadingMarket(true);
    const currentPlayerId = String(playerProfile?.id || '').trim();

    let query = supabase
      .from('market_offers')
      .select('*')
      .eq('status', 'ACTIVE');

    if (view === 'MY_OFFERS') {
      if (!currentPlayerId) {
        setMarketOffers([]);
        setIsLoadingMarket(false);
        return;
      }
      query = query.eq('seller_telegram_id', currentPlayerId);
    } else {
      query = query.eq('visibility', 'PUBLIC');
      if (currentPlayerId) {
        query = query.neq('seller_telegram_id', currentPlayerId);
      }
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) {
      console.error('Failed to fetch market offers', error);
      setIsLoadingMarket(false);
      return;
    }

    const rows = data as MarketOfferDbRow[];
    const sellerIds = Array.from(
      new Set(rows.map(row => String(row.seller_telegram_id || '')).filter(Boolean))
    );
    const sellersById = new Map<string, PlayerDbRow>();

    if (sellerIds.length > 0) {
      const { data: sellerRows, error: sellerError } = await supabase
        .from('players')
        .select('telegram_id, username, first_name, display_name, is_public, show_profile_link')
        .in('telegram_id', sellerIds);

      if (!sellerError && sellerRows) {
        for (const row of sellerRows as PlayerDbRow[]) {
          const id = String(row.telegram_id || '');
          if (!id) continue;
          sellersById.set(id, row);
        }
      }
    }

    const mapped = rows
      .map(row => mapOfferRow(row, sellersById))
      .filter(Boolean) as MarketOffer[];
    setMarketOffers(mapped);
    setIsLoadingMarket(false);
  }, [marketTabView, playerProfile?.id]);

  const fetchSingleOffer = useCallback(async (offerId: string) => {
    const { data, error } = await supabase
      .from('market_offers')
      .select('*')
      .eq('offer_id', offerId)
      .maybeSingle();

    if (error || !data) {
      console.error('Failed to fetch market offer', error);
      return null;
    }

    const offerRow = data as MarketOfferDbRow;
    const sellerId = String(offerRow.seller_telegram_id || '');
    const sellersById = new Map<string, PlayerDbRow>();

    if (sellerId) {
      const { data: seller, error: sellerError } = await supabase
        .from('players')
        .select('telegram_id, username, first_name, display_name, is_public, show_profile_link')
        .eq('telegram_id', sellerId)
        .maybeSingle();
      if (!sellerError && seller) {
        sellersById.set(sellerId, seller as PlayerDbRow);
      }
    }

    return mapOfferRow(offerRow, sellersById);
  }, []);

  const openOfferById = useCallback(async (offerId: string) => {
    const offer = await fetchSingleOffer(offerId);
    if (!offer) {
      alert('Товар не найден');
      return false;
    }
    setSelectedMarketOffer(offer);
    setScreen(AppScreen.MARKET_OFFER);
    setActiveTab('market');
    return true;
  }, [fetchSingleOffer]);

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
  }, [isPublishingOffer]);

  const handlePublishOffer = useCallback(async () => {
    if (!playerProfile || !createOfferItem) return;
    const price = Math.max(0, Math.floor(toSafeNumber(createOfferPriceInput)));
    const description = createOfferDescription.trim();
    if (!description) {
      alert('Введите описание');
      return;
    }

    const exists = inventory.some(item => item.uniqueId === createOfferItem.uniqueId);
    if (!exists) {
      alert('Предмет уже отсутствует в инвентаре');
      return;
    }

    const offerId = `offer_${generateUUID()}`;
    setIsPublishingOffer(true);

    const payload = {
      offer_id: offerId,
      seller_telegram_id: playerProfile.id,
      item_json: createOfferItem,
      price,
      description,
      visibility: createOfferVisibility,
      status: 'ACTIVE',
    };

    const { error } = await supabase.from('market_offers').insert(payload);
    if (error) {
      alert(`Ошибка публикации: ${error.message}`);
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
  ]);

  const handleCancelMarketOffer = useCallback(async (offer: MarketOffer) => {
    if (!playerProfile) return;
    if (offer.status !== 'ACTIVE') return;
    if (offer.seller_telegram_id !== playerProfile.id) return;

    setIsCancellingOffer(true);
    const { data: cancelled, error } = await supabase
      .from('market_offers')
      .update({ status: 'CANCELLED' })
      .eq('offer_id', offer.offer_id)
      .eq('seller_telegram_id', playerProfile.id)
      .eq('status', 'ACTIVE')
      .select('*')
      .maybeSingle();

    if (error || !cancelled) {
      alert('Не удалось снять товар с продажи');
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
  }, [fetchMarketOffers, marketTabView, playerProfile, selectedMarketOffer]);

  const handleBuySelectedOffer = useCallback(async () => {
    if (!selectedMarketOffer || !playerProfile) return;
    const buyerId = String(playerProfile.telegram_id || playerProfile.id || '');
    if (!buyerId) {
      alert('Не удалось определить аккаунт покупателя');
      return;
    }
    if (selectedMarketOffer.status !== 'ACTIVE') {
      alert('Товар уже недоступен');
      return;
    }
    if (selectedMarketOffer.seller_telegram_id === buyerId) {
      alert('Нельзя купить собственный товар');
      return;
    }
    if (balance < selectedMarketOffer.price) {
      alert('Недостаточно звезд');
      return;
    }

    setIsBuyingMarketOffer(true);
    const soldAt = new Date().toISOString();

    const { data: claimed, error: claimError } = await supabase
      .from('market_offers')
      .update({
        status: 'SOLD',
        buyer_telegram_id: buyerId,
        sold_at: soldAt,
      })
      .eq('offer_id', selectedMarketOffer.offer_id)
      .eq('status', 'ACTIVE')
      .select('*')
      .maybeSingle();

    if (claimError || !claimed) {
      alert('Товар уже куплен другим игроком');
      setIsBuyingMarketOffer(false);
      await fetchMarketOffers(marketTabView);
      return;
    }

    setBalance(prev => prev - selectedMarketOffer.price);
    applyStatsDelta({ spent: selectedMarketOffer.price });
    setInventory(prev => {
      const exists = prev.some(item => item.uniqueId === selectedMarketOffer.item.uniqueId);
      if (exists) return prev;
      return [selectedMarketOffer.item, ...prev];
    });

    const { data: seller, error: sellerError } = await supabase
      .from('players')
      .select('balance, stats_total_won')
      .eq('telegram_id', selectedMarketOffer.seller_telegram_id)
      .maybeSingle();

    if (!sellerError && seller) {
      const sellerBalance = Math.floor(toSafeNumber((seller as PlayerDbRow).balance));
      const sellerTotalWon = Math.floor(toSafeNumber((seller as PlayerDbRow).stats_total_won));
      await supabase
        .from('players')
        .update({
          balance: sellerBalance + selectedMarketOffer.price,
          stats_total_won: sellerTotalWon + selectedMarketOffer.price,
        })
        .eq('telegram_id', selectedMarketOffer.seller_telegram_id);
    }

    setSelectedMarketOffer(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'SOLD',
        buyer_telegram_id: buyerId,
        sold_at: soldAt,
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
  }, [selectedMarketOffer, playerProfile, balance, fetchMarketOffers, marketTabView, applyStatsDelta]);

  useEffect(() => {
    if (screen !== AppScreen.MARKET_MENU) return;
    fetchMarketOffers(marketTabView);
    const timer = window.setInterval(() => {
      fetchMarketOffers(marketTabView);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [screen, fetchMarketOffers, marketTabView]);

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
    else if (screen === AppScreen.GAMES_MENU || screen === AppScreen.CASE_LIST || screen === AppScreen.ROCKET_MENU || screen === AppScreen.UPGRADER_MENU || screen === AppScreen.SLOTS_MENU || screen === AppScreen.BUSINESS_MENU) setActiveTab('games');
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

  // --- SLOTS LOGIC ---
  const handleSlotsStart = () => {
    if (balance < slotsBet) {
      alert("Недостаточно звезд!");
      return;
    }

    setBalance(prev => prev - slotsBet);
    applyStatsDelta({ spent: slotsBet });
    
    // 1. Select 4 random variants based on bet multipliers for THIS spin
    const multipliers = [0.5, 1.5, 5.0, 20.0];
    const variants = multipliers.map(m => getRandomItemNearPrice(slotsBet * m));
    const variantData = variants.map(v => ({ item: v, payout: getItemPrice(v) }));

    // 2. Logic for 97% RTP with Equal Chance per Item
    const sumPrices = variantData.reduce((acc, v) => acc + v.payout, 0);
    const p = (0.97 * slotsBet) / sumPrices;
    const totalWinProb = 4 * p;
    
    const r = Math.random();
    let winnerIndex = -1;

    // Determine Result
    if (r < totalWinProb) {
        const normalizedR = r / totalWinProb; // 0 to 1
        winnerIndex = Math.floor(normalizedR * 4); 
        if (winnerIndex > 3) winnerIndex = 3;
    }

    let resultIndices = [0, 0, 0];
    let isWin = false;

    if (winnerIndex !== -1) {
        // WIN
        resultIndices = [winnerIndex, winnerIndex, winnerIndex];
        isWin = true;
    } else {
        // LOSE
        const r1 = Math.floor(Math.random() * 4);
        let r2 = Math.floor(Math.random() * 4);
        while(r2 === r1) r2 = Math.floor(Math.random() * 4); 
        const r3 = Math.floor(Math.random() * 4);
        resultIndices = [r1, r2, r3];
    }

    // 3. Generate Strips for Animation
    const STRIP_LENGTH = 25;
    const TARGET_INDEX = 20;

    const newStrips = [[], [], []] as {item: BaseItem, payout: number}[][];

    for(let reel = 0; reel < 3; reel++) {
        const strip = [];
        for(let i = 0; i < STRIP_LENGTH; i++) {
            if (i === TARGET_INDEX) {
                strip.push(variantData[resultIndices[reel]]);
            } else {
                const randVar = variantData[Math.floor(Math.random() * 4)];
                strip.push(randVar);
            }
        }
        newStrips[reel] = strip;
    }

    setSlotsReelStrips(newStrips);
    setSlotsWinItem(isWin ? variantData[winnerIndex].item : null);

    setScreen(AppScreen.SLOTS_GAME);
    setSlotsSpinState('PRE_SPIN'); 

    setTimeout(() => {
        setSlotsSpinState('SPINNING');
    }, 50);

    setTimeout(() => {
        setSlotsSpinState('FINISHED');
        if (isWin) {
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
  const startUpgrader = () => {
    if (!upgraderBetItem || !upgraderTargetItem) return;
    
    setUpgraderSpinState('SPINNING');

    const chance = getItemPrice(upgraderBetItem) / getItemPrice(upgraderTargetItem);
    const winSectorDegrees = 360 * chance;
    
    const isWin = Math.random() < chance;
    
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
    
    const chance = getItemPrice(upgraderBetItem) / getItemPrice(upgraderTargetItem);
    const winSectorDegrees = 360 * chance;
    const normalizedAngle = upgraderRotation % 360;
    const isWin = normalizedAngle <= winSectorDegrees;
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
  const startRocketGame = () => {
    if (!rocketBetItem) return;
    
    setRocketState('FLYING');
    setRocketMultiplier(1.00);
    setRocketWinnings(null);
    applyStatsDelta({ spent: getItemPrice(rocketBetItem) });
    
    const r = Math.random();
    const crash = 1.00 / (1 - r);
    setRocketCrashPoint(Math.max(1.00, crash));
    
    rocketStartTimeRef.current = Date.now();
    rocketRequestRef.current = requestAnimationFrame(rocketTick);
  };

  const rocketTick = () => {
    const now = Date.now();
    const elapsed = (now - rocketStartTimeRef.current) / 1000;
    const currentMult = Math.pow(Math.E, 0.06 * elapsed);
    setRocketMultiplier(currentMult);

    if (currentMult >= rocketCrashPoint) {
       setRocketState('CRASHED');
       setInventory(prev => prev.filter(i => i.uniqueId !== rocketBetItem?.uniqueId));
       setRocketBetItem(null);
    } else {
       rocketRequestRef.current = requestAnimationFrame(rocketTick);
    }
  };

  const stopRocketGame = () => {
    if (rocketState !== 'FLYING' || !rocketBetItem) return;
    cancelAnimationFrame(rocketRequestRef.current!);
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
  const handleOpenCase = () => {
    if (!selectedCase) return;
    const totalCost = selectedCase.price * openAmount;
    
    if (balance < totalCost) {
      alert("Недостаточно звезд!");
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
    
    setDroppedItems(newItems);
    setScreen(AppScreen.ROULETTE);
  };

  const handleRouletteSequenceComplete = () => {
     setInventory(prev => [...droppedItems, ...prev]);
     setScreen(AppScreen.DROP_SUMMARY);
  };

  const sellSelected = () => {
    if (selectedInventoryIds.size === 0) return;
    const idsToSell = new Set(selectedInventoryIds);
    const totalValue = selectedSellValue;

    setInventory(prev => prev.filter(i => !idsToSell.has(i.uniqueId)));
    setBalance(prev => prev + totalValue);
    setSelectedInventoryIds(new Set());
  };

  const handleSellAll = () => {
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

    window.setTimeout(() => {
      setInventory([]);
      setBalance(prev => prev + totalValue);
      setIsSellAllPending(false);
      sellAllInFlightRef.current = false;
    }, 0);
  };

  const handleStartBusiness = () => {
    if (businessState.active) return;
    const parsed = Math.floor(toSafeNumber(businessInvestmentInput));
    const investment = Number.isFinite(parsed) ? parsed : 0;
    if (investment < 1) {
      setBusinessInvestmentInput('1');
      return;
    }
    if (balance < investment) {
      return;
    }

    const targetMultiplier = 0.8 + Math.random() * 0.6;
    const targetTotal = Math.max(1, Math.round(investment * targetMultiplier));
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

  const handleClaimBusinessReward = () => {
    setBusinessState(prev => {
      if (!prev.active || !prev.pendingReward) return prev;
      return {
        ...prev,
        pendingReward: null,
        nextDropAt: Date.now() + BUSINESS_TICK_MS,
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
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                 <Trophy className="w-6 h-6 text-yellow-500" /> Таблица Лидеров
              </h2>
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
                    <div className="w-12 h-12 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center text-2xl">
                      {item.emg}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-white truncate">{getItemName(item)}</div>
                      <div className="text-[11px] text-slate-500">{`ID: ${item.uniqueId}`}</div>
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

    return (
      <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl">
          {createdOfferLink ? (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-white">{'Товар опубликован'}</h3>
              <p className="text-xs text-slate-400 break-all">{createdOfferLink}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => copyText(createdOfferLink)} className="w-full">
                  {'Копировать'}
                </Button>
                <Button onClick={closeCreateOfferModal} variant="secondary" className="w-full">
                  {'Закрыть'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-white">{'Выставить на продажу'}</h3>
              {createOfferItem && (
                <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="text-3xl">{createOfferItem.emg}</div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-white truncate">{getItemName(createOfferItem)}</div>
                    <div className="text-xs text-slate-400">#{createOfferItem.uniqueId.slice(0, 8)}</div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{'Цена'}</label>
                <input
                  type="number"
                  min={0}
                  value={createOfferPriceInput}
                  onChange={(e) => setCreateOfferPriceInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white outline-none focus:border-yellow-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{'Описание'}</label>
                <textarea
                  value={createOfferDescription}
                  onChange={(e) => setCreateOfferDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white outline-none focus:border-yellow-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{'Доступ'}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCreateOfferVisibility('PUBLIC')}
                    className={`py-2 rounded-lg border text-xs font-bold ${createOfferVisibility === 'PUBLIC' ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-950 text-slate-300 border-slate-700'}`}
                  >
                    {'Для всех'}
                  </button>
                  <button
                    onClick={() => setCreateOfferVisibility('LINK_ONLY')}
                    className={`py-2 rounded-lg border text-xs font-bold ${createOfferVisibility === 'LINK_ONLY' ? 'bg-yellow-500 text-black border-yellow-500' : 'bg-slate-950 text-slate-300 border-slate-700'}`}
                  >
                    {'Только по ссылке'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button onClick={closeCreateOfferModal} variant="secondary" className="w-full">
                  {'Отмена'}
                </Button>
                <Button onClick={handlePublishOffer} disabled={isPublishingOffer} className="w-full">
                  {isPublishingOffer ? 'Публикуем...' : 'Опубликовать'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
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
                <div className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center text-2xl">
                  {offer.item.emg}
                </div>
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
              <div className="w-14 h-14 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-center text-3xl">
                {offer.item.emg}
              </div>
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

  const renderGamesMenu = () => (
    <div className="p-4 flex flex-col gap-4 pb-24">
      <h2 className="text-2xl font-bold text-white mb-4 px-2">Игры</h2>
      
      <button 
        onClick={() => setScreen(AppScreen.CASE_LIST)}
        className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-yellow-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          📦
        </div>
        <div className="text-left">
          <h3 className="text-xl font-bold text-white mb-1">Кейсы</h3>
          <p className="text-slate-400 text-sm">Испытай удачу открывая кейсы с предметами!</p>
        </div>
      </button>

      <button 
        onClick={() => setScreen(AppScreen.ROCKET_MENU)}
        className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-purple-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          🚀
        </div>
        <div className="text-left">
          <h3 className="text-xl font-bold text-white mb-1">Ракетка</h3>
          <p className="text-slate-400 text-sm">Ставь предметы и успей забрать до краша!</p>
        </div>
      </button>

      <button 
        onClick={() => setScreen(AppScreen.UPGRADER_MENU)}
        className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-green-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Zap className="w-10 h-10 text-green-400" />
        </div>
        <div className="text-left">
          <h3 className="text-xl font-bold text-white mb-1">Улучшения</h3>
          <p className="text-slate-400 text-sm">Рискни предметом ради более дорогого!</p>
        </div>
      </button>

      <button 
        onClick={() => setScreen(AppScreen.SLOTS_MENU)}
        className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-red-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Coins className="w-10 h-10 text-red-400" />
        </div>
        <div className="text-left">
          <h3 className="text-xl font-bold text-white mb-1">Слоты</h3>
          <p className="text-slate-400 text-sm">Собери 3 предмета и забери награду!</p>
        </div>
      </button>

      <button
        onClick={() => setScreen(AppScreen.BUSINESS_MENU)}
        className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700 hover:border-blue-500/50 transition-all active:scale-95 flex items-center gap-6 shadow-lg group"
      >
        <div className="w-20 h-20 bg-slate-950 rounded-xl flex items-center justify-center text-5xl shadow-inner group-hover:scale-110 transition-transform">
          <Banknote className="w-10 h-10 text-blue-400" />
        </div>
        <div className="text-left">
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
    const hasValidInvestment = normalizedInvestment >= 1;
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
                    <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-3xl">
                      {pendingReward.item.emg}
                    </div>
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
                          <div className="text-4xl mt-2 drop-shadow-lg">{item.emg}</div>
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
                                <span className="text-4xl">{rocketWinnings.emg}</span>
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
                            <div className="text-3xl">{rocketBetItem.emg}</div>
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
                          <div className="text-4xl mt-2 drop-shadow-lg">{item.emg}</div>
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
                <div className="w-12 h-12 flex items-center justify-center text-3xl bg-slate-800 rounded-lg">
                    {upgraderBetItem.emg}
                </div>
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
                        const chance = (getItemPrice(upgraderBetItem) / getItemPrice(target)) * 100;
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
                                    <div className="text-3xl">{target.emg}</div>
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

      const chance = getItemPrice(upgraderBetItem) / getItemPrice(upgraderTargetItem);
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
                             <div className="text-3xl mb-1">{upgraderBetItem.emg}</div>
                             <div className="text-xs font-bold text-center leading-tight">{getItemName(upgraderBetItem)}</div>
                             <div className="text-xs text-yellow-500 mt-1">{formatMoney(getItemPrice(upgraderBetItem))}</div>
                             {upgraderSpinState === 'LOSE' && <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl text-red-500 font-bold text-xl rotate-12 uppercase border-2 border-red-500">Потеряно</div>}
                        </div>
                        
                        <div className="text-slate-500"><ArrowRightIcon /></div>

                        <div className={`flex-1 bg-slate-900 border rounded-xl p-3 flex flex-col items-center relative ${upgraderSpinState === 'LOSE' ? 'opacity-30 grayscale' : 'border-green-500/50 bg-green-900/10'}`}>
                             <div className="text-3xl mb-1">{upgraderTargetItem.emg}</div>
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
                                          <div className="text-5xl mb-2 drop-shadow-lg">{itemData.item.emg}</div>
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
                                        {slotsWinItem.emg} {getItemName(slotsWinItem)}
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
                     <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center text-xl shadow-inner">
                       {item.emg}
                     </div>
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
          <QuantitySelector value={openAmount} onChange={setOpenAmount} />
          <Button onClick={handleOpenCase} className="w-full py-4 text-lg" disabled={balance < selectedCase.price * openAmount}>
            {balance < selectedCase.price * openAmount ? "Недостаточно звезд" : (
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
    return (
      <div className="min-h-screen bg-slate-950 p-4 flex flex-col items-center justify-center overflow-y-auto custom-scrollbar">
        <h1 className="text-3xl font-black text-white mb-8 uppercase tracking-widest text-center drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] mt-8">
           Полученные предметы
        </h1>

        <div className={`grid gap-4 w-full ${droppedItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} mb-8`}>
           {droppedItems.map((item, idx) => {
              const rarityCol = getRarityColor(getItemRarity(item));
              const glow = getRarityGlow(getItemRarity(item));
              
              return (
                <div key={idx} className={`relative group bg-slate-900 border-2 rounded-xl p-4 flex flex-col items-center overflow-hidden animate-in zoom-in duration-500 fill-mode-backwards ${rarityCol} ${glow}`} style={{animationDelay: `${idx * 100}ms`}}>
                   <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                   <div className="text-6xl mb-4 drop-shadow-2xl z-10">{item.emg}</div>
                   <div className="font-bold text-white z-10 text-center leading-tight text-sm">{getItemName(item)}</div>
                   <div className="text-xs text-slate-400 mt-1 font-mono z-10">#{item.serial.toString().padStart(4, '0')}</div>
                   <div className="mt-3 px-3 py-1 bg-black/40 rounded-full text-yellow-400 text-sm font-bold flex items-center gap-1 z-10 border border-yellow-500/20">
                      <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(getItemPrice(item))}
                   </div>
                </div>
              )
           })}
        </div>

        <div className="mt-auto w-full flex flex-col gap-3 pb-8">
           <Button onClick={() => { setScreen(AppScreen.CASE_LIST); setDroppedItems([]); setSelectedCase(null); setOpenAmount(1); }} variant="secondary" className="w-full">
             К списку кейсов
           </Button>
           {selectedCase && balance >= selectedCase.price * openAmount && (
             <Button onClick={() => { setDroppedItems([]); setScreen(AppScreen.ROULETTE); handleOpenCase(); }} className="w-full">
                Открыть еще раз ({formatMoney(selectedCase.price * openAmount)})
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
        {showSellAllConfirm && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
             <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                <div className="flex flex-col items-center text-center gap-4">
                   <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mb-2">
                      <AlertTriangle className="w-8 h-8 text-red-500" />
                   </div>
                   <h3 className="text-xl font-bold text-white">Вы уверены?</h3>
                   <p className="text-slate-400 text-sm">
                      Вы собираетесь продать <span className="text-white font-bold">{inventory.length} предметов</span> за <span className="text-yellow-400 font-bold">{formatMoney(totalInvValue)}</span> звезд. Это действие нельзя отменить.
                   </p>
                   <div className="grid grid-cols-2 gap-3 w-full mt-2">
                      <Button onClick={() => setShowSellAllConfirm(false)} variant="secondary" className="w-full">Отмена</Button>
                      <Button onClick={handleSellAll} disabled={isSellAllPending} variant="danger" className="w-full">{isSellAllPending ? 'Продаем...' : 'Продать все'}</Button>
                   </div>
                </div>
             </div>
          </div>
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
            <div className="hidden sm:flex items-center gap-1">
              <div className="text-[10px] text-slate-300 bg-slate-800 px-2 py-1 rounded">�: {formatMoney(playerProfile?.stats_cases_opened || 0)}</div>
              <div className="text-[10px] text-red-300 bg-slate-800 px-2 py-1 rounded">- {formatMoney(playerProfile?.stats_total_spent || 0)}</div>
              <div className="text-[10px] text-green-300 bg-slate-800 px-2 py-1 rounded">+ {formatMoney(playerProfile?.stats_total_won || 0)}</div>
            </div>
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

        <div className="p-4 pb-32 grid grid-cols-3 gap-3 overflow-y-auto custom-scrollbar">
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

  if (!isLoaded && !showWelcomeModal) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
          <Loader2 className="w-10 h-10 animate-spin text-yellow-500 mb-4" />
          <p className="text-slate-400">Загрузка профиля...</p>
      </div>
    )
  }

  if (isTelegramRequiredForOffer) {
    const deepLink = initialOfferId && resolvedBotUsername
      ? `https://t.me/${resolvedBotUsername}/app?startapp=${encodeURIComponent(encodeOfferStartParam(initialOfferId))}`
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
          <Button onClick={() => window.location.assign(deepLink)} className="w-full max-w-xs">
            Открыть в Telegram
          </Button>
        ) : (
          <p className="text-xs text-slate-500">Не удалось определить имя бота для deep-link.</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-yellow-500/30 max-w-md mx-auto relative border-x border-slate-900 shadow-2xl overflow-hidden">
      
      {showWelcomeModal && renderWelcomeModal()}
      {showSettingsModal && renderSettingsModal()}
      {showCreateOfferModal && renderCreateOfferModal()}

      {screen !== AppScreen.ROULETTE &&
        screen !== AppScreen.DROP_SUMMARY &&
        screen !== AppScreen.CASE_LIST &&
        screen !== AppScreen.CASE_DETAIL &&
        screen !== AppScreen.ROCKET_MENU &&
        screen !== AppScreen.ROCKET_GAME &&
        screen !== AppScreen.UPGRADER_MENU &&
        screen !== AppScreen.UPGRADER_SELECT_TARGET &&
        screen !== AppScreen.UPGRADER_GAME &&
        screen !== AppScreen.SLOTS_MENU &&
        screen !== AppScreen.SLOTS_GAME &&
        screen !== AppScreen.BUSINESS_MENU &&
        screen !== AppScreen.MARKET_OFFER &&
        screen !== AppScreen.PLAYER_PROFILE && (
        <Header balance={balance} />
      )}

      {screen === AppScreen.GAMES_MENU && renderGamesMenu()}
      {screen === AppScreen.BUSINESS_MENU && renderBusinessMenu()}
      {screen === AppScreen.MARKET_MENU && renderMarketMenu()}
      {screen === AppScreen.MARKET_OFFER && renderMarketOffer()}
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

      {/* Bottom Nav */}
      {screen !== AppScreen.ROULETTE && screen !== AppScreen.DROP_SUMMARY && screen !== AppScreen.CASE_DETAIL && screen !== AppScreen.ROCKET_GAME && screen !== AppScreen.UPGRADER_GAME && screen !== AppScreen.UPGRADER_SELECT_TARGET && screen !== AppScreen.SLOTS_GAME && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}

    </div>
  );
}




