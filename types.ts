
export interface BaseItem {
  id: number;
  название: string;
  цена: number;
  редкость: string;
  emg: string;
}

export interface CaseItemDrop {
  id: number;
  chance_percent: number;
}

export interface Case {
  key: string;
  name: string;
  type: string;
  price: number;
  items: CaseItemDrop[];
  categoryEmoji: string;
}

export interface InventoryItem extends BaseItem {
  uniqueId: string; // UUID for react keys
  serial: number; // Random generated 1-10000
  obtainedAt: number;
}

export type Rarity = 'обычный' | 'редкий' | 'эпический' | 'мифический' | 'легендарный';

export enum AppScreen {
  GAMES_MENU = 'GAMES_MENU',
  CASE_LIST = 'CASE_LIST',
  CASE_DETAIL = 'CASE_DETAIL',
  ROULETTE = 'ROULETTE',
  DROP_SUMMARY = 'DROP_SUMMARY',
  PROFILE = 'PROFILE',
  ROCKET_MENU = 'ROCKET_MENU',
  ROCKET_GAME = 'ROCKET_GAME',
  UPGRADER_MENU = 'UPGRADER_MENU',
  UPGRADER_SELECT_TARGET = 'UPGRADER_SELECT_TARGET',
  UPGRADER_GAME = 'UPGRADER_GAME',
  SLOTS_MENU = 'SLOTS_MENU',
  SLOTS_GAME = 'SLOTS_GAME',
  LEADERBOARD = 'LEADERBOARD'
}

export interface PlayerProfile {
  id: string;
  name: string;
  balance: number;
  inventory: InventoryItem[];
  telegram_id?: string;
  telegram_username?: string;
  is_public: boolean;
}
