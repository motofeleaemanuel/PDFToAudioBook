import { createClient } from "@/lib/supabase/client";

/**
 * Get auth headers for API calls.
 * Uses the Supabase session JWT if available, falls back to the legacy access code.
 */
export async function getAuthHeaders() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    return {
      Authorization: `Bearer ${session.access_token}`,
      "ngrok-skip-browser-warning": "1",
    };
  }

  // Force fail if no session is active.
  console.warn("api-auth.js: No active session found when requested!");
  return {
    Authorization: `Bearer INVALID_OR_MISSING_SESSION`,
    "ngrok-skip-browser-warning": "1",
  };
}
