import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (((import.meta as any).env?.VITE_SUPABASE_URL as string) || '').trim();
const supabaseKey = (((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || '').trim();
const fallbackUrl = 'https://dcjeznstdqvseassrqux.supabase.co';
const fallbackKey = 'sb_publishable_msAPoWwtGWIMVbiJGgxewA_zifcP2yF';
const safeUrl = supabaseUrl || fallbackUrl;
const safeKey = supabaseKey || fallbackKey;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase env vars are missing: using built-in fallback credentials');
}

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
