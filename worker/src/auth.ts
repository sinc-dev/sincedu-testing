import type { AuthUser } from "./types.js";

interface SupabaseUserResponse {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

export async function verifySupabaseToken(token: string, supabaseUrl: string, supabaseAnonKey: string): Promise<AuthUser> {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) throw new Error("Invalid or expired token");

  const user = (await response.json()) as SupabaseUserResponse;
  if (!user.id) throw new Error("Token has no subject");

  const name = user.user_metadata?.full_name || user.user_metadata?.name;
  return {
    uid: user.id,
    email: typeof user.email === "string" ? user.email.toLowerCase() : "",
    name: typeof name === "string" ? name : null,
    emailVerified: Boolean(user.email_confirmed_at),
  };
}

export function isAdminEmail(email: string, adminEmails: string): boolean {
  const list = adminEmails
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
