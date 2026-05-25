import type { Context, Next } from "hono";
import type { Env, Variables } from "./types.js";
import { isAdminEmail, verifySupabaseToken } from "./auth.js";
import { isAllowlisted } from "./db.js";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

function extractBearer(c: Ctx): string | null {
  const header = c.req.header("authorization") || c.req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Verifies the Supabase access token and attaches the user. 401 if missing/invalid.
export async function requireAuth(c: Ctx, next: Next) {
  const token = extractBearer(c);
  if (!token) return c.json({ error: "Unauthorized", message: "Missing bearer token" }, 401);
  try {
    const user = await verifySupabaseToken(token, c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    if (!user.email) return c.json({ error: "Unauthorized", message: "Token has no email" }, 401);
    c.set("user", user);
    await next();
  } catch (error) {
    return c.json(
      { error: "Unauthorized", message: error instanceof Error ? error.message : "Invalid token" },
      401,
    );
  }
}

// Requires the authenticated user to be an allowlisted tester (admins always pass).
export async function requireTester(c: Ctx, next: Next) {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  if (!admin && !(await isAllowlisted(c.env.DB, user.email))) {
    return c.json({ error: "Forbidden", message: "Not an allowlisted tester" }, 403);
  }
  await next();
}

// Requires the authenticated user to be an admin.
export async function requireAdmin(c: Ctx, next: Next) {
  const user = c.get("user");
  if (!isAdminEmail(user.email, c.env.ADMIN_EMAILS)) {
    return c.json({ error: "Forbidden", message: "Admin only" }, 403);
  }
  await next();
}
