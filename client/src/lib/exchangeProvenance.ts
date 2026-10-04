import { parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord } from "./engineeringNumerics";

/** A declaration copied with an exchange, never evidence of design acceptance. */
export interface EngineeringExchangeProvenance {
  version: 1;
  kind: "engineering-design-basis";
  designBasis: EngineeringDesignBasis | null;
  declarationIssues: string[];
  verification: "unverified";
  nationalCodeCompliance: "not-assessed";
  scope: "Captured project declaration; exchange geometry and analysis remain independently unverified.";
}
export function engineeringExchangeProvenance(value?: unknown): EngineeringExchangeProvenance {
  const designBasis = value === undefined || value === null ? null : parseEngineeringDesignBasis(value);
  return { version: 1, kind: "engineering-design-basis", designBasis,
    declarationIssues: designBasis ? validateEngineeringDesignBasis(designBasis) : ["The source design has no declared engineering basis."],
    verification: "unverified", nationalCodeCompliance: "not-assessed",
    scope: "Captured project declaration; exchange geometry and analysis remain independently unverified." };
}
function strictCapturedBasis(value: unknown): EngineeringDesignBasis {
  const allowed = (raw: unknown, keys: readonly string[], name: string): Record<string, unknown> => {
    if (!engineeringRecord(raw) || Object.keys(raw).some(key => !keys.includes(key))) throw new Error(`${name} contains unsupported declaration fields.`);
    return raw;
  };
  const raw = allowed(value, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "Captured basis");
  allowed(raw.declaration, ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "Captured declaration");
  for (const [key, maximum, keys] of [["standards", 40, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]], ["criteria", 64, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]]] as const) {
    const entries = raw[key];
    if (!Array.isArray(entries) || entries.length > maximum) throw new Error(`Captured ${key} exceed the declaration limit.`);
    for (let index = 0; index < entries.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(entries, index)) throw new Error(`Captured ${key} cannot be sparse.`);
      allowed(entries[index], keys, `Captured ${key}`);
    }
  }
  return parseEngineeringDesignBasis(raw);
}
export function parseEngineeringExchangeProvenance(value: unknown): EngineeringExchangeProvenance {
  const keys = ["version", "kind", "designBasis", "declarationIssues", "verification", "nationalCodeCompliance", "scope"];
  if (!engineeringRecord(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || value.designBasis === undefined) throw new Error("Unsupported engineering exchange provenance.");
  const expected = engineeringExchangeProvenance(value.designBasis === null ? null : strictCapturedBasis(value.designBasis));
  if (value.version !== expected.version || value.kind !== expected.kind || value.verification !== expected.verification || value.nationalCodeCompliance !== expected.nationalCodeCompliance || value.scope !== expected.scope) throw new Error("Exchange provenance differs from its captured declaration or unverified scope.");
  if (!Array.isArray(value.declarationIssues) || value.declarationIssues.length > 1024) throw new Error("Exchange declaration issues must contain at most 1024 records.");
  const capturedIssues: string[] = [];
  for (let index = 0; index < value.declarationIssues.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value.declarationIssues, index)) throw new Error("Exchange declaration issues cannot be sparse.");
    const issue: unknown = value.declarationIssues[index];
    if (typeof issue !== "string" || issue.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(issue)) throw new Error("Exchange declaration issues must be bounded text.");
    capturedIssues.push(issue);
  }
  // Historical findings are source declarations, not evidence that today's catalog accepts the basis.
  // Preserve them verbatim and visibly add new review findings without rejecting a catalog upgrade.
  const declarationIssues = [...capturedIssues];
  for (const issue of expected.declarationIssues) {
    const current = `Current review: ${issue}`;
    if (!capturedIssues.includes(issue) && !capturedIssues.includes(current)) declarationIssues.push(current);
  }
  if (declarationIssues.length > 1024) throw new Error("Captured and current exchange declaration issues exceed 1024 records.");
  return { ...expected, declarationIssues };
}
/** A bounded conversion summary; the original exchange remains the record of captured findings. */
export function engineeringDeclarationReviewWarnings(provenance: EngineeringExchangeProvenance): string[] {
  const limit = 100, visible = provenance.declarationIssues.length > limit ? limit - 1 : limit;
  const warnings = provenance.declarationIssues.slice(0, visible).map(issue => `Source declaration review: ${issue}`);
  if (provenance.declarationIssues.length > visible) warnings.push(`Source declaration review: ${provenance.declarationIssues.length - visible} additional captured/current findings omitted from this conversion summary. Retain the original exchange for captured findings and review the current basis separately.`);
  return warnings;
}
/** JSON ASCII escaping keeps R2000 code-page comments independent of Unicode fonts. */
export function engineeringProvenanceAscii(value?: unknown): string {
  const json = JSON.stringify(engineeringExchangeProvenance(value)).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (json.length > 1_000_000) throw new Error("Engineering exchange provenance exceeds the 1 MB metadata limit.");
  return json;
}
