import { createClient } from '@supabase/supabase-js';
import { InventoryItem } from './types';

export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface AccountState {
  telegramId: string;
  balance: number;
  inventory: InventoryItem[];
  createdAt: string;
  updatedAt: string;
}

type PlayerRow = {
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  balance: number;
  inventory_json: InventoryItem[] | null;
  created_at: string;
  updated_at: string;
};

const SUPABASE_URL = (((import.meta as any).env?.VITE_SUPABASE_URL as string) || '').trim();
const SUPABASE_ANON_KEY = (((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || '').trim();
const DEFAULT_BALANCE = Number(((import.meta as any).env?.VITE_DEFAULT_BALANCE as string) || 1000);

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

const assertSupabaseConfigured = () => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
};

const normalizeInventory = (value: unknown): InventoryItem[] => {
  return Array.isArray(value) ? (value as InventoryItem[]) : [];
};

const rowToAccount = (row: PlayerRow): AccountState => {
  return {
    telegramId: row.telegram_id,
    balance: Number.isFinite(row.balance) ? Number(row.balance) : DEFAULT_BALANCE,
    inventory: normalizeInventory(row.inventory_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const isCloudDbConfigured = (): boolean => Boolean(supabase);

export const createOrLoadTelegramAccount = async (
  user: TelegramWebAppUser,
  _initData?: string,
): Promise<AccountState> => {
  assertSupabaseConfigured();

  const telegramId = String(user.id);

  const { data: existing, error: readError } = await supabase!
    .from('players')
    .select('telegram_id, username, first_name, last_name, balance, inventory_json, created_at, updated_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  if (!existing) {
    const { error: insertError } = await supabase!
      .from('players')
      .insert({
        telegram_id: telegramId,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        balance: DEFAULT_BALANCE,
        inventory_json: [],
      });

    if (insertError) {
      throw new Error(insertError.message);
    }
  } else {
    const { error: profileUpdateError } = await supabase!
      .from('players')
      .update({
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
      })
      .eq('telegram_id', telegramId);

    if (profileUpdateError) {
      throw new Error(profileUpdateError.message);
    }
  }

  const { data, error } = await supabase!
    .from('players')
    .select('telegram_id, username, first_name, last_name, balance, inventory_json, created_at, updated_at')
    .eq('telegram_id', telegramId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to load player');
  }

  return rowToAccount(data as PlayerRow);
};

export const saveTelegramAccountState = async (
  telegramId: string,
  balance: number,
  inventory: InventoryItem[],
): Promise<void> => {
  assertSupabaseConfigured();

  const { error } = await supabase!
    .from('players')
    .upsert({
      telegram_id: String(telegramId),
      balance: Math.max(0, Math.floor(balance)),
      inventory_json: Array.isArray(inventory) ? inventory : [],
    }, { onConflict: 'telegram_id' });

  if (error) {
    throw new Error(error.message);
  }
};
