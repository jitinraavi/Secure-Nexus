import { importIfcGeometry, type IfcDocument, type StepEntity, type StepValue } from "./ifcGeometry";

const TYPES = ["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER", "IFCBOOLEAN", "IFCINTEGER", "IFCREAL"] as const;
export type IfcEditableDataType = typeof TYPES[number];
export interface IfcPropertyEdit { productGlobalId: string; propertySet: string; name: string; dataType: IfcEditableDataType; value: string | boolean | number }
export interface IfcPropertyEdits { version: 1; edits: IfcPropertyEdit[] }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error("Unsupported IFC property edit fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`IFC edit text must contain at most ${maximum} printable characters.`);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const low = value.charCodeAt(++i); if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error("IFC edit text contains an unpaired surrogate."); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("IFC edit text contains an unpaired surrogate.");
  }
  return value;
}
export function parseIfcPropertyEdits(value: unknown): IfcPropertyEdits {
  const raw = record(value, ["version", "edits"]);
  if (raw.version !== 1 || !Array.isArray(raw.edits) || raw.edits.length > 100) throw new Error("IFC property edits require version 1 and at most 100 records.");
  const sourceEdits = raw.edits;
  if (Reflect.ownKeys(sourceEdits).some(key => typeof key !== "string" || key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= sourceEdits.length))) throw new Error("IFC property edit arrays cannot contain extra fields.");
  const edits: IfcPropertyEdit[] = [], identities = new Set<string>();
  for (let index = 0; index < raw.edits.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(raw.edits, index)) throw new Error("IFC property edits cannot be sparse.");
    const item = record(raw.edits[index], ["productGlobalId", "propertySet", "name", "dataType", "value"]);
    const productGlobalId = text(item.productGlobalId, 22), propertySet = text(item.propertySet, 255), name = text(item.name, 255);
    if (!/^[0-3][0-9A-Za-z_$]{21}$/.test(productGlobalId) || !propertySet || !name || typeof item.dataType !== "string" || !TYPES.includes(item.dataType as IfcEditableDataType)) throw new Error("IFC property target or primitive data type is unsupported.");
    const dataType = item.dataType as IfcEditableDataType;
    let next: string | boolean | number;
    if (["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(dataType)) next = text(item.value, dataType === "IFCTEXT" ? 2000 : 255);
    else if (dataType === "IFCBOOLEAN") { if (typeof item.value !== "boolean") throw new Error("IfcBoolean edits require JSON true or false."); next = item.value; }
    else { if (typeof item.value !== "number" || !Number.isFinite(item.value) || Math.abs(item.value) > 1e100 || dataType === "IFCINTEGER" && !Number.isSafeInteger(item.value)) throw new Error("IFC numeric edits require bounded finite numbers; integers must be safe."); next = item.value; }
    const identity = JSON.stringify([productGlobalId, propertySet, name]);
    if (identities.has(identity)) throw new Error("Duplicate IFC property edit target."); identities.add(identity);
    edits.push({ productGlobalId, propertySet, name, dataType, value: next });
  }
  return { version: 1, edits };
}
function reference(value: StepValue | undefined): number | undefined { return value && typeof value === "object" && !Array.isArray(value) && "ref" in value ? value.ref : undefined; }
/** Locate only the third argument's token, retaining surrounding whitespace and comments. */
function nominalRange(source: string, entity: StepEntity): [number, number] {
  if (!Number.isSafeInteger(entity.start) || !Number.isSafeInteger(entity.end) || entity.start < 0 || entity.end > source.length || entity.start >= entity.end || !new RegExp(`^#${entity.id}\\s*=\\s*IFCPROPERTYSINGLEVALUE\\b`, "i").test(source.slice(entity.start, entity.end))) throw new Error("IFC source property range is stale or malformed.");
  let i = entity.start, depth = 0, argument = 0, first = -1, last = -1;
  while (i < entity.end) {
    if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0 || end >= entity.end) throw new Error("Malformed IFC source comment."); i = end + 2; continue; }
    const ch = source[i];
    if (!depth) { if (ch === "(") depth = 1; i++; continue; }
    if (depth === 1 && (ch === "," || ch === ")")) {
      if (argument === 2) { if (first < 0 || last < first) throw new Error("IFC nominal value token is missing."); return [first, last]; }
      if (ch === ")") break; argument++; first = last = -1; i++; continue;
    }
    if (!/\s/.test(ch)) { if (first < 0) first = i; last = i + 1; }
    if (ch === "'") {
      i++; let closed = false;
      while (i < entity.end) { if (source[i++] === "'") { if (source[i] === "'") i++; else { closed = true; break; } } }
      if (!closed) throw new Error("Malformed IFC source string."); last = i; continue;
    }
    if (ch === "(") depth++; else if (ch === ")") depth--; i++;
  }
  throw new Error("IFC nominal value source range was not found.");
}
function nominalToken(edit: IfcPropertyEdit): string {
  let token: string;
  if (typeof edit.value === "string") {
    let encoded = "";
    for (let i = 0; i < edit.value.length; i++) {
      const code = edit.value.codePointAt(i)!;
      if (code > 0xffff) { encoded += `\\X4\\${code.toString(16).padStart(8, "0").toUpperCase()}\\X0\\`; i++; }
      else encoded += code > 126 ? `\\X2\\${code.toString(16).padStart(4, "0").toUpperCase()}\\X0\\` : edit.value[i] === "\\" ? "\\\\" : edit.value[i] === "'" ? "''" : edit.value[i];
    }
    token = `'${encoded}'`;
  } else if (typeof edit.value === "boolean") token = edit.value ? ".T." : ".F.";
  else if (edit.dataType === "IFCINTEGER") token = String(edit.value);
  else { const [mantissa, exponent] = String(edit.value).split(/[eE]/); token = `${mantissa.includes(".") ? mantissa : `${mantissa}.`}${exponent === undefined ? "" : `E${exponent}`}`; }
  return `${edit.dataType}(${token})`;
}
/** Patch existing exclusive occurrence properties; callers must reimport the returned source before further edits/checks. */
export function exportIfcPropertyEdits(suppliedDocument: IfcDocument, value: unknown): string {
  const request = parseIfcPropertyEdits(value);
  if (typeof suppliedDocument.source !== "string" || suppliedDocument.source.length > 20_000_000) throw new Error("IFC source authoring bounds exceeded.");
  if (!request.edits.length) return suppliedDocument.source;
  // Source bytes are authoritative; mutable supplied entity/metadata caches cannot establish ownership.
  const document = importIfcGeometry(suppliedDocument.source);
  const references = new Map<number, number>(), globals = new Map<string, number>(), assignmentsBySet = new Map<number, StepEntity[]>(); let steps = 0;
  const count = (value: StepValue, depth = 0): void => {
    if (++steps > 1_000_000 || depth > 32) throw new Error("IFC edit reference scan budget exceeded.");
    const id = reference(value);
    if (id !== undefined) references.set(id, (references.get(id) ?? 0) + 1);
    else if (Array.isArray(value)) for (const item of value) count(item, depth + 1);
    else if (value && typeof value === "object" && "type" in value) for (const item of value.values) count(item, depth + 1);
  };
  for (const entity of document.entities.values()) {
    if (typeof entity.args[0] === "string" && /^[0-3][0-9A-Za-z_$]{21}$/.test(entity.args[0])) globals.set(entity.args[0], (globals.get(entity.args[0]) ?? 0) + 1);
    if (entity.type === "IFCRELDEFINESBYPROPERTIES") { const setId = reference(entity.args[5]); if (setId !== undefined) { const assignments = assignmentsBySet.get(setId) ?? []; assignments.push(entity); assignmentsBySet.set(setId, assignments); } }
    for (const argument of entity.args) count(argument);
  }
  const patches: { start: number; end: number; text: string }[] = [], editedProperties = new Set<number>();
  for (const edit of request.edits) {
    const matches = document.products.filter(product => product.globalId === edit.productGlobalId);
    if (matches.length !== 1 || globals.get(edit.productGlobalId) !== 1) throw new Error("IFC property edits require one unique source GlobalId.");
    const product = matches[0];
    if (product.metadataIssues?.length) throw new Error("Ambiguous or unsupported product metadata prevents property authoring.");
    const entries = Object.values(product.propertyValues ?? {}).filter(entry => entry.propertySet === edit.propertySet && entry.name === edit.name);
    if (entries.length !== 1 || !entries[0].supported || entries[0].origin !== "occurrence" || entries[0].unit !== null || entries[0].dataType !== edit.dataType || entries[0].value === null) throw new Error("Edit only an existing supported unitless direct occurrence property with the same primitive type.");
    const entry = entries[0], property = document.entities.get(entry.propertyStepId), set = document.entities.get(entry.propertySetStepId);
    if (property?.type !== "IFCPROPERTYSINGLEVALUE" || property.args.length !== 4 || property.args[0] !== edit.name || property.args[3] !== null || set?.type !== "IFCPROPERTYSET" || set.args.length !== 5 || set.args[2] !== edit.propertySet || !Array.isArray(set.args[4]) || set.args[4].filter(ref => reference(ref) === property.id).length !== 1 || references.get(property.id) !== 1 || references.get(set.id) !== 1) throw new Error("Shared, unresolved or malformed property/set references prevent exclusive authoring.");
    const assignments = assignmentsBySet.get(set.id) ?? [];
    if (assignments.length !== 1 || assignments[0].args.length !== 6 || !Array.isArray(assignments[0].args[4]) || assignments[0].args[4].length !== 1 || reference(assignments[0].args[4][0]) !== product.stepId) throw new Error("Property set must have one direct relationship to exactly the selected product.");
    if (editedProperties.has(property.id)) throw new Error("Multiple edits resolve to the same source property."); editedProperties.add(property.id);
    if (entry.value === edit.value) continue;
    const [start, end] = nominalRange(document.source, property); patches.push({ start, end, text: nominalToken(edit) });
  }
  patches.sort((a, b) => b.start - a.start);
  for (let i = 1; i < patches.length; i++) if (patches[i].end > patches[i - 1].start) throw new Error("Overlapping IFC edit source ranges.");
  let result = document.source;
  for (const patch of patches) result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
  if (result.length > 20_000_000) throw new Error("Edited IFC source exceeds 20 MB.");
  return result;
}
