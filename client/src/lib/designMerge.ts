import type { Design, ProjectType } from "../types";

export interface MergeDocument { design: Design; name: string; projectType: ProjectType }
export type MergeChoice = "local" | "remote";
export interface MergeConflict { key: string; path: string; kind: "value" | "order"; base: unknown; local: unknown; remote: unknown }
export interface MergeResult { document: MergeDocument; conflicts: MergeConflict[]; unresolved: number }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const missing = Symbol("missing");
type Value = Json | typeof missing;
type Entity = { [key: string]: Json } & { id: string };
const object = (value: Value): value is { [key: string]: Json } => value !== missing && value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a: Value, b: Value): boolean => {
  if (a === b) return true;
  if (a === missing || b === missing || a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (object(a) && object(b)) { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key])); }
  return false;
};
const keyed = (values: Json[]): values is Entity[] => {
  const ids = new Set<string>();
  return values.every(value => { if (!object(value) || typeof value.id !== "string" || ids.has(value.id)) return false; ids.add(value.id); return true; });
};
function snapshot(document: MergeDocument): Json {
  const text = JSON.stringify(document);
  if (text.length > 4_000_000) throw new Error("A merge document exceeds the 4,000,000-character project limit.");
  const value = JSON.parse(text) as Json;
  const pending: { value: Json; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 150000 || item.depth > 64) throw new Error("The merge exceeds the supported model depth or item count.");
    if (item.value && typeof item.value === "object") for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
  }
  return value;
}

/** Three-way JSON merge. ID-keyed arrays merge entities; coordinate/non-ID arrays stay atomic. */
export function mergeDesignDocuments(baseDocument: MergeDocument, localDocument: MergeDocument, remoteDocument: MergeDocument, choices: Record<string, MergeChoice> = {}): MergeResult {
  const base = snapshot(baseDocument), local = snapshot(localDocument), remote = snapshot(remoteDocument);
  const conflicts: MergeConflict[] = [];
  let visited = 0, unresolved = 0;
  const conflict = (path: string[], kind: "value" | "order", a: Value, l: Value, r: Value): Value => {
    if (conflicts.length >= 5000) throw new Error("This merge has more than 5,000 conflicts. Narrow the changes or preserve them as separate project copies.");
    const key = JSON.stringify([...path, kind]);
    conflicts.push({ key, path: path.join(" / ") || "document", kind, base: a === missing ? undefined : a, local: l === missing ? undefined : l, remote: r === missing ? undefined : r });
    const choice = choices[key];
    if (!choice) unresolved++;
    return choice === "remote" ? r : l;
  };
  const merge = (a: Value, l: Value, r: Value, path: string[]): Value => {
    if (++visited > 150000 || path.length > 64) throw new Error("The merge exceeds the supported model depth or item count.");
    if (equal(l, r)) return l;
    if (equal(l, a)) return r;
    if (equal(r, a)) return l;
    if (object(a) && object(l) && object(r)) {
      const result = Object.create(null) as { [key: string]: Json };
      for (const key of new Set([...Object.keys(a), ...Object.keys(l), ...Object.keys(r)])) {
        const get = (item: { [key: string]: Json }): Value => Object.prototype.hasOwnProperty.call(item, key) ? item[key] : missing;
        const value = merge(get(a), get(l), get(r), [...path, key]);
        if (value !== missing) result[key] = value;
      }
      return result;
    }
    if (Array.isArray(a) && Array.isArray(l) && Array.isArray(r) && keyed(a) && keyed(l) && keyed(r)) {
      const byId = (items: Entity[]) => new Map(items.map(item => [item.id, item]));
      const am = byId(a), lm = byId(l), rm = byId(r), values = new Map<string, Json>();
      for (const id of new Set([...am.keys(), ...lm.keys(), ...rm.keys()])) {
        const value = merge(am.get(id) ?? missing, lm.get(id) ?? missing, rm.get(id) ?? missing, [...path, "[" + id + "]"]);
        if (value !== missing) values.set(id, value);
      }
      const ids = (items: Entity[]) => items.map(item => item.id).filter(id => values.has(id));
      const ai = ids(a), li = ids(l), ri = ids(r);
      const shared = li.filter(id => rm.has(id)), sharedSet = new Set(shared);
      const commonBase = new Set(shared.filter(id => am.has(id)));
      const ac = ai.filter(id => commonBase.has(id)), lc = li.filter(id => commonBase.has(id)), rc = ri.filter(id => commonBase.has(id));
      const localMoved = !equal(ac, lc), remoteMoved = !equal(ac, rc);
      const commonLocal = li.filter(id => sharedSet.has(id)), commonRemote = ri.filter(id => sharedSet.has(id));
      const newShared = shared.some(id => !am.has(id));
      let order = remoteMoved && !localMoved ? ri : li;
      if (((localMoved && remoteMoved) || newShared) && !equal(commonLocal, commonRemote)) order = conflict([...path, "$order"], "order", ai, li, ri) as string[];
      return [...new Set([...order, ...li, ...ri, ...ai])].map(id => values.get(id)!);
    }
    return conflict(path, "value", a, l, r);
  };
  const merged = merge(base, local, remote, []);
  if (!object(merged) || !object(merged.design) || !object(merged.design.room) || !Array.isArray(merged.design.furniture) || typeof merged.name !== "string" || typeof merged.projectType !== "string") throw new Error("The merged document is missing required project fields.");
  if (JSON.stringify(merged).length > 4_000_000) throw new Error("The merged document exceeds the project size limit.");
  return { document: merged as unknown as MergeDocument, conflicts, unresolved };
}
