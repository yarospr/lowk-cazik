
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Star, ArrowLeft, User, Box, Check, Gamepad2, Trophy, Banknote, Menu, ChevronRight, Trash2, AlertTriangle, Rocket, Play, StopCircle, Info } from 'lucide-react';
import { BaseItem, Case, CaseItemDrop, InventoryItem, AppScreen } from './types';
import { ITEMS_DATA, CASES_DATA, INITIAL_BALANCE } from './constants';
import { createOrLoadTelegramAccount, saveTelegramAccountState, TelegramWebAppUser } from './api';

// --- UTILS ---

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

const casesByType = CASES_DATA.reduce((acc, c) => {
  if (!acc[c.type]) acc[c.type] = [];
  acc[c.type].push(c);
  return acc;
}, {} as Record<string, Case[]>);

const DEVICE_ID_KEY = 'ccc_device_id';
const LEGACY_BALANCE_KEY = 'ccc_balance';
const LEGACY_INVENTORY_KEY = 'ccc_inventory';

type StorageKeys = {
  balance: string;
  inventory: string;
};

type LocalStateSnapshot = {
  balance: number;
  inventory: InventoryItem[];
};

type TelegramWebAppState = {
  initData?: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
  ready?: () => void;
  expand?: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppState;
    };
  }
}

const getTelegramWebApp = (): TelegramWebAppState | null => {
  return window.Telegram?.WebApp || null;
};

const buildStorageKeys = (scope: string): StorageKeys => {
  return {
    balance: `ccc_balance_${scope}`,
    inventory: `ccc_inventory_${scope}`,
  };
};

const getOrCreateDeviceId = (): string => {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = generateUUID();
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

const parseInventory = (raw: string | null): InventoryItem[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseBalance = (raw: string | null): number => {
  if (!raw) {
    return INITIAL_BALANCE;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : INITIAL_BALANCE;
};

const writeLocalState = (keys: StorageKeys, balance: number, inventory: InventoryItem[]) => {
  localStorage.setItem(keys.balance, balance.toString());
  localStorage.setItem(keys.inventory, JSON.stringify(inventory));
};

const readLocalState = (keys: StorageKeys): LocalStateSnapshot => {
  const scopedBalance = localStorage.getItem(keys.balance);
  const scopedInventory = localStorage.getItem(keys.inventory);

  if (scopedBalance !== null || scopedInventory !== null) {
    return {
      balance: parseBalance(scopedBalance),
      inventory: parseInventory(scopedInventory),
    };
  }

  const legacyBalance = localStorage.getItem(LEGACY_BALANCE_KEY);
  const legacyInventory = localStorage.getItem(LEGACY_INVENTORY_KEY);

  if (legacyBalance !== null || legacyInventory !== null) {
    const migrated = {
      balance: parseBalance(legacyBalance),
      inventory: parseInventory(legacyInventory),
    };
    writeLocalState(keys, migrated.balance, migrated.inventory);
    return migrated;
  }

  return {
    balance: INITIAL_BALANCE,
    inventory: [],
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
      <button 
        className={`p-3 rounded-xl flex flex-col items-center gap-1 transition-all text-slate-700 cursor-not-allowed`}
      >
        <Trophy className="w-6 h-6" />
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
        <div className="p-6 text-center sticky top-0 bg-slate-950/90 z-20 backdrop-blur border-b border-slate-800">
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
  const [balance, setBalance] = useState<number>(INITIAL_BALANCE);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [isHydrating, setIsHydrating] = useState(true);
  const [syncMode, setSyncMode] = useState<'local' | 'server'>('local');
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [storageKeys, setStorageKeys] = useState<StorageKeys>(() => {
    return buildStorageKeys(`device_${getOrCreateDeviceId()}`);
  });

  const [screen, setScreen] = useState<AppScreen>(AppScreen.GAMES_MENU);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [droppedItems, setDroppedItems] = useState<InventoryItem[]>([]);
  
  const [activeTab, setActiveTab] = useState('games');
  const [openAmount, setOpenAmount] = useState(1);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Set<string>>(new Set());
  
  const [showSellAllConfirm, setShowSellAllConfirm] = useState(false);

  // Rocket Game State
  const [rocketBetItem, setRocketBetItem] = useState<InventoryItem | null>(null);
  const [rocketState, setRocketState] = useState<'IDLE' | 'FLYING' | 'CRASHED' | 'CASHED_OUT'>('IDLE');
  const [rocketMultiplier, setRocketMultiplier] = useState(1.00);
  const [rocketCrashPoint, setRocketCrashPoint] = useState(0);
  const [rocketWinnings, setRocketWinnings] = useState<BaseItem | null>(null);
  const rocketRequestRef = useRef<number>();
  const rocketStartTimeRef = useRef<number>(0);
  const saveTimeoutRef = useRef<number>();

  useEffect(() => {
    let isCancelled = false;

    const bootstrapAccount = async () => {
      const webApp = getTelegramWebApp();
      webApp?.ready?.();
      webApp?.expand?.();

      const tgUser = webApp?.initDataUnsafe?.user;
      const fallbackScope = tgUser?.id ? `tg_${tgUser.id}` : `device_${getOrCreateDeviceId()}`;
      const fallbackKeys = buildStorageKeys(fallbackScope);

      if (tgUser?.id) {
        try {
          const remoteState = await createOrLoadTelegramAccount(tgUser, webApp?.initData);
          if (isCancelled) {
            return;
          }

          const remoteKeys = buildStorageKeys(`tg_${remoteState.telegramId}`);
          setStorageKeys(remoteKeys);
          setBalance(remoteState.balance);
          setInventory(remoteState.inventory);
          setSyncMode('server');
          setTelegramId(remoteState.telegramId);
          writeLocalState(remoteKeys, remoteState.balance, remoteState.inventory);
          setIsHydrating(false);
          return;
        } catch (error) {
          console.error('Failed to load account from API, local fallback will be used.', error);
        }
      }

      if (isCancelled) {
        return;
      }

      const localState = readLocalState(fallbackKeys);
      setStorageKeys(fallbackKeys);
      setBalance(localState.balance);
      setInventory(localState.inventory);
      setSyncMode('local');
      setTelegramId(null);
      setIsHydrating(false);
    };

    bootstrapAccount();

    return () => {
      isCancelled = true;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isHydrating) {
      return;
    }

    writeLocalState(storageKeys, balance, inventory);

    if (syncMode !== 'server' || !telegramId) {
      return;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveTelegramAccountState(telegramId, balance, inventory).catch((error) => {
        console.error('Failed to save state to API', error);
      });
    }, 500);
  }, [balance, inventory, isHydrating, storageKeys, syncMode, telegramId]);

  useEffect(() => {
    if (screen === AppScreen.PROFILE) setActiveTab('profile');
    else if (screen === AppScreen.GAMES_MENU || screen === AppScreen.CASE_LIST || screen === AppScreen.ROCKET_MENU) setActiveTab('games');
  }, [screen]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'games') setScreen(AppScreen.GAMES_MENU);
    if (tab === 'profile') setScreen(AppScreen.PROFILE);
  };

  // --- ROCKET LOGIC ---

  const startRocketGame = () => {
    if (!rocketBetItem) return;
    
    setRocketState('FLYING');
    setRocketMultiplier(1.00);
    setRocketWinnings(null);
    
    // 95% RTP Algorithm: crashPoint = 0.95 / (1 - random)
    // If random is close to 0, point is 0.95 -> Instant crash (since min is 1.00)
    const r = Math.random();
    const crash = 0.95 / (1 - r);
    // Clamp: if < 1.00, it's an instant crash
    setRocketCrashPoint(Math.max(1.00, crash));
    
    rocketStartTimeRef.current = Date.now();
    rocketRequestRef.current = requestAnimationFrame(rocketTick);
  };

  const rocketTick = () => {
    const now = Date.now();
    const elapsed = (now - rocketStartTimeRef.current) / 1000; // seconds
    
    // Growth formula: Grows slow then fast. e.g. 1.06^seconds seems common, or just e^(0.06*t)
    // Let's use a simple exponential growth
    const currentMult = Math.pow(Math.E, 0.06 * elapsed);
    
    setRocketMultiplier(currentMult);

    if (currentMult >= rocketCrashPoint) {
       setRocketState('CRASHED');
       // Remove item from inventory
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
    
    // Calculate Winnings
    const winValue = rocketBetItem.цена * rocketMultiplier;
    const wonItemBase = findClosestItemByPrice(winValue);
    
    const wonItem: InventoryItem = {
      ...wonItemBase,
      uniqueId: generateUUID(),
      serial: generateSerial(),
      obtainedAt: Date.now()
    };
    
    setRocketWinnings(wonItemBase);
    
    // Update Inventory: Remove bet item, Add won item
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
    const totalValue = itemsToSell.reduce((acc, i) => acc + i.цена, 0);
    
    setInventory(prev => prev.filter(i => !selectedInventoryIds.has(i.uniqueId)));
    setBalance(prev => prev + totalValue);
    setSelectedInventoryIds(new Set());
  };

  const handleSellAll = () => {
    const totalValue = inventory.reduce((acc, i) => acc + i.цена, 0);
    setInventory([]);
    setBalance(prev => prev + totalValue);
    setSelectedInventoryIds(new Set());
    setShowSellAllConfirm(false);
  };

  // --- RENDERERS ---

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
          {inventory.length === 0 ? (
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
        // Should not happen, but failsafe
        return <div className="p-10">Error: No bet item</div>;
    }

    return (
        <div className="flex flex-col h-screen bg-slate-950 relative overflow-hidden">
            {/* Background Grid Animation */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] animate-pan" />
            
            {/* Top Info */}
            <div className="p-4 flex items-center justify-between relative z-10">
                <button onClick={() => {
                    if(rocketState === 'FLYING') return; // Prevent exit during fly
                    setScreen(AppScreen.ROCKET_MENU);
                }} className="p-2 bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-0" disabled={rocketState === 'FLYING'}>
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="bg-slate-900/80 px-4 py-1 rounded-full border border-slate-700 text-xs text-slate-400 flex items-center gap-2">
                    <Info className="w-3 h-3" /> RTP 95%
                </div>
            </div>

            {/* Game Area */}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
                 {rocketState === 'CRASHED' ? (
                     <div className="text-center animate-in zoom-in duration-300">
                         <div className="text-6xl mb-4">💥</div>
                         <h2 className="text-4xl font-black text-red-500 uppercase tracking-widest">CRASHED</h2>
                         <div className="text-xl text-slate-400 mt-2 font-mono">@{rocketMultiplier.toFixed(2)}x</div>
                     </div>
                 ) : rocketState === 'CASHED_OUT' ? (
                    <div className="text-center animate-in zoom-in duration-300">
                        <div className="text-6xl mb-4">🏆</div>
                        <h2 className="text-4xl font-black text-green-500 uppercase tracking-widest">WIN!</h2>
                        <div className="text-xl text-slate-400 mt-2 font-mono">@{rocketMultiplier.toFixed(2)}x</div>
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
                            <div className="text-sm text-slate-400 mt-2 font-mono">Current Win: {rocketBetItem ? formatMoney(rocketBetItem.цена * rocketMultiplier) : 0}</div>
                        )}
                     </div>
                 )}
            </div>

            {/* Control Panel */}
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

        {/* Buy Panel - Fixed at bottom, Z-index 40 to be above content, but BottomNav is hidden on this screen */}
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
    const sellAmount = inventory.filter(i => selectedInventoryIds.has(i.uniqueId)).reduce((acc, i) => acc + i.цена, 0);
    const selectedCount = selectedInventoryIds.size;
    const totalInvValue = inventory.reduce((acc, i) => acc + i.цена, 0);

    const toggleSelection = (id: string) => {
      const newSet = new Set(selectedInventoryIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedInventoryIds(newSet);
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 relative">
        {/* Sell All Confirmation Modal */}
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
                      <Button onClick={handleSellAll} variant="danger" className="w-full">Продать все</Button>
                   </div>
                </div>
             </div>
          </div>
        )}

        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <User className="w-6 h-6 text-slate-300" />
            <h2 className="font-bold text-lg text-white">Профиль</h2>
          </div>
          {inventory.length > 0 && (
             <button 
                onClick={() => setShowSellAllConfirm(true)}
                className="text-xs font-bold text-red-400 hover:text-red-300 bg-red-900/20 px-3 py-1.5 rounded-lg border border-red-900/50 flex items-center gap-2 transition-all active:scale-95"
             >
                <Trash2 className="w-3 h-3" /> ПРОДАТЬ ВСЕ
             </button>
          )}
        </div>

        <div className="px-4 py-2 border-b border-slate-800 bg-slate-950">
          <div className="text-xs text-slate-400">
            {telegramId ? `Telegram ID: ${telegramId}` : 'Telegram ID: not detected (local mode)'}
          </div>
          <div className={`text-xs font-semibold ${syncMode === 'server' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {syncMode === 'server' ? 'Sync: SQLite API' : 'Sync: localStorage'}
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
            {inventory.length === 0 ? (
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

        {/* Bottom Selection Bar */}
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

  if (isHydrating) {
    return (
      <div className="min-h-screen bg-slate-950 text-white max-w-md mx-auto flex items-center justify-center">
        <div className="text-center px-6">
          <div className="text-lg font-bold mb-2">Загрузка аккаунта</div>
          <div className="text-sm text-slate-400">Подключаем Telegram-профиль и базу данных...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-yellow-500/30 max-w-md mx-auto relative border-x border-slate-900 shadow-2xl overflow-hidden">
      
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
      
      {screen === AppScreen.ROCKET_MENU && renderRocketMenu()}
      {screen === AppScreen.ROCKET_GAME && renderRocketGame()}

      {/* Bottom Nav: Hidden on Roulette, Summary, Rocket Game, AND CaseDetail */}
      {screen !== AppScreen.ROULETTE && screen !== AppScreen.DROP_SUMMARY && screen !== AppScreen.CASE_DETAIL && screen !== AppScreen.ROCKET_GAME && (
        <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
      )}

    </div>
  );
}
