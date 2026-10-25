import { routeParam } from "../routeParams.js";
import { Router } from "express";
import { logAudit } from "../audit.js";
import { deriveVaultKey, encryptAesGcm, randomId } from "../crypto.js";
import { MASTER_KEY, PREVIOUS_MASTER_KEY } from "../config.js";
import { db, now } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import { createSecretSchema } from "../validate.js";
import { decryptWithKeyRotation } from "../vaultCrypto.js";

const router = Router();
const VAULT_KEY = deriveVaultKey(MASTER_KEY);
const PREVIOUS_VAULT_KEY = PREVIOUS_MASTER_KEY ? deriveVaultKey(PREVIOUS_MASTER_KEY) : null;
const AAD = "groundwork:vault";

router.use(asyncHandler(async (req: AuthedRequest, res, next) => {
  const session = (await resolveSession(req));
  if (!session || session.status !== "active") {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = { id: session.user_id, email: "" };
  req.session = session;
  req.csrfToken = session.csrf_token;
  next();
}));

/* GET /api/secrets */
router.get("/", asyncHandler(async (req: AuthedRequest, res) => {
  const rows = (await db
    .prepare(
      "SELECT id, name, created_at, updated_at, LENGTH(ciphertext) AS ciphertext_bytes FROM secrets WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(req.user!.id)) as {
    id: string;
    name: string;
    created_at: number;
    updated_at: number;
    ciphertext_bytes: number;
  }[];
  res.json({
    secrets: rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      encrypted: true,
      ciphertextBytes: Number(r.ciphertext_bytes),
    })),
  });
}));

/* POST /api/secrets */
router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createSecretSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { name, plaintext } = parsed.data;
    const payload = encryptAesGcm(plaintext, VAULT_KEY, `${AAD}:${req.user!.id}`);
    const id = randomId();
    const t = now();
    (await db.prepare(
      "INSERT INTO secrets (id, user_id, name, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, req.user!.id, name, payload.iv, payload.tag, payload.data, t, t));
    (await logAudit(req.user!.id, "secret.created", { name }, req));
    res.status(201).json({ id, name, createdAt: t, updatedAt: t });
  }),
);

/* GET /api/secrets/:id — decrypts and returns the plaintext */
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = (await db
      .prepare("SELECT * FROM secrets WHERE id = ? AND user_id = ?")
      .get(routeParam(req, "id"), req.user!.id)) as
      | { id: string; name: string; iv: string; tag: string; ciphertext: string; created_at: number }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    const { plaintext, resealed } = decryptWithKeyRotation(
      { iv: row.iv, tag: row.tag, data: row.ciphertext },
      VAULT_KEY,
      PREVIOUS_VAULT_KEY,
      `${AAD}:${req.user!.id}`,
    );
    if (resealed) {
      // Compare the authenticated ciphertext so rotation cannot resurrect a
      // deleted value or overwrite a concurrent replacement. Logical timestamps
      // stay intact because key rotation does not change the secret's contents.
      await db.prepare("UPDATE secrets SET iv=?,tag=?,ciphertext=? WHERE id=? AND user_id=? AND iv=? AND tag=? AND ciphertext=?")
        .run(resealed.iv, resealed.tag, resealed.data, row.id, req.user!.id, row.iv, row.tag, row.ciphertext);
    }
    (await logAudit(req.user!.id, "secret.viewed", { name: row.name }, req));
    res.json({ id: row.id, name: row.name, plaintext, createdAt: row.created_at });
  }),
);

/* DELETE /api/secrets/:id */
router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = (await db
      .prepare("SELECT name FROM secrets WHERE id = ? AND user_id = ?")
      .get(routeParam(req, "id"), req.user!.id)) as { name: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    (await db.prepare("DELETE FROM secrets WHERE id = ? AND user_id = ?").run(routeParam(req, "id"), req.user!.id));
    (await logAudit(req.user!.id, "secret.deleted", { name: row.name }, req));
    res.json({ ok: true });
  }),
);

export default router;
