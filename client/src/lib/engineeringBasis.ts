/** Project-specific adoption metadata. This catalog never supplies design coefficients. */
export const ENGINEERING_BASIS_PROFILE_VERSION = "country-basis-2026-10-03";
export const ENGINEERING_MODULES = ["frame", "water", "air", "electrical", "fire", "equipment"] as const;
export type EngineeringBasisModule = typeof ENGINEERING_MODULES[number];
export const ENGINEERING_STANDARD_DOMAINS = ["building", "loads", "seismic", "concrete", "steel", "mechanical", "electrical", "plumbing", "fire", "other"] as const;
export type EngineeringStandardDomain = typeof ENGINEERING_STANDARD_DOMAINS[number];

export interface EngineeringStandardReference {
  id: string;
  countryCode: string;
  domain: EngineeringStandardDomain;
  code: string;
  title: string;
  editions: readonly string[];
  sourceUrl: string;
}
export interface AdoptedEngineeringStandard {
  id: string;
  domain: EngineeringStandardDomain;
  code: string;
  edition: string;
  sourceUrl: string;
  adoptionReference: string;
  amendments: string;
}
export interface EngineeringUserCriterion {
  id: string;
  module: EngineeringBasisModule;
  name: string;
  value: number;
  unit: string;
  source: string;
  standardId?: string;
  clause?: string;
}
export interface EngineeringDesignBasis {
  version: 1;
  profileVersion: string;
  countryCode: string;
  region: string;
  authority: string;
  standards: AdoptedEngineeringStandard[];
  declaration: {
    occupancy: string;
    riskCategory: string;
    structuralSystem: string;
    material: string;
    soil: string;
    loads: string;
    hazards: string;
  };
  criteria: EngineeringUserCriterion[];
  confirmed: boolean;
  reviewer: string;
  reviewNote: string;
}

const bisCatalog = "https://www.bis.gov.in/know-your-standard/?lang=en";
const bisNbc = "https://www.bis.gov.in/standards/national-building-code/?lang=en";
const iccCodes = "https://www.iccsafe.org/about/periodicals-and-newsroom/the-international-code-council-releases-2024-international-codes/";
/** Named published editions, not a statement of current local adoption or complete support. */
export const ENGINEERING_STANDARD_REFERENCES: readonly EngineeringStandardReference[] = [
  { id: "in-nbc", countryCode: "IN", domain: "building", code: "NBC / SP 7", title: "National Building Code of India", editions: ["2016"], sourceUrl: bisNbc },
  { id: "in-is875-1", countryCode: "IN", domain: "loads", code: "IS 875 (Part 1)", title: "Dead loads", editions: ["1987"], sourceUrl: "https://www.services.bis.gov.in/php/BIS_2.0/bisconnect/Group_wise_standards_list/show_scope?row=MTU5MzE%3D" },
  { id: "in-is875-2", countryCode: "IN", domain: "loads", code: "IS 875 (Part 2)", title: "Imposed loads", editions: ["1987"], sourceUrl: bisCatalog },
  { id: "in-is875-3", countryCode: "IN", domain: "loads", code: "IS 875 (Part 3)", title: "Wind loads", editions: ["2015"], sourceUrl: bisCatalog },
  { id: "in-is1893-1", countryCode: "IN", domain: "seismic", code: "IS 1893 (Part 1)", title: "Earthquake resistant design: general provisions and buildings", editions: ["2016"], sourceUrl: bisCatalog },
  { id: "in-is456", countryCode: "IN", domain: "concrete", code: "IS 456", title: "Plain and reinforced concrete", editions: ["2000"], sourceUrl: bisCatalog },
  { id: "in-is800", countryCode: "IN", domain: "steel", code: "IS 800", title: "General construction in steel", editions: ["2007"], sourceUrl: bisCatalog },
  { id: "in-nbc-mechanical", countryCode: "IN", domain: "mechanical", code: "NBC Part 8, Section 3", title: "Air conditioning, heating and mechanical ventilation", editions: ["2016"], sourceUrl: bisNbc },
  { id: "in-nbc-electrical", countryCode: "IN", domain: "electrical", code: "NBC Part 8, Section 2", title: "Electrical and allied installations", editions: ["2016"], sourceUrl: bisNbc },
  { id: "in-nbc-plumbing", countryCode: "IN", domain: "plumbing", code: "NBC Part 9", title: "Plumbing services", editions: ["2016"], sourceUrl: bisNbc },
  { id: "in-nbc-fire", countryCode: "IN", domain: "fire", code: "NBC Part 4", title: "Fire and life safety", editions: ["2016"], sourceUrl: bisNbc },
  { id: "us-ibc", countryCode: "US", domain: "building", code: "IBC", title: "International Building Code", editions: ["2024"], sourceUrl: iccCodes },
  { id: "us-asce7", countryCode: "US", domain: "loads", code: "ASCE/SEI 7", title: "Minimum design loads and associated criteria for buildings and other structures", editions: ["2022"], sourceUrl: "https://www.asce.org/publications-and-news/asce-7" },
  { id: "us-aci318", countryCode: "US", domain: "concrete", code: "ACI CODE 318", title: "Building code requirements for structural concrete", editions: ["2019", "2019 (reapproved 2022)", "2025"], sourceUrl: "https://www.concrete.org/topicsinconcrete/318buildingcodeportal.aspx" },
  { id: "us-aisc360", countryCode: "US", domain: "steel", code: "ANSI/AISC 360", title: "Specification for structural steel buildings", editions: ["2022"], sourceUrl: "https://www.aisc.org/news/aisc-releases-new-version-of-specification-for-structural-steel-buildings-ansiaisc-360-22/" },
  { id: "us-imc", countryCode: "US", domain: "mechanical", code: "IMC", title: "International Mechanical Code", editions: ["2024"], sourceUrl: iccCodes },
  { id: "us-ashrae621", countryCode: "US", domain: "mechanical", code: "ANSI/ASHRAE 62.1", title: "Ventilation and acceptable indoor air quality", editions: ["2022"], sourceUrl: "https://www.ashrae.org/technical-resources/standards-and-guidelines/read-only-versions-of-ashrae-standards" },
  { id: "us-ipc", countryCode: "US", domain: "plumbing", code: "IPC", title: "International Plumbing Code", editions: ["2024"], sourceUrl: iccCodes },
  { id: "us-nfpa70", countryCode: "US", domain: "electrical", code: "NFPA 70 / NEC", title: "National Electrical Code", editions: ["2023", "2026"], sourceUrl: "https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70" },
];

export function countryName(code: string): string {
  return ({ IN: "India", US: "United States" } as Record<string, string>)[code] ?? (code || "Country not selected");
}
export function engineeringStandardReferences(countryCode: string): readonly EngineeringStandardReference[] {
  return ENGINEERING_STANDARD_REFERENCES.filter(reference => reference.countryCode === countryCode);
}
export function createEngineeringDesignBasis(countryCode = ""): EngineeringDesignBasis {
  return {
    version: 1, profileVersion: ENGINEERING_BASIS_PROFILE_VERSION, countryCode, region: "", authority: "", standards: [],
    declaration: { occupancy: "", riskCategory: "", structuralSystem: "", material: "", soil: "", loads: "", hazards: "" },
    criteria: [], confirmed: false, reviewer: "", reviewNote: "",
  };
}
/** Country changes require a new local adoption declaration and new criteria. */
export function changeEngineeringCountry(basis: EngineeringDesignBasis, countryCode: string): EngineeringDesignBasis {
  return basis.countryCode === countryCode ? basis : createEngineeringDesignBasis(countryCode);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, maximum = 500): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} must be text of at most ${maximum} characters.`);
  return value;
}
function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} must contain at most ${maximum} items.`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${path} is unsupported.`);
  return value as T;
}
export function parseEngineeringDesignBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "Design basis");
  if (raw.version !== 1) throw new Error("Unsupported engineering design basis version.");
  const countryCode = text(raw.countryCode, "countryCode", 2);
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new Error("countryCode must be an uppercase ISO alpha-2 code.");
  const declaration = record(raw.declaration, "declaration");
  if (typeof raw.confirmed !== "boolean") throw new Error("confirmed must be a boolean.");
  const standards = array(raw.standards, "standards", 40).map((entry, index): AdoptedEngineeringStandard => {
    const item = record(entry, `standards[${index}]`);
    return { id: text(item.id, "standard.id", 100), domain: choice(item.domain, ENGINEERING_STANDARD_DOMAINS, "standard.domain"), code: text(item.code, "standard.code", 160), edition: text(item.edition, "standard.edition", 100), sourceUrl: text(item.sourceUrl, "standard.sourceUrl", 2000), adoptionReference: text(item.adoptionReference, "standard.adoptionReference", 2000), amendments: text(item.amendments, "standard.amendments", 2000) };
  });
  const criteria = array(raw.criteria, "criteria", 64).map((entry, index): EngineeringUserCriterion => {
    const item = record(entry, `criteria[${index}]`);
    if (typeof item.value !== "number" || !Number.isFinite(item.value) || Math.abs(item.value) > 1e18) throw new Error("criterion.value must be finite and have magnitude at most 1e18.");
    return { id: text(item.id, "criterion.id", 100), module: choice(item.module, ENGINEERING_MODULES, "criterion.module"), name: text(item.name, "criterion.name", 200), value: item.value, unit: text(item.unit, "criterion.unit", 100), source: text(item.source, "criterion.source", 2000), ...(item.standardId === undefined ? {} : { standardId: text(item.standardId, "criterion.standardId", 100) }), ...(item.clause === undefined ? {} : { clause: text(item.clause, "criterion.clause", 200) }) };
  });
  return {
    version: 1, profileVersion: text(raw.profileVersion, "profileVersion", 100), countryCode,
    region: text(raw.region, "region"), authority: text(raw.authority, "authority"), standards,
    declaration: {
      occupancy: text(declaration.occupancy, "declaration.occupancy", 2000), riskCategory: text(declaration.riskCategory, "declaration.riskCategory", 2000), structuralSystem: text(declaration.structuralSystem, "declaration.structuralSystem", 2000), material: text(declaration.material, "declaration.material", 2000), soil: text(declaration.soil, "declaration.soil", 2000), loads: text(declaration.loads, "declaration.loads", 4000), hazards: text(declaration.hazards, "declaration.hazards", 4000),
    }, criteria, confirmed: raw.confirmed, reviewer: text(raw.reviewer, "reviewer"), reviewNote: text(raw.reviewNote, "reviewNote", 4000),
  };
}
export function isEngineeringSourceUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
/** Completeness checks metadata and traceability; it does not certify national-code compliance. */
export function validateEngineeringDesignBasis(value: EngineeringDesignBasis): string[] {
  let basis: EngineeringDesignBasis;
  try { basis = parseEngineeringDesignBasis(value); } catch (error) { return [error instanceof Error ? error.message : "Invalid design basis."]; }
  const errors: string[] = [];
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) errors.push("Review the design basis against the current reference catalog version.");
  if (!basis.countryCode) errors.push("Select the project country.");
  if (!basis.region.trim()) errors.push("Enter the state, region and municipality.");
  if (!basis.authority.trim()) errors.push("Enter the authority having jurisdiction.");
  if (!basis.standards.length) errors.push("Adopt at least one applicable project standard with its edition and local adoption reference.");
  const standardIds = new Set<string>();
  for (const standard of basis.standards) {
    if (!standard.id.trim() || standardIds.has(standard.id)) errors.push("Standard identifiers must be non-empty and unique.");
    standardIds.add(standard.id);
    if (!standard.code.trim() || !standard.edition.trim() || !standard.adoptionReference.trim() || !standard.amendments.trim()) errors.push(`${standard.code || "Standard"}: code, edition, adoption reference and amendments declaration are required (use 'none' if verified).`);
    if (!isEngineeringSourceUrl(standard.sourceUrl)) errors.push(`${standard.code || "Standard"}: supply an HTTPS publisher or authority reference.`);
    const reference = ENGINEERING_STANDARD_REFERENCES.find(entry => entry.id === standard.id);
    if (reference && (reference.countryCode !== basis.countryCode || reference.code !== standard.code || reference.domain !== standard.domain || !reference.editions.includes(standard.edition) || reference.sourceUrl !== standard.sourceUrl)) errors.push(`${standard.code}: the catalog reference does not match the selected country, edition or publisher. Add a custom reference for other editions.`);
  }
  for (const [key, entry] of Object.entries(basis.declaration)) if (!entry.trim()) errors.push(`Declare ${key}, including 'not applicable' with a reason where appropriate.`);
  const criterionIds = new Set<string>();
  for (const criterion of basis.criteria) {
    if (!criterion.id.trim() || criterionIds.has(criterion.id)) errors.push("Criterion identifiers must be non-empty and unique.");
    criterionIds.add(criterion.id);
    if (!criterion.name.trim() || !criterion.unit.trim() || !criterion.source.trim()) errors.push(`${criterion.name || "Criterion"}: name, unit and source are required.`);
    if (criterion.standardId && (!standardIds.has(criterion.standardId) || !criterion.clause?.trim())) errors.push(`${criterion.name}: select an adopted standard and declare the clause.`);
  }
  if (!basis.reviewer.trim()) errors.push("Enter the person or team recording the adoption review.");
  if (!basis.confirmed) errors.push("Confirm the project adoption and input declaration after review.");
  return errors;
}
/** A deterministic, complete comparison key; deliberately not a security digest. */
export function engineeringBasisFingerprint(basis: EngineeringDesignBasis): string {
  const normalized = parseEngineeringDesignBasis(basis);
  const compareIds = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  normalized.standards.sort(compareIds);
  normalized.criteria.sort(compareIds);
  return JSON.stringify(normalized);
}
