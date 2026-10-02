import { Router } from "express";
import { z } from "zod";
import { MASTER_KEY, PREVIOUS_MASTER_KEY } from "../config.js";
import { decryptAesGcm, deriveVaultKey, encryptAesGcm, sha256Hex } from "../crypto.js";
import { db, now, withTransaction } from "../db.js";
import { getProjectAccess, canReadProject, canWriteProject } from "../projectAccess.js";
import { organizationAudit } from "../organization.js";
import { redisCommand, redisProjectKey, redisTransportConfigured } from "../redisTransport.js";
import { asyncHandler, resolveSession, type AuthedRequest } from "../security.js";

const router = Router({ mergeParams: true });
const key = deriveVaultKey(MASTER_KEY);
const previousKey = PREVIOUS_MASTER_KEY ? deriveVaultKey(PREVIOUS_MASTER_KEY) : null;
const fields = ["title", "body", "status", "assignee", "dueDate", "deleted"] as const;
const operationSchema = z.object({ operationId: z.string().regex(/^[A-Za-z0-9_.-]{8,120}$/), clientId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), logicalClock: z.number().int().min(1).max(1_000_000_000), entityId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/), field: z.enum(fields), value: z.union([z.string().max(10000), z.boolean()]) }).strict();
type Operation = z.infer<typeof operationSchema>;
interface Register { entityId: string; field: Operation["field"]; logicalClock: number; clientId: string; operationId: string; sequence: number; value: string | boolean }
function encrypt(value: unknown, projectId: string, ownerId: string) {
  return JSON.stringify(encryptAesGcm(JSON.stringify(value), key, `groundwork:sync:${ownerId}:${projectId}`));
}
function decrypt(value: string, projectId: string, ownerId: string): string | boolean {
  const payload = JSON.parse(value) as { iv: string; tag: string; data: string };
  const aad = `groundwork:sync:${ownerId}:${projectId}`;
  let text: string;
  try { text = decryptAesGcm(payload, key, aad); }
  catch (error) { if (!previousKey) throw error; text = decryptAesGcm(payload, previousKey, aad); }
  return JSON.parse(text) as string | boolean;
}
function validField(operation: Operation) {
  if (operation.field === "deleted") return typeof operation.value === "boolean";
  if (typeof operation.value !== "string") return false;
  if (operation.field === "status") return ["open", "resolved", "in-progress"].includes(operation.value);
  if (operation.field === "dueDate") return operation.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(operation.value);
  return operation.value.length <= (operation.field === "body" ? 10000 : operation.field === "title" ? 200 : 120);
}

// A deterministic LWW register per entity field. Lamport clock/client/operation
// tuples commute. It is deliberately a coordination sidecar, never a patch to
// encrypted building geometry or an assertion that generic CAD edits commute.
const redisApply = `
local previous=redis.call('HGET',KEYS[1],ARGV[1])
if previous then
 local p=cjson.decode(previous)
 if p.hash~=ARGV[2] then return cjson.encode({error='ID_REUSED'}) end
 p.duplicate=true;return cjson.encode(p)
end
if redis.call('LLEN',KEYS[2])>=50000 then return cjson.encode({error='LOG_FULL'}) end
local clock=tonumber(ARGV[3]);local maximum=tonumber(redis.call('GET',KEYS[4]) or '0')
if clock>maximum+10000 then return cjson.encode({error='CLOCK_AHEAD'}) end
local old=redis.call('HGET',KEYS[3],ARGV[4])
if not old and redis.call('HLEN',KEYS[3])>=1000 then return cjson.encode({error='REGISTER_FULL'}) end
local record=cjson.decode(ARGV[5]);record.sequence=redis.call('LLEN',KEYS[2])+1
local win=true
if old then local o=cjson.decode(old);win=clock>o.logicalClock or (clock==o.logicalClock and (record.clientId>o.clientId or (record.clientId==o.clientId and record.operationId>o.operationId))) end
local bytes=tonumber(redis.call('GET',KEYS[5]) or '0')
if win then
 local previousBytes=0;if old then previousBytes=string.len(cjson.decode(old).valueEncrypted) end
 local nextBytes=bytes-previousBytes+string.len(record.valueEncrypted)
 if nextBytes>2500000 then return cjson.encode({error='REGISTER_FULL'}) end
 redis.call('SET',KEYS[5],nextBytes)
end
redis.call('RPUSH',KEYS[2],cjson.encode(record))
if win then redis.call('HSET',KEYS[3],ARGV[4],cjson.encode(record)) end
if clock>maximum then redis.call('SET',KEYS[4],clock) end
local result={hash=ARGV[2],sequence=record.sequence,applied=win,duplicate=false,maxClock=math.max(clock,maximum)}
redis.call('HSET',KEYS[1],ARGV[1],cjson.encode(result));return cjson.encode(result)
`;
interface WireRegister extends Omit<Register, "value"> { valueEncrypted: string; actorId: string; }
router.get("/", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  const after = Number(req.query.after || 0);
  if (!Number.isSafeInteger(after) || after < 0) { res.status(400).json({ error: "Invalid operation cursor" }); return; }
  let rows: WireRegister[], cursor: number, maxClock: number;
  if (redisTransportConfigured) {
    const base = `${redisProjectKey(req.params.projectId)}:sync`;
    if (req.query.snapshot === "1") {
      const snapshot = JSON.parse(await redisCommand<string>(["EVAL", "return cjson.encode({rows=redis.call('HVALS',KEYS[1]),cursor=redis.call('LLEN',KEYS[2]),clock=tonumber(redis.call('GET',KEYS[3]) or '0')})", 3, `${base}:registers`, `${base}:log`, `${base}:clock`])) as { rows: unknown; cursor: number; clock: number };
      // Redis Lua CJSON represents an empty HVALS table as {}, not [].
      const packedRows = Array.isArray(snapshot.rows) ? snapshot.rows : snapshot.rows && typeof snapshot.rows === "object" && Object.keys(snapshot.rows).length === 0 ? [] : null;
      if (!packedRows || packedRows.length > 1000 || !packedRows.every((entry): entry is string => typeof entry === "string")) throw new Error("Invalid Redis coordination snapshot");
      rows = packedRows.map((text) => JSON.parse(text) as WireRegister);
      cursor = snapshot.cursor;
      maxClock = snapshot.clock;
    } else {
      const packed = await redisCommand<string[]>(["LRANGE", `${base}:log`, after, after + 199]);
      rows = packed.map((text) => JSON.parse(text) as WireRegister);
      cursor = rows[rows.length - 1]?.sequence ?? after;
      maxClock = Number(await redisCommand<string | null>(["GET", `${base}:clock`]) || 0);
    }
  } else {
    const snapshot = withTransaction(() => {
    const source = req.query.snapshot === "1" ? "project_sync_registers" : "project_sync_operations";
    const raw = db.prepare(`SELECT entity_id,field,logical_clock,client_id,operation_id,value_encrypted,sequence FROM ${source} WHERE project_id=?${source === "project_sync_operations" ? " AND sequence>?" : ""} ORDER BY sequence LIMIT ${source === "project_sync_operations" ? 200 : 1000}`)
      .all(req.params.projectId, ...(source === "project_sync_operations" ? [after] : [])) as { entity_id: string; field: Operation["field"]; logical_clock: number; client_id: string; operation_id: string; value_encrypted: string; sequence: number }[];
    const records = raw.map((row) => ({ entityId: row.entity_id, field: row.field, logicalClock: row.logical_clock, clientId: row.client_id, operationId: row.operation_id, valueEncrypted: row.value_encrypted, sequence: row.sequence, actorId: "" }));
    const latest = db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence,COALESCE(MAX(logical_clock),0) AS clock FROM project_sync_operations WHERE project_id=?").get(req.params.projectId) as { sequence: number; clock: number };
    return { records, cursor: req.query.snapshot === "1" ? latest.sequence : records[records.length - 1]?.sequence ?? after, maxClock: latest.clock };
    });
    rows = snapshot.records; cursor = snapshot.cursor; maxClock = snapshot.maxClock;
  }
  if (resolveSession(req)?.status !== "active" || !canReadProject(getProjectAccess(req.params.projectId, req.user!.id))) { res.status(403).json({ error: "Project access changed during synchronization" }); return; }
  res.set("Cache-Control", "private, no-store");
  res.json({ registers: rows.map(({ valueEncrypted, actorId: _actor, ...row }) => ({ ...row, value: decrypt(valueEncrypted, req.params.projectId, access.ownerId) })), cursor, maxClock, backend: redisTransportConfigured ? "redis-rest" : "sqlite", scope: "coordination-sidecar" });
}));
router.post("/", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canWriteProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" }); return; }
  const parsed = operationSchema.safeParse(req.body);
  if (!parsed.success || !validField(parsed.data)) { res.status(400).json({ error: "Invalid coordination register operation" }); return; }
  const op = parsed.data;
  // Tie breaking is namespaced to the authenticated user, preventing client-ID
  // impersonation from being used to overwrite an accepted idempotency key.
  const clientId = `${req.user!.id}:${op.clientId}`;
  const fingerprint = sha256Hex(JSON.stringify({ ...op, actorId: req.user!.id }));
  const valueEncrypted = encrypt(op.value, req.params.projectId, access.ownerId);
  let result: { error?: string; sequence?: number; applied?: boolean; duplicate?: boolean; maxClock?: number };
  if (redisTransportConfigured) {
    const base = `${redisProjectKey(req.params.projectId)}:sync`;
    const record: Omit<WireRegister, "sequence"> = { entityId: op.entityId, field: op.field, logicalClock: op.logicalClock, clientId, operationId: op.operationId, valueEncrypted, actorId: req.user!.id };
    result = JSON.parse(await redisCommand<string>(["EVAL", redisApply, 5, `${base}:ids`, `${base}:log`, `${base}:registers`, `${base}:clock`, `${base}:bytes`, op.operationId, fingerprint, op.logicalClock, `${op.entityId}|${op.field}`, JSON.stringify(record)])) as typeof result;
  } else result = withTransaction(() => {
    if (!canWriteProject(getProjectAccess(req.params.projectId, req.user!.id))) return { error: "ACCESS_REVOKED" };
    const previous = db.prepare("SELECT sequence,value_hash FROM project_sync_operations WHERE project_id=? AND operation_id=?").get(req.params.projectId, op.operationId) as { sequence: number; value_hash: string } | undefined;
    if (previous) return previous.value_hash === fingerprint ? { sequence: previous.sequence, duplicate: true } : { error: "ID_REUSED" };
    const stats = db.prepare("SELECT COUNT(*) AS count,COALESCE(MAX(logical_clock),0) AS clock FROM project_sync_operations WHERE project_id=?").get(req.params.projectId) as { count: number; clock: number };
    if (stats.count >= 50000) return { error: "LOG_FULL" };
    if (op.logicalClock > stats.clock + 10000) return { error: "CLOCK_AHEAD" };
    const previousRegister = db.prepare("SELECT logical_clock,client_id,operation_id,value_encrypted FROM project_sync_registers WHERE project_id=? AND entity_id=? AND field=?").get(req.params.projectId, op.entityId, op.field) as { logical_clock: number; client_id: string; operation_id: string; value_encrypted: string } | undefined;
    if (!previousRegister) {
      const count = db.prepare("SELECT COUNT(*) AS count FROM project_sync_registers WHERE project_id=?").get(req.params.projectId) as { count: number };
      if (count.count >= 1000) return { error: "REGISTER_FULL" };
    }
    const old = previousRegister;
    const applied = !old || op.logicalClock > old.logical_clock || (op.logicalClock === old.logical_clock && (clientId > old.client_id || (clientId === old.client_id && op.operationId > old.operation_id)));
    if (applied) {
      const bytes = db.prepare("SELECT COALESCE(SUM(LENGTH(value_encrypted)),0) AS bytes FROM project_sync_registers WHERE project_id=?").get(req.params.projectId) as { bytes: number };
      if (bytes.bytes - (old?.value_encrypted.length ?? 0) + valueEncrypted.length > 2500000) return { error: "REGISTER_FULL" };
    }
    const sequence = Number(db.prepare("INSERT INTO project_sync_operations (project_id,actor_id,operation_id,client_id,logical_clock,entity_id,field,value_encrypted,value_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(req.params.projectId, req.user!.id, op.operationId, clientId, op.logicalClock, op.entityId, op.field, valueEncrypted, fingerprint, now()).lastInsertRowid);
    if (applied) db.prepare(`INSERT INTO project_sync_registers (project_id,entity_id,field,logical_clock,client_id,operation_id,value_encrypted,sequence) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,entity_id,field) DO UPDATE SET logical_clock=excluded.logical_clock,client_id=excluded.client_id,operation_id=excluded.operation_id,value_encrypted=excluded.value_encrypted,sequence=excluded.sequence`)
      .run(req.params.projectId, op.entityId, op.field, op.logicalClock, clientId, op.operationId, valueEncrypted, sequence);
    return { sequence, applied, duplicate: false, maxClock: Math.max(stats.clock, op.logicalClock) };
  });
  if (result.error) { res.status(result.error === "ACCESS_REVOKED" ? 403 : result.error === "ID_REUSED" ? 409 : 422).json({ error: result.error === "ACCESS_REVOKED" ? "Project access was revoked" : result.error === "ID_REUSED" ? "Operation ID was reused with different content" : "Synchronization capacity or logical-clock limit reached", code: result.error }); return; }
  if (resolveSession(req)?.status !== "active" || !canReadProject(getProjectAccess(req.params.projectId, req.user!.id))) { res.status(403).json({ error: "Project access changed during synchronization" }); return; }
  let register: Register;
  if (redisTransportConfigured) {
    const text = await redisCommand<string>(["HGET", `${redisProjectKey(req.params.projectId)}:sync:registers`, `${op.entityId}|${op.field}`]);
    const { valueEncrypted: encrypted, actorId: _actor, ...row } = JSON.parse(text) as WireRegister;
    register = { ...row, value: decrypt(encrypted, req.params.projectId, access.ownerId) };
  } else {
    const row = db.prepare("SELECT * FROM project_sync_registers WHERE project_id=? AND entity_id=? AND field=?").get(req.params.projectId, op.entityId, op.field) as { entity_id: string; field: Operation["field"]; logical_clock: number; client_id: string; operation_id: string; value_encrypted: string; sequence: number };
    register = { entityId: row.entity_id, field: row.field, logicalClock: row.logical_clock, clientId: row.client_id, operationId: row.operation_id, sequence: row.sequence, value: decrypt(row.value_encrypted, req.params.projectId, access.ownerId) };
  }
  if (resolveSession(req)?.status !== "active" || !canReadProject(getProjectAccess(req.params.projectId, req.user!.id))) { res.status(403).json({ error: "Project access changed during synchronization" }); return; }
  if (access.organizationId && !result.duplicate) organizationAudit(access.organizationId, req.user!.id, "coordination.operation", { projectId: req.params.projectId, entityId: op.entityId, field: op.field, sequence: result.sequence });
  res.status(result.duplicate ? 200 : 201).json({ sequence: result.sequence, applied: result.applied, duplicate: result.duplicate, maxClock: result.maxClock, register });
}));
export default router;
