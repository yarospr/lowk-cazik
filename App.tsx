
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Star, ArrowLeft, User, Box, Check, Gamepad2, Trophy, Banknote, Menu, ChevronRight, Trash2, AlertTriangle, Rocket, Play, StopCircle, Info, Zap, ArrowUp, Coins, Settings, Loader2, ExternalLink } from 'lucide-react';
import { BaseItem, Case, CaseItemDrop, InventoryItem, AppScreen, PlayerProfile } from './types';
import { ITEMS_DATA, CASES_DATA, INITIAL_BALANCE } from './constants';
import { supabase } from './supabaseClient';

// --- UTILS ---
const BUILD_MARKER = 'v5069015-r3';

const getItemById = (id: number): BaseItem | undefined => {
  return ITEMS_DATA["items_db"].find((i) => i.id === id);
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
const getItemPrice = (item: Partial<BaseItem> | InventoryItem | null | undefined): number => {
  if (!item) return 0;
  const record = item as Record<string, unknown>;
  const directPrice = toSafeNumber(record.price);
  if (directPrice > 0) return directPrice;
  const ignoredNumericKeys = new Set(['id', 'serial', 'obtainedAt', 'chance_percent', 'chance', 'payout']);
  for (const [key, value] of Object.entries(record)) {
    if (ignoredNumericKeys.has(key)) continue;
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

const getRandomItemFromCase = (c: Case): CaseItemDrop => {
  let random = Math.random() * 100;
  let accumulator = 0;
  for (const item of c.items) {
    accumulator += item.chance_percent;
    if (random <= accumulator) {
      return item;
    }
  }
  return c.items[c.items.length - 1];
};

const findClosestItemByPrice = (targetPrice: number): BaseItem => {
  const allItems = ITEMS_DATA["items_db"];
  if (!allItems || allItems.length === 0) throw new Error("No items DB");
  
  return allItems.reduce((prev, curr) => {
    return (Math.abs(curr.цена - targetPrice) < Math.abs(prev.цена - targetPrice) ? curr : prev);
  });
};

const getRandomItemNearPrice = (targetPrice: number): BaseItem => {
  const allItems = ITEMS_DATA["items_db"];
  // Range: 0.7x to 1.3x price
  const candidates = allItems.filter(i => i.цена >= targetPrice * 0.7 && i.цена <= targetPrice * 1.3);
  
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

type TelegramWebAppState = {
  initDataUnsafe?: {
    user?: TelegramUser;
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
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppState;
    };
  }
}

const LOCAL_PLAYER_ID_KEY = 'ccc_player_uuid';

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

const Header = ({ balance }: { balance: number }) => (
  <div className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-lg border-b border-slate-800 p-4 flex justify-between items-center">
    <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-800 shadow-inner">
      <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
      <span className="font-mono font-bold text-yellow-100 text-lg">{formatMoney(balance)}</span>
      <span className="text-[10px] text-slate-500 ml-2">{BUILD_MARKER}</span>
    </div>
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
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all text-slate-700 cursor-not-allowed`}
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

const Roulette: React.FC<{ caseData: Case, winner: BaseItem, onComplete: () => void }> = ({ caseData, winner, onComplete }) => {
  const [strip, setStrip] = useState<BaseItem[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [finalTranslate, setFinalTranslate] = useState(0);

  const itemChanceMap = useMemo(() => {
    const map = new Map<number, number>();
    caseData.items.forEach(i => map.set(i.id, i.chance_percent));
    return map;
  }, [caseData]);

  useEffect(() => {
    const newStrip: BaseItem[] = [];
    for (let i = 0; i < TOTAL_ITEMS_IN_STRIP; i++) {
      if (i === WINNER_INDEX) {
        newStrip.push(winner);
      } else {
        const randomDrop = getRandomItemFromCase(caseData);
        const item = getItemById(randomDrop.id);
        newStrip.push(item || winner);
      }
    }
    setStrip(newStrip);

    const containerWidth = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
    const containerCenter = containerWidth / 2;
    const winnerCenterPosition = (WINNER_INDEX * TOTAL_SLOT_WIDTH) + (TOTAL_SLOT_WIDTH / 2);
    const jitter = (Math.random() * (CARD_WIDTH_PX * 0.7)) - (CARD_WIDTH_PX * 0.35);
    const translate = containerCenter - winnerCenterPosition + jitter;
    
    setFinalTranslate(translate);

    const timer = setTimeout(() => setIsSpinning(true), 100);
    return () => clearTimeout(timer);
  }, [caseData, winner]);

  return (
    <div ref={containerRef} className="relative w-full h-44 bg-slate-950 overflow-hidden border-y-4 border-yellow-500 shadow-2xl mb-4 rounded-lg flex-shrink-0">
      <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-yellow-400 z-20 shadow-[0_0_15px_rgba(250,204,21,1)] -translate-x-1/2" />
      <div className="absolute left-1/2 top-0 -translate-x-1/2 z-20 text-yellow-400 text-2xl drop-shadow-lg">▼</div>

      <div 
        className="flex h-full items-center absolute left-0 will-change-transform"
        style={{
          transform: `translateX(${isSpinning ? finalTranslate : 0}px)`,
          transition: 'transform 4s cubic-bezier(0.1, 0.85, 0.1, 1)', 
        }}
        onTransitionEnd={onComplete}
      >
        {strip.map((item, idx) => {
           const cardStyle = getRouletteCardStyle(item.редкость);
           const chance = itemChanceMap.get(item.id) || 0;
           
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
                {item.название}
              </div>
            </div>
           );
        })}
      </div>
      
      <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />
    </div>
  );
};

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
                onComplete={() => {}} 
             />
           ))}
        </div>
      </div>
  );
}

const QuantitySelector = ({ value, onChange }: { value: number, onChange: (val: number) => void }) => {
  const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  
  return (
    <div className="relative bg-slate-800 rounded-xl p-2 flex justify-between mb-4 overflow-hidden">
      <div 
        className="absolute top-1 bottom-1 bg-yellow-500 rounded-lg transition-all duration-300 ease-out shadow-[0_0_15px_rgba(234,179,8,0.5)]"
        style={{ 
          left: `${((value - 1) * 10)}%`, 
          width: '10%' 
        }}
      />
      
      {options.map((num) => (
        <button
          key={num}
          onClick={() => onChange(num)}
          className={`relative z-10 flex-1 h-10 flex items-center justify-center font-bold text-sm transition-colors ${value === num ? 'text-black' : 'text-slate-400 hover:text-white'}`}
        >
          {num}
        </button>
      ))}
    </div>
  );
};

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

  // --- INITIALIZATION ---
  useEffect(() => {
    const initPlayer = async () => {
      const tg = window.Telegram?.WebApp;
      tg?.ready?.();
      tg?.expand?.();
      const tgUser = tg?.initDataUnsafe?.user;
      const isTg = Boolean(tgUser?.id);
      setIsTelegramUser(isTg);
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
          });
          setBalance(INITIAL_BALANCE);
          setInventory([]);
          setInputName(tgUser?.first_name || '');
          setInputIsPublic(isTg);
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
      setShowWelcomeModal(!registeredName);
      setIsLoaded(true);
    };

    initPlayer();
  }, []);

  // --- SYNC TO DB ---
  useEffect(() => {
    if (!isLoaded || !playerProfile) return;

    const timer = setTimeout(async () => {
      const { error } = await supabase
        .from('players')
        .update({
          balance: balance,
          inventory_json: inventory
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

    const newProfile = {
      ...playerProfile,
      name: inputName.trim(),
      is_public: isTelegramUser ? inputIsPublic : false,
    };

    const { error } = await supabase
      .from('players')
      .update({
        display_name: inputName.trim(),
        is_public: isTelegramUser ? inputIsPublic : false,
      })
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
     
     const updated = {
       ...playerProfile,
       name: inputName.trim(),
       is_public: isTelegramUser ? inputIsPublic : false
     };

     const { error } = await supabase
        .from('players')
        .update({
          display_name: inputName.trim(),
          is_public: isTelegramUser ? inputIsPublic : false
        })
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

  useEffect(() => {
    if (screen === AppScreen.PROFILE) setActiveTab('profile');
    else if (screen === AppScreen.LEADERBOARD) {
      setActiveTab('leaderboard');
      fetchLeaderboard();
    }
    else if (screen === AppScreen.GAMES_MENU || screen === AppScreen.CASE_LIST || screen === AppScreen.ROCKET_MENU || screen === AppScreen.UPGRADER_MENU || screen === AppScreen.SLOTS_MENU) setActiveTab('games');
  }, [screen]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'games') setScreen(AppScreen.GAMES_MENU);
    if (tab === 'profile') setScreen(AppScreen.PROFILE);
    if (tab === 'leaderboard') setScreen(AppScreen.LEADERBOARD);
  };

  // --- SLOTS LOGIC ---
  const handleSlotsStart = () => {
    if (balance < slotsBet) {
      alert("Недостаточно звезд!");
      return;
    }

    setBalance(prev => prev - slotsBet);
    
    // 1. Select 4 random variants based on bet multipliers for THIS spin
    const multipliers = [0.5, 1.5, 5.0, 20.0];
    const variants = multipliers.map(m => getRandomItemNearPrice(slotsBet * m));
    const variantData = variants.map(v => ({ item: v, payout: v.цена }));

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
            setInventory(prev => [newItem, ...prev]);
        }
    }, 3500);
  };

  // --- UPGRADER LOGIC ---
  const startUpgrader = () => {
    if (!upgraderBetItem || !upgraderTargetItem) return;
    
    setUpgraderSpinState('SPINNING');

    const chance = upgraderBetItem.цена / upgraderTargetItem.цена;
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
    
    const chance = upgraderBetItem.цена / upgraderTargetItem.цена;
    const winSectorDegrees = 360 * chance;
    const normalizedAngle = upgraderRotation % 360;
    const isWin = normalizedAngle <= winSectorDegrees;

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
    
    const winValue = rocketBetItem.цена * rocketMultiplier;
    const wonItemBase = findClosestItemByPrice(winValue);
    
    const wonItem: InventoryItem = {
      ...wonItemBase,
      uniqueId: generateUUID(),
      serial: generateSerial(),
      obtainedAt: Date.now()
    };
    
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
    
    setDroppedItems(newItems);
    setScreen(AppScreen.ROULETTE);
  };

  const handleRouletteSequenceComplete = () => {
     setInventory(prev => [...droppedItems, ...prev]);
     setScreen(AppScreen.DROP_SUMMARY);
  };

  const sellSelected = () => {
    const itemsToSell = inventory.filter(i => selectedInventoryIds.has(i.uniqueId));
    const totalValue = sumItemPrices(itemsToSell);
    
    setInventory(prev => prev.filter(i => !selectedInventoryIds.has(i.uniqueId)));
    setBalance(prev => prev + totalValue);
    setSelectedInventoryIds(new Set());
  };

  const handleSellAll = () => {
    if (isSellAllPending) return;
    if (inventory.length === 0) {
      setShowSellAllConfirm(false);
      return;
    }

    setIsSellAllPending(true);
    setSelectedInventoryIds(new Set());
    setShowSellAllConfirm(false);

    try {
      const totalValue = sumItemPrices(inventory);
      setInventory([]);
      setBalance(prev => prev + totalValue);
    } catch (error) {
      console.error('Failed to sell all inventory items', error);
    } finally {
      setIsSellAllPending(false);
    }
  };
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
             
             {isTelegramUser && (
               <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input 
                    type="checkbox"
                    id="isPublic"
                    checked={inputIsPublic}
                    onChange={(e) => setInputIsPublic(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-yellow-500"
                  />
                  <label htmlFor="isPublic" className="text-sm text-slate-300">
                    Показывать ссылку на мой Telegram в таблице лидеров
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
             
             {isTelegramUser && (
               <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <input 
                    type="checkbox"
                    id="isPublicEdit"
                    checked={inputIsPublic}
                    onChange={(e) => setInputIsPublic(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-yellow-500"
                  />
                  <label htmlFor="isPublicEdit" className="text-sm text-slate-300">
                    Показывать ссылку на Telegram в таблице лидеров
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
                                   {p.is_public && p.telegram_username ? (
                                      <a href={`https://t.me/${p.telegram_username}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-400 transition-colors">
                                         {p.name} <ExternalLink className="w-3 h-3" />
                                      </a>
                                   ) : (
                                      p.name || 'Unknown'
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
    </div>
  );

  const renderRocketMenu = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2 bg-slate-950 sticky top-0 z-10 border-b border-slate-800">
         <button onClick={() => setScreen(AppScreen.GAMES_MENU)} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800">
           <ArrowLeft className="w-5 h-5" />
         </button>
         <h2 className="text-xl font-bold text-white">Ракетка: Выбор ставки</h2>
      </div>

      <div className="p-4 pb-24 grid grid-cols-3 gap-3 overflow-y-auto custom-scrollbar">
          {isSellAllPending ? (
                <div className="col-span-3 py-20 text-center text-slate-500">������� ���� ���������...</div>
            ) : inventory.length === 0 ? (
              <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                  <Box className="w-16 h-16 mb-4 opacity-50" />
                  <p>Инвентарь пуст</p>
              </div>
          ) : (
              inventory.map(item => {
                  const rarityCol = getRarityColor(item.редкость);
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
                              <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{item.название}</div>
                              <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
                                  <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(item.цена)}
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
                                <span className="font-bold text-white">{rocketWinnings.название}</span>
                                <span className="text-yellow-400 font-bold flex items-center gap-1 text-sm">
                                    <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(rocketWinnings.цена)}
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
                            <div className="text-sm text-slate-400 mt-2 font-mono">Win: {rocketBetItem ? formatMoney(rocketBetItem.цена * rocketMultiplier) : 0}</div>
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
                                <div className="text-sm font-bold truncate">{rocketBetItem.название}</div>
                                <div className="text-xs text-yellow-400 flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400"/> {formatMoney(rocketBetItem.цена)}</div>
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
      </div>

      <div className="p-4 pb-24 grid grid-cols-3 gap-3 overflow-y-auto custom-scrollbar">
          {isSellAllPending ? (
                <div className="col-span-3 py-20 text-center text-slate-500">������� ���� ���������...</div>
            ) : inventory.length === 0 ? (
              <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                  <Box className="w-16 h-16 mb-4 opacity-50" />
                  <p>Инвентарь пуст</p>
              </div>
          ) : (
              inventory.map(item => {
                  const rarityCol = getRarityColor(item.редкость);
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
                              <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{item.название}</div>
                              <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
                                  <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(item.цена)}
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
        .filter(i => i.цена > upgraderBetItem.цена)
        .sort((a, b) => a.цена - b.цена)
        .slice(0, 10);

    return (
        <div className="flex flex-col h-full bg-slate-950">
            <div className="p-4 flex items-center gap-2 bg-slate-900 border-b border-slate-800">
                <button onClick={() => setScreen(AppScreen.UPGRADER_MENU)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-xl font-bold text-white">Выберите цель</h2>
            </div>

            <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-3">
                <div className="w-12 h-12 flex items-center justify-center text-3xl bg-slate-800 rounded-lg">
                    {upgraderBetItem.emg}
                </div>
                <div>
                    <div className="text-xs text-slate-500 uppercase font-bold">Ваша ставка</div>
                    <div className="font-bold text-sm">{upgraderBetItem.название}</div>
                    <div className="text-xs text-yellow-400 font-bold">{formatMoney(upgraderBetItem.цена)} <Star className="inline w-3 h-3"/></div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {targets.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">Нет доступных улучшений (этот предмет слишком дорогой)</div>
                ) : (
                    targets.map(target => {
                        const chance = (upgraderBetItem.цена / target.цена) * 100;
                        const rarityCol = getRarityColor(target.редкость);
                        
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
                                        <div className="font-bold text-sm text-white">{target.название}</div>
                                        <div className="text-xs text-yellow-400 font-bold flex items-center gap-1">
                                            {formatMoney(target.цена)} <Star className="w-3 h-3 fill-yellow-400"/>
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

      const chance = upgraderBetItem.цена / upgraderTargetItem.цена;
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
                             <div className="text-xs font-bold text-center leading-tight">{upgraderBetItem.название}</div>
                             <div className="text-xs text-yellow-500 mt-1">{formatMoney(upgraderBetItem.цена)}</div>
                             {upgraderSpinState === 'LOSE' && <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl text-red-500 font-bold text-xl rotate-12 uppercase border-2 border-red-500">Потеряно</div>}
                        </div>
                        
                        <div className="text-slate-500"><ArrowRightIcon /></div>

                        <div className={`flex-1 bg-slate-900 border rounded-xl p-3 flex flex-col items-center relative ${upgraderSpinState === 'LOSE' ? 'opacity-30 grayscale' : 'border-green-500/50 bg-green-900/10'}`}>
                             <div className="text-3xl mb-1">{upgraderTargetItem.emg}</div>
                             <div className="text-xs font-bold text-center leading-tight">{upgraderTargetItem.название}</div>
                             <div className="text-xs text-yellow-500 mt-1">{formatMoney(upgraderTargetItem.цена)}</div>
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
                <div className="font-mono text-yellow-400 font-bold flex items-center gap-2 bg-slate-900 px-3 py-1 rounded-lg">
                    Ставка: {formatMoney(slotsBet)} <Star className="w-4 h-4 fill-yellow-400" />
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
                                              {itemData.item.название}
                                          </div>
                                          <div className="text-[10px] text-yellow-500 font-mono mt-1">
                                              {formatMoney(itemData.item.цена)}
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
                                        {slotsWinItem.emg} {slotsWinItem.название}
                                     </div>
                                     <div className="text-sm text-slate-400 mt-1">
                                        Цена: {formatMoney(slotsWinItem.цена)}
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
                 <div key={item.id} className={`flex items-center justify-between p-2 rounded-r-lg border-l-4 bg-slate-900/50 ${getRarityColor(item.редкость).replace('border', 'border-l')}`}>
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center text-xl shadow-inner">
                       {item.emg}
                     </div>
                     <div>
                       <div className="font-bold text-sm text-slate-200">{item.название}</div>
                       <div className="text-[10px] text-slate-400 uppercase tracking-wide">{item.редкость}</div>
                     </div>
                   </div>
                   <div className="text-right pr-2">
                     <div className="text-xs font-bold text-slate-400">{item.chance.toFixed(2)}%</div>
                     <div className="text-xs text-yellow-500 flex items-center justify-end gap-1">
                       {item.цена} <Star className="w-2 h-2 fill-yellow-500" />
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
              const rarityCol = getRarityColor(item.редкость);
              const glow = getRarityGlow(item.редкость);
              
              return (
                <div key={idx} className={`relative group bg-slate-900 border-2 rounded-xl p-4 flex flex-col items-center overflow-hidden animate-in zoom-in duration-500 fill-mode-backwards ${rarityCol} ${glow}`} style={{animationDelay: `${idx * 100}ms`}}>
                   <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                   <div className="text-6xl mb-4 drop-shadow-2xl z-10">{item.emg}</div>
                   <div className="font-bold text-white z-10 text-center leading-tight text-sm">{item.название}</div>
                   <div className="text-xs text-slate-400 mt-1 font-mono z-10">#{item.serial.toString().padStart(4, '0')}</div>
                   <div className="mt-3 px-3 py-1 bg-black/40 rounded-full text-yellow-400 text-sm font-bold flex items-center gap-1 z-10 border border-yellow-500/20">
                      <Star className="w-3 h-3 fill-yellow-400" /> {formatMoney(item.цена)}
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
    const sellAmount = isSellAllPending ? 0 : sumItemPrices(inventory.filter(i => selectedInventoryIds.has(i.uniqueId)));
    const selectedCount = selectedInventoryIds.size;
    const totalInvValue = isSellAllPending ? 0 : sumItemPrices(inventory);

    const toggleSelection = (id: string) => {
      const newSet = new Set(selectedInventoryIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedInventoryIds(newSet);
    };

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
                      <Button onClick={handleSellAll} disabled={isSellAllPending} variant="danger" className="w-full">{isSellAllPending ? '�������...' : '������� ���'}</Button>
                   </div>
                </div>
             </div>
          </div>
        )}

        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <User className="w-6 h-6 text-slate-300" />
            <div>
              <h2 className="font-bold text-lg text-white">{playerProfile?.name || 'Профиль'}</h2>
              <div className="text-[10px] text-slate-500 uppercase">{playerProfile?.id ? 'ID: ' + playerProfile.id.slice(0, 8) : ''}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             <button
               onClick={() => {
                 setInputName(playerProfile?.name || '');
                 setInputIsPublic(playerProfile?.is_public || false);
                 setShowSettingsModal(true);
               }}
               className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 text-slate-300"
             >
               <Settings className="w-5 h-5" />
             </button>

             {inventory.length > 0 && (
                <button 
                    onClick={() => setShowSellAllConfirm(true)}
                    className="text-xs font-bold text-red-400 hover:text-red-300 bg-red-900/20 px-3 py-1.5 rounded-lg border border-red-900/50 flex items-center gap-2 transition-all active:scale-95 h-9"
                >
                    <Trash2 className="w-3 h-3" /> ПРОДАТЬ ВСЕ
                </button>
             )}
          </div>
        </div>

        <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center shadow-md z-10">
          <div>
             <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Предметов</div>
             <div className="font-bold text-2xl text-white">{inventory.length}</div>
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
                <div className="col-span-3 py-20 text-center text-slate-500">������� ���� ���������...</div>
            ) : inventory.length === 0 ? (
                <div className="col-span-3 py-20 text-center text-slate-600 flex flex-col items-center">
                    <Box className="w-16 h-16 mb-4 opacity-50" />
                    <p>Инвентарь пуст</p>
                </div>
            ) : (
                inventory.map(item => {
                    const isSelected = selectedInventoryIds.has(item.uniqueId);
                    const rarityCol = getRarityColor(item.редкость);
                    
                    return (
                        <button 
                            key={item.uniqueId}
                            onClick={() => toggleSelection(item.uniqueId)}
                            className={`relative aspect-[4/5] rounded-xl border-2 flex flex-col items-center justify-between p-2 transition-all hover:scale-[1.02] ${isSelected ? 'border-yellow-400 bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.3)]' : `${rarityCol} bg-opacity-40`}`}
                        >
                            {isSelected && (
                                <div className="absolute top-2 right-2 bg-yellow-400 rounded-full p-0.5 z-20">
                                    <Check className="w-3 h-3 text-black stroke-[3]" />
                                </div>
                            )}
                            
                            <div className="text-4xl mt-2 drop-shadow-lg">{item.emg}</div>
                            
                            <div className="w-full text-center">
                                <div className="text-[10px] font-bold text-slate-300 truncate leading-tight mb-1">{item.название}</div>
                                <div className="text-[9px] font-mono text-slate-500">#{item.serial}</div>
                                <div className="mt-1 text-xs font-bold text-yellow-400 flex items-center justify-center gap-0.5 bg-black/30 rounded py-0.5">
                                    <Star className="w-2.5 h-2.5 fill-yellow-400" /> {formatMoney(item.цена)}
                                </div>
                            </div>
                        </button>
                    );
                })
            )}
        </div>

        <div className={`fixed bottom-20 left-0 w-full bg-slate-900 border-t border-slate-800 p-4 transition-transform duration-300 max-w-md mx-auto right-0 z-30 ${selectedCount > 0 ? 'translate-y-0' : 'translate-y-[150%]'}`}>
           <div className="flex items-center justify-between mb-3">
              <div className="text-slate-400 text-sm">Выбрано: <span className="text-white font-bold">{selectedCount}</span></div>
              <button onClick={() => setSelectedInventoryIds(new Set())} className="text-slate-400 hover:text-white text-sm">Снять выделение</button>
           </div>
           <Button onClick={sellSelected} variant="success" className="w-full py-3 shadow-green-500/20">
               Продать за {formatMoney(sellAmount)} <Star className="w-4 h-4 fill-white" />
           </Button>
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

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-yellow-500/30 max-w-md mx-auto relative border-x border-slate-900 shadow-2xl overflow-hidden">
      
      {showWelcomeModal && renderWelcomeModal()}
      {showSettingsModal && renderSettingsModal()}

      {screen !== AppScreen.ROULETTE && screen !== AppScreen.DROP_SUMMARY && (
        <Header balance={balance} />
      )}

      {screen === AppScreen.GAMES_MENU && renderGamesMenu()}
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

