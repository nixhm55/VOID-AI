import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let client: SupabaseClient<Database> | null = null;

/** Small adapter shape for native secure storage implementations. */
export interface SupabaseAuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  isServer?: boolean;
}

export interface SupabaseClientConfig {
  url: string;
  publishableKey: string;
  storage?: SupabaseAuthStorage;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    client ||
      (import.meta.env.VITE_SUPABASE_URL?.trim() &&
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()),
  );
}

export function configureSupabaseClient(
  config: SupabaseClientConfig,
): SupabaseClient<Database> {
  if (client) {
    throw new Error('The Supabase client has already been initialized.');
  }

  const url = config.url.trim();
  const publishableKey = config.publishableKey.trim();
  if (!url || !publishableKey) {
    throw new Error('A Supabase project URL and publishable key are required.');
  }

  client = createClient<Database>(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      ...(config.storage ? { storage: config.storage } : {}),
    },
  });

  return client;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    );
  }

  return configureSupabaseClient({ url, publishableKey });
}
