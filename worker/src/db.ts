export function uuid(): string {
  return crypto.randomUUID();
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function isAllowlisted(db: D1Database, email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const row = await db
    .prepare("SELECT 1 FROM testers WHERE email = ? LIMIT 1")
    .bind(normalized)
    .first();
  return Boolean(row);
}
