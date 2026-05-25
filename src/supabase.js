import { createClient } from "@supabase/supabase-js";

// These come from your Supabase project (Settings → API).
// They are PUBLIC by design — security is enforced by Row Level Security
// in the database, not by hiding these values.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Only these emails are allowed to sign in. Add/remove as needed.
// (Also lock this down in Supabase: Auth → Providers → Email, and
//  consider disabling public sign-ups in Auth settings.)
export const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured ? createClient(url, anonKey) : null;

export function emailAllowed(email) {
  if (!email) return false;
  if (ALLOWED_EMAILS.length === 0) return true; // no list set = allow any signed-in user
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
