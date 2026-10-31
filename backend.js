import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

const SUPABASE_URL = "https://piqamkktvlvdxjefxasf.supabase.co";
const SUPABASE_KEY = "sb_publishable_qlEc7Fbbqyb6MbNe8SySGQ_1jSJIusY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

export const app = supabase;
export const db = supabase;
