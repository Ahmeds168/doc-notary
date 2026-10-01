import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Browser Supabase client (anon key only — safe to ship). Null when auth isn't configured. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
