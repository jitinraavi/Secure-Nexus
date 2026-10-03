import { ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, identifier } from "./engineeringNumerics";
import { parseFrameModel3D, type FrameCombination3D, type FrameModel3D } from "./frameAnalysis3D";

/** Characteristic actions are authored inputs; this module generates factors, never hazards. */
export interface NationalLoadRecipeInput {
  version: 1; method: "in-is456-table18"; material: "reinforced-concrete";
  model: FrameModel3D; source: string; deadCaseId: string; imposedCaseId: string; windCaseIds: string[];
  includeStabilityCases: boolean; includeShortTermServiceability: boolean;
  characteristicActionsConfirmed: true; amendmentScopeConfirmed: true; amendmentReviewSource: string;
}
export interface NationalCombinationTrace {
  combinationId: string; limitState: "collapse" | "short-term-serviceability";
  purpose: string; clause: "36.4.1 / Table 18"; factors: Record<string, number>;
}
export interface NationalLoadRecipeReport {
  version: 1; implementation: "IS456-2000-Table18-gravity-wind-v1";
  verification: "unverified"; nationalCodeCompliance: "not-assessed";
  source: NationalLoadRecipeInput; designBasis: EngineeringDesignBasis;
  status: "generated-subset" | "unsupported-basis"; basisIssues: string[];
  generatedFrameModel: FrameModel3D | null; combinations: NationalCombinationTrace[]; warnings: string[];
}
const implementation = "IS456-2000-Table18-gravity-wind-v1";
const primarySource = "https://law.resource.org/pub/in/bis/S03/is.456.2000.pdf";
function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!engineeringRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${name} contains unsupported fields or is not an object.`);
  return value;
}
function text(value: unknown, name: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${name} requires bounded non-empty text.`);
  return value;
}
function caseId(value: unknown): string { if (!identifier(value)) throw new Error("Load case ID is invalid."); return value; }
export function parseNationalLoadRecipeInput(value: unknown): NationalLoadRecipeInput {
  const raw = record(value, ["version", "method", "material", "model", "source", "deadCaseId", "imposedCaseId", "windCaseIds", "includeStabilityCases", "includeShortTermServiceability", "characteristicActionsConfirmed", "amendmentScopeConfirmed", "amendmentReviewSource"], "National load recipe");
  if (raw.version !== 1 || raw.method !== "in-is456-table18" || raw.material !== "reinforced-concrete") throw new Error("Only version 1 Indian IS 456 Table 18 reinforced-concrete gravity/wind recipes are implemented.");
  if (raw.characteristicActionsConfirmed !== true || raw.amendmentScopeConfirmed !== true) throw new Error("Confirm characteristic actions and review of adopted amendment applicability to this implemented subset.");
  if (typeof raw.includeStabilityCases !== "boolean" || typeof raw.includeShortTermServiceability !== "boolean") throw new Error("Recipe options must be explicit booleans.");
  if (!Array.isArray(raw.windCaseIds) || raw.windCaseIds.length > 3) throw new Error("Supply at most three complete wind patterns; divide larger studies into declared subsystems.");
  // Normalize and detach the source. Existing combinations are retained as provenance,
  // then replaced in the generated draft; no structural analysis is performed here.
  const validatedModel = parseFrameModel3D(raw.model);
  const model = parseFrameModel3D(JSON.parse(JSON.stringify(validatedModel)) as unknown), deadCaseId = caseId(raw.deadCaseId), imposedCaseId = caseId(raw.imposedCaseId), windCaseIds = raw.windCaseIds.map(caseId);
  const mapped = [deadCaseId, imposedCaseId, ...windCaseIds];
  if (new Set(mapped).size !== mapped.length || mapped.length !== model.loadCases.length || model.loadCases.some(loadCase => !mapped.includes(loadCase.id))) throw new Error("Map every source case exactly once to dead, imposed or a complete wind pattern. Other actions require a separate supported method.");
  return { version: 1, method: "in-is456-table18", material: "reinforced-concrete", model,
    source: text(raw.source, "Characteristic action source"), deadCaseId, imposedCaseId, windCaseIds,
    includeStabilityCases: raw.includeStabilityCases, includeShortTermServiceability: raw.includeShortTermServiceability,
    characteristicActionsConfirmed: true, amendmentScopeConfirmed: true, amendmentReviewSource: text(raw.amendmentReviewSource, "Amendment scope review") };
}
function adoptionIssues(basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "IN") issues.push("This recipe implements Indian IS 456 only; no Indian factors are applied to another country.");
  const adopted = basis.standards.filter(item => item.code === "IS 456" && item.domain === "concrete");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "in-is456")!;
  if (adopted.length !== 1 || adopted[0].id !== reference.id || adopted[0].edition !== "2000" || adopted[0].sourceUrl !== reference.sourceUrl) issues.push("Adopt exactly one catalog IS 456:2000 reference. Other editions and custom amended algorithms remain unsupported.");
  return [...new Set(issues)];
}
function recipes(source: NationalLoadRecipeInput): NationalCombinationTrace[] {
  const rows: NationalCombinationTrace[] = [], dead = source.deadCaseId, imposed = source.imposedCaseId;
  const add = (id: string, service: boolean, purpose: string, factors: Record<string, number>) => rows.push({ combinationId: id, limitState: service ? "short-term-serviceability" : "collapse", purpose, clause: "36.4.1 / Table 18", factors });
  add("is456-uls-gravity", false, "Dead and imposed characteristic actions", { [dead]: 1.5, [imposed]: 1.5 });
  if (source.includeShortTermServiceability) add("is456-sls-gravity", true, "Short-term dead and imposed actions", { [dead]: 1, [imposed]: 1 });
  source.windCaseIds.forEach((wind, index) => {
    const suffix = index + 1;
    add(`is456-uls-wind-${suffix}`, false, "Dead and complete supplied wind pattern", { [dead]: 1.5, [wind]: 1.5 });
    add(`is456-uls-imposed-wind-${suffix}`, false, "Dead, imposed and complete supplied wind pattern", { [dead]: 1.2, [imposed]: 1.2, [wind]: 1.2 });
    if (source.includeStabilityCases) add(`is456-uls-stability-${suffix}`, false, "Reduced dead action for critical overturning or stress reversal; applicability is declared", { [dead]: 0.9, [wind]: 1.5 });
    if (source.includeShortTermServiceability) {
      add(`is456-sls-wind-${suffix}`, true, "Short-term dead and supplied wind pattern", { [dead]: 1, [wind]: 1 });
      add(`is456-sls-imposed-wind-${suffix}`, true, "Short-term concurrent imposed and wind actions", { [dead]: 1, [imposed]: 0.8, [wind]: 0.8 });
    }
  });
  return rows;
}
const warnings = (source: NationalLoadRecipeInput): string[] => [
  `Verified formula source: BIS-authored IS 456:2000, 2007 reprint including amendments 1/2, clause 36.4.1 and Table 18 (${primarySource}). Later adopted amendment applicability is the explicitly supplied review declaration.`,
  "This generates a bounded factor subset, not a structural calculation or whole-code assessment. Higher factors required by serious consequences or an authority override are not generated; use reviewed explicit combinations instead.",
  "Dead and imposed cases must already aggregate their intended simultaneous characteristic actions. Each wind case is a complete separately authored pattern. No negative wind pattern, spatial distribution, hazard, pressure, internal/external pressure pairing, loading pattern or live-load reduction is inferred.",
  "Generated combinations replace the source combinations in a separate draft. Collapse and short-term serviceability combinations are identified separately; do not apply one resistance or drift criterion indiscriminately to both families.",
  "Earthquake combinations, directional/modal response rules, accidental torsion, soil/retaining pressure, fluid/snow/temperature/construction actions, long-term creep, imposed-load pattern alternatives and whole-building stability checks remain unsupported.",
  ...(!source.includeStabilityCases ? ["Reduced dead-load stability cases were not requested; overturning/stress-reversal applicability still requires separate review."] : []),
  ...(!source.includeShortTermServiceability ? ["Short-term serviceability combinations were not requested; serviceability remains unassessed."] : []),
];
/** Factor generation only. No frame analyzer or native solver is called. */
export function generateNationalLoadRecipes(value: NationalLoadRecipeInput, declaredBasis: EngineeringDesignBasis): NationalLoadRecipeReport {
  const source = parseNationalLoadRecipeInput(value), designBasis = parseEngineeringDesignBasis(declaredBasis), basisIssues = adoptionIssues(designBasis);
  const combinations = basisIssues.length ? [] : recipes(source);
  const frameCombinations: FrameCombination3D[] = combinations.map(row => ({ id: row.combinationId, factors: { ...row.factors } }));
  const generatedFrameModel = basisIssues.length ? null : parseFrameModel3D({ ...source.model, combinations: frameCombinations });
  return { version: 1, implementation, verification: "unverified", nationalCodeCompliance: "not-assessed", source, designBasis,
    status: basisIssues.length ? "unsupported-basis" : "generated-subset", basisIssues, generatedFrameModel, combinations, warnings: warnings(source) };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (engineeringRecord(value)) return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
/** Restore checks factor/source correspondence without calculating structural response. */
export function validateNationalLoadRecipeReport(value: unknown, input: NationalLoadRecipeInput, basis: EngineeringDesignBasis): value is NationalLoadRecipeReport {
  try {
    const raw = record(value, ["version", "implementation", "verification", "nationalCodeCompliance", "source", "designBasis", "status", "basisIssues", "generatedFrameModel", "combinations", "warnings"], "National load recipe report");
    const expected = generateNationalLoadRecipes(input, basis);
    if (engineeringBasisFingerprint(parseEngineeringDesignBasis(raw.designBasis)) !== engineeringBasisFingerprint(expected.designBasis)) return false;
    return canonical(raw) === canonical(expected);
  } catch { return false; }
}
export function nationalLoadRecipeExample(): NationalLoadRecipeInput {
  return { version: 1, method: "in-is456-table18", material: "reinforced-concrete",
    model: { version: 1, analysis: "linear", nodes: [{ id: "base", xM: 0, yM: 0, zM: 0, restraints: [true, true, true, true, true, true] }, { id: "tip", xM: 3, yM: 0, zM: 0, restraints: [false, false, false, false, false, false] }],
      members: [{ id: "beam", start: "base", end: "tip", areaM2: 0.18, inertiaYM4: 0.0054, inertiaZM4: 0.00135, torsionConstantM4: 0.003, elasticModulusPa: 3e10, shearModulusPa: 1.2e10, localYAxis: [0, 1, 0] }],
      loadCases: [{ id: "dead", nodal: [{ node: "tip", fxN: 0, fyN: 0, fzN: -10000, mxNm: 0, myNm: 0, mzNm: 0 }], uniform: [] }, { id: "imposed", nodal: [{ node: "tip", fxN: 0, fyN: 0, fzN: -5000, mxNm: 0, myNm: 0, mzNm: 0 }], uniform: [] }, { id: "wind-positive", nodal: [{ node: "tip", fxN: 0, fyN: 2000, fzN: 0, mxNm: 0, myNm: 0, mzNm: 0 }], uniform: [] }] },
    source: "Illustrative characteristic action patterns and elastic properties only; replace with a reviewed project model. No calculated result or hazard is supplied.", deadCaseId: "dead", imposedCaseId: "imposed", windCaseIds: ["wind-positive"],
    includeStabilityCases: true, includeShortTermServiceability: true, characteristicActionsConfirmed: true, amendmentScopeConfirmed: true,
    amendmentReviewSource: "Illustrative declaration only; replace with review of applicable adopted amendments against the implemented IS 456:2000 reprint." };
}
