import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { normalizeEmail, uuid } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware.js";

const allowlist = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / — list testers (admin)
allowlist.get("/", requireAuth, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, note, created_by, created_at FROM testers ORDER BY created_at DESC",
  ).all();
  return c.json({ testers: results ?? [] });
});

// POST / — add/update a tester (admin)
allowlist.post("/", requireAuth, requireAdmin, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<Record<string, unknown>>();
  const email = normalizeEmail(body.email);
  if (!email || !email.includes("@")) {
    return c.json({ error: "Bad Request", message: "Valid email required" }, 400);
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  await c.env.DB.prepare(
    `INSERT INTO testers (id, email, note, created_by) VALUES (?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET note = COALESCE(excluded.note, testers.note)`,
  )
    .bind(uuid(), email, note, user.email)
    .run();

  const entry = await c.env.DB.prepare("SELECT id, email, note, created_by, created_at FROM testers WHERE email = ?")
    .bind(email)
    .first();
  return c.json({ tester: entry }, 201);
});

// DELETE /:id — remove a tester (admin)
allowlist.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("DELETE FROM testers WHERE id = ?").bind(id).run();
  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  return c.json({ id });
});

export default allowlist;
