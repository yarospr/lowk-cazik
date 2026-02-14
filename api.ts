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

const API_BASE = (((import.meta as any).env?.VITE_API_BASE_URL as string) || '').trim();

const makeUrl = (path: string): string => {
  if (!API_BASE) {
    return path;
  }
  return `${API_BASE.replace(/\/$/, '')}${path}`;
};

const requestJson = async <T>(path: string, init: RequestInit): Promise<T> => {
  const response = await fetch(makeUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const createOrLoadTelegramAccount = async (
  user: TelegramWebAppUser,
  initData?: string,
): Promise<AccountState> => {
  return requestJson<AccountState>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ user, initData: initData || '' }),
  });
};

export const saveTelegramAccountState = async (
  telegramId: string,
  balance: number,
  inventory: InventoryItem[],
): Promise<void> => {
  await requestJson<{ ok: true }>(`/api/users/${telegramId}/state`, {
    method: 'PUT',
    body: JSON.stringify({ balance, inventory }),
  });
};

