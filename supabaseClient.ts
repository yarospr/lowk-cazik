import { createClient } from '@supabase/supabase-js';
import { createLocalDatabaseClient } from './localDatabase';
import { createResilientDatabaseClient } from './resilientDatabase';

const supabaseUrl = (((import.meta as any).env?.VITE_SUPABASE_URL as string) || '').trim();
const supabaseKey = (((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || '').trim();
const forceLocalDatabase = String((import.meta as any).env?.VITE_FORCE_LOCAL_DB || '') === '1';
const hasSupabaseConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)
  && supabaseKey.length >= 20;

export const isUsingLocalDatabase = forceLocalDatabase || !hasSupabaseConfig;

if (isUsingLocalDatabase) {
  console.warn('Supabase is not configured; using the local browser database');
}

const fetchWithTimeout: typeof fetch = async (input, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  const originalSignal = init.signal;
  const abortFromOriginalSignal = () => controller.abort();
  originalSignal?.addEventListener('abort', abortFromOriginalSignal, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    originalSignal?.removeEventListener('abort', abortFromOriginalSignal);
  }
};

const localDatabase = createLocalDatabaseClient();
const remoteDatabase = !isUsingLocalDatabase
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    })
  : null;

export const supabase: any = isUsingLocalDatabase
  ? localDatabase
  : createResilientDatabaseClient(remoteDatabase, localDatabase);
