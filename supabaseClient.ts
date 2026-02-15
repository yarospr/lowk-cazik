import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (((import.meta as any).env?.VITE_SUPABASE_URL as string) || '').trim();
const supabaseKey = (((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || '').trim();
const safeUrl = supabaseUrl || 'https://example.supabase.co';
const safeKey = supabaseKey || 'public-anon-key';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase env vars are missing: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
