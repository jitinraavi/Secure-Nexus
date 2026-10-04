import { IFC_METADATA_PRODUCT_CLASSES, IFC_SUPPORTED_SCHEMAS, type IfcDocument, type IfcProduct, type IfcPropertyValue } from "./ifcGeometry";
import { createIfcMeasureNormalizer, idsFloatEquivalent, isIfcMeasureType, parseIdsFloatLiteral, parseIdsMeasureLiteral, supportsIfcMeasureType, type IfcMeasureNormalizer } from "./ifcMeasureUnits";

export interface BimFinding { specification: string; globalId?: string; status: "pass" | "fail" | "unsupported"; message: string }
export interface BimValidationReport { status: "pass" | "fail" | "incomplete"; findings: BimFinding[]; checkedProducts: number; certification: false }
type Facet = { kind: "entity" | "attribute" | "property"; name: string; propertySet?: string; value?: string; predefinedType?: string; dataType?: string; expectedPrimitive?: string | number | boolean; cardinality: "required" | "optional" | "prohibited" };
interface Specification { name: string; versions: string[]; applicability: Facet[]; requirements: Facet[]; min: number; max: number }
const NS = "http://standards.buildingsmart.org/IDS";
const PRIMITIVE_TYPES = ["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER", "IFCBOOLEAN", "IFCINTEGER", "IFCREAL"];
const children = (e: Element, name?: string) => Array.from(e.children).filter(c => c.namespaceURI === NS && (!name || c.localName === name));
function literal(element: Element, name: string, required: boolean): string | undefined {
  const fields = children(element, name); if (fields.length > 1) throw new Error(`Duplicate ${name}.`); const field = fields[0]; if (!field) { if (required) throw new Error(`Missing ${name}.`); return undefined; }
  const simple = children(field, "simpleValue"); if (simple.length !== 1 || field.children.length !== 1 || simple[0].children.length || field.attributes.length || simple[0].attributes.length) throw new Error(`${name} uses an unsupported restriction/structure; only plain simpleValue is supported.`);
  const value = simple[0].textContent ?? ""; if (value.length > 2000) throw new Error(`${name} literal exceeds the 2,000-character subset limit.`); return value;
}
function primitive(value: string, dataType: string): string | number | boolean {
  if (["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(dataType)) return value;
  if (dataType === "IFCBOOLEAN") { if (!/^(true|false|0|1)$/.test(value)) throw new Error("Boolean IDS literals require XML true/false/0/1."); return value === "true" || value === "1"; }
  if (dataType === "IFCINTEGER") { if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("IDS integer literal must be a safe integer."); return Number(value); }
  if (dataType === "IFCREAL") return parseIdsFloatLiteral(value);
  throw new Error("Logical, date and other typed values are outside the primitive/SI IDS subset.");
}
function facets(element: Element, schema: string): Facet[] {
  if (!element.children.length || element.children.length > 20) throw new Error("Each facet group must contain 1–20 facets.");
  if (Array.from(element.children).some(e => e.namespaceURI !== NS)) throw new Error("Foreign-namespace facets are unsupported.");
  return children(element).map(e => {
    const cardinality = e.getAttribute("cardinality") ?? "required";
    if (!["required", "optional", "prohibited"].includes(cardinality)) throw new Error("Unsupported facet cardinality.");
    const base = { cardinality: cardinality as Facet["cardinality"] };
    if (Array.from(e.attributes).some(a => a.namespaceURI || !["cardinality", "instructions", "uri", "dataType"].includes(a.localName))) throw new Error("Unsupported facet attribute.");
    const allowed: Record<string, string[]> = { entity: ["name", "predefinedType"], attribute: ["name", "value"], property: ["propertySet", "baseName", "value"] };
    if (!(e.localName in allowed) || Array.from(e.children).some(c => c.namespaceURI !== NS || !allowed[e.localName].includes(c.localName))) throw new Error(`Unsupported child structure in ${e.localName} facet.`);
    if (e.localName === "entity") { if (cardinality !== "required" || e.hasAttribute("cardinality") || e.hasAttribute("dataType")) throw new Error("Entity facets do not have cardinality or dataType attributes."); const name = literal(e, "name", true)!, predefinedType = literal(e, "predefinedType", false); if (!IFC_METADATA_PRODUCT_CLASSES.includes(name) || predefinedType !== undefined && !predefinedType) throw new Error("IDS entity names must be exact supported uppercase occurrence classes and predefined-type literals must be non-empty."); return { ...base, kind: "entity", name, ...(predefinedType === undefined ? {} : { predefinedType }) }; }
    if (e.localName === "attribute") { const name = literal(e, "name", true)!, value = literal(e, "value", false); if (e.hasAttribute("dataType") || !["GlobalId", "Name", "Description", "ObjectType"].includes(name)) throw new Error(`Attribute ${name} is outside the supported string attribute subset or has an unsupported dataType attribute.`); if (cardinality === "optional" && value === undefined) throw new Error("An optional IDS attribute requires a value constraint."); return { ...base, kind: "attribute", name, ...(value === undefined ? {} : { value }) }; }
    if (e.localName === "property") {
      const name = literal(e, "baseName", true)!, propertySet = literal(e, "propertySet", true)!, value = literal(e, "value", false), dataType = e.getAttribute("dataType") ?? undefined;
      if (!name || !propertySet) throw new Error("IDS property names and sets must be non-empty literals.");
      if (dataType !== undefined && !PRIMITIVE_TYPES.includes(dataType) && !supportsIfcMeasureType(dataType, schema)) throw new Error(`IDS dataType ${dataType} is outside the primitive/direct-SI measure subset for ${schema}.`);
      if (value !== undefined && dataType === undefined) throw new Error("An IDS property value requires its explicit dataType; textual guessing is unsupported.");
      if (cardinality === "optional" && dataType === undefined || cardinality === "prohibited" && (dataType !== undefined || value !== undefined)) throw new Error("Optional property facets require dataType/value constraints; prohibited properties require a whole-property absence check.");
      return { ...base, kind: "property", name, propertySet, ...(value === undefined ? {} : { value, expectedPrimitive: isIfcMeasureType(dataType!) ? parseIdsMeasureLiteral(value, dataType!, schema) : primitive(value, dataType!) }), ...(dataType === undefined ? {} : { dataType }) };
    }
    throw new Error(`Unsupported IDS facet ${e.localName}.`);
  });
}
const field = (p: IfcProduct, f: Facet): string | undefined => f.kind === "entity" ? p.type : f.kind === "attribute" ? p.attributes[f.name] : p.properties[`${f.propertySet}.${f.name}`];
function property(p: IfcProduct, f: Facet): IfcPropertyValue | undefined { return p.propertyValues?.[`${f.propertySet}.${f.name}`]; }
function exists(p: IfcProduct, f: Facet): boolean { return f.kind === "property" ? property(p, f) !== undefined || Object.prototype.hasOwnProperty.call(p.properties, `${f.propertySet}.${f.name}`) : field(p, f) !== undefined && (field(p, f) !== "" || p.attributePresence?.[f.name] === true); }
function predefinedTypes(p: IfcProduct): string[] {
  const type = p.declaredType, raw = type?.predefinedType || p.attributes.PredefinedType;
  if (!raw) return [];
  const custom = type?.predefinedType ? type.elementType : p.attributes.ObjectType;
  return raw === "USERDEFINED" ? custom ? [custom] : [] : [raw];
}
function matches(p: IfcProduct, f: Facet, normalizeMeasure: IfcMeasureNormalizer): boolean {
  const v = field(p, f);
  if (f.kind === "entity") return v === f.name && (f.predefinedType === undefined || predefinedTypes(p).includes(f.predefinedType));
  if (f.kind === "attribute") return exists(p, f) && v !== "" && (f.value === undefined || v === f.value);
  const value = property(p, f); if (!value || !value.supported || value.value === null || value.value === "" || value.propertySet !== f.propertySet || value.name !== f.name) return false;
  if (f.dataType !== undefined && value.dataType !== f.dataType) return false;
  if (f.value === undefined) return true;
  if (isIfcMeasureType(value.dataType)) { const normalized = normalizeMeasure(value); return normalized.supported && typeof f.expectedPrimitive === "number" && idsFloatEquivalent(normalized.siValue, f.expectedPrimitive); }
  return value.dataType === "IFCREAL" && typeof value.value === "number" && typeof f.expectedPrimitive === "number" ? idsFloatEquivalent(value.value, f.expectedPrimitive) : value.value === f.expectedPrimitive;
}

/** IDS XML literal entity/attribute/property subset. Unsupported facets fail closed as incomplete. */
export function validateIds(document: IfcDocument, xml: string): BimValidationReport {
  if (xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("IDS XML must be at most 2 MB and cannot contain DTD/entity declarations.");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length || dom.documentElement.namespaceURI !== NS || dom.documentElement.localName !== "ids") throw new Error("Invalid IDS XML root/namespace.");
  if (Array.from(dom.documentElement.children).some(c => c.namespaceURI !== NS || !["info", "specifications"].includes(c.localName)) || children(dom.documentElement, "info").length > 1) throw new Error("Unsupported IDS root child structure.");
  const containers = children(dom.documentElement, "specifications"); if (containers.length !== 1 || Array.from(containers[0].children).some(c => c.namespaceURI !== NS || c.localName !== "specification")) throw new Error("IDS requires one specifications group containing only IDS specifications.");
  const normalizeMeasure = createIfcMeasureNormalizer(document);
  const importedSteps = new Set(document.products.map(p => p.stepId)), omittedTypes = new Set([...document.entities.values()].filter(e => !importedSteps.has(e.id)).map(e => e.type));
  const finding: BimFinding[] = [], checked = new Set<string>(), nodes = children(containers[0], "specification"); let checks = 0;
  const globalIds = new Set<string>(); for (const p of document.products) { if (globalIds.has(p.globalId)) finding.push({ specification: "Model identity", globalId: p.globalId, status: "unsupported", message: "Duplicate GlobalId prevents unambiguous IDS product identity." }); globalIds.add(p.globalId); }
  if (!nodes.length || nodes.length > 100) throw new Error("IDS needs 1–100 specifications.");
  for (const node of nodes) {
    const name = node.getAttribute("name") ?? "Unnamed specification"; let specification: Specification;
    try {
      if (!name.trim() || name.length > 200) throw new Error("IDS specification names require at most 200 non-empty characters.");
      if (Array.from(node.attributes).some(a => a.namespaceURI || !["name", "ifcVersion", "identifier", "description", "instructions"].includes(a.localName))) throw new Error("Unsupported IDS specification attributes.");
      if (Array.from(node.children).some(c => c.namespaceURI !== NS || !["applicability", "requirements"].includes(c.localName)) || children(node, "applicability").length !== 1 || children(node, "requirements").length > 1) throw new Error("Unsupported/duplicate specification child structure.");
      const applicability = children(node, "applicability")[0], requirements = children(node, "requirements")[0];
      if (Array.from(applicability.attributes).some(a => a.namespaceURI || !["minOccurs", "maxOccurs"].includes(a.localName)) || requirements && requirements.attributes.length || Array.from(applicability.children).some(e => e.hasAttribute("cardinality"))) throw new Error("Unsupported IDS facet-group attributes or applicability cardinalities.");
      const rawMin = applicability.getAttribute("minOccurs"), rawMax = applicability.getAttribute("maxOccurs");
      if (!((rawMin === "1" || rawMin === "0") && rawMax === "unbounded" || rawMin === "0" && rawMax === "0")) throw new Error("This IDS subset requires explicit applicability limits 1/unbounded, 0/unbounded or 0/0; other limits are unsupported.");
      const min = rawMin === "1" ? 1 : 0, max = rawMax === "unbounded" ? Infinity : 0;
      if (max !== 0 && !requirements) throw new Error("Required/optional specifications require a supported requirements group.");
      specification = { name, versions: (node.getAttribute("ifcVersion") ?? "").split(/\s+/).filter(Boolean), applicability: facets(applicability, document.schema), requirements: max === 0 ? [] : facets(requirements!, document.schema), min, max };
      if (specification.applicability.filter(f => f.kind === "entity").length !== 1 || specification.requirements.filter(f => f.kind === "entity").length > 1) throw new Error("This subset requires exactly one literal applicability entity and at most one requirement entity facet.");
      if (specification.applicability.some(f => f.cardinality !== "required")) throw new Error("Applicability facets cannot use requirement cardinalities.");
      const entityFacet = specification.applicability.find(f => f.kind === "entity")!;
      if (omittedTypes.has(entityFacet.name)) throw new Error(`Entity ${entityFacet.name} includes records outside the imported metadata product subset.`);
      const checkedFacets = [...specification.applicability, ...specification.requirements];
      for (const p of document.products) if (p.type === entityFacet.name) {
        if (p.metadataIssues?.length) throw new Error(`Product ${p.globalId} has incomplete/ambiguous metadata: ${p.metadataIssues[0].slice(0, 500)}`);
        for (const facet of checkedFacets) {
          if (++checks > 200000) throw new Error("IDS metadata preflight/check budget exceeded.");
          if (facet.kind === "entity" && facet.predefinedType !== undefined && p.predefinedTypeSupported !== true) throw new Error(`PredefinedType for ${p.type} is outside the resolved occurrence/type metadata subset.`);
          if (facet.kind !== "property" || !exists(p, facet)) continue;
          const value = property(p, facet), key = `${facet.propertySet}.${facet.name}`;
          if (!value || !value.supported || value.issues.length || value.propertySet !== facet.propertySet || value.name !== facet.name) throw new Error(`Property ${key} has unresolved, ambiguous or unsupported scalar metadata.`);
          if (value.value !== null && isIfcMeasureType(value.dataType)) {
            const normalized = normalizeMeasure(value); if (!normalized.supported) throw new Error(`Property ${key}: ${normalized.message}`);
          } else {
            if (value.unit !== null) throw new Error(`Property ${key} has a unit outside the direct-SI measure subset.`);
            if (value.value !== null) {
              const expectedType = ["IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(value.dataType) ? "string" : value.dataType === "IFCBOOLEAN" ? "boolean" : ["IFCINTEGER", "IFCREAL"].includes(value.dataType) ? "number" : undefined;
              if (expectedType === undefined || typeof value.value !== expectedType || typeof value.value === "number" && (!Number.isFinite(value.value) || Math.abs(value.value) > 1e30 || value.dataType === "IFCINTEGER" && !Number.isSafeInteger(value.value))) throw new Error(`Property ${key} has an unsupported or inconsistent primitive value/type.`);
            }
          }
        }
      }
      const version = document.schema.toUpperCase();
      const normalizedVersion = version === "IFC2X3" ? "IFC2X3" : version.startsWith("IFC4X3") ? "IFC4X3_ADD2" : "IFC4";
      if (!(IFC_SUPPORTED_SCHEMAS as readonly string[]).includes(version) || !specification.versions.length || specification.versions.some(v => !["IFC2X3", "IFC4", "IFC4X3_ADD2"].includes(v)) || !specification.versions.includes(normalizedVersion) || normalizedVersion === "IFC4X3_ADD2" && version !== "IFC4X3_ADD2") throw new Error(`IDS declared schema versions do not include a supported exact published interpretation of ${version}.`);
    } catch (error) { finding.push({ specification: name, status: "unsupported", message: error instanceof Error ? error.message : "Unsupported specification." }); continue; }
    if (checks + document.products.length * (specification.applicability.length + specification.requirements.length) > 200000 || finding.length + document.products.length * specification.requirements.length + 2 > 20000) { finding.push({ specification: name, status: "unsupported", message: "IDS check/report budget exceeded; narrow the specification/model. Remaining specifications were not evaluated." }); break; }
    const applicable = document.products.filter(p => specification.applicability.every(f => matches(p, f, normalizeMeasure))); checks += document.products.length * specification.applicability.length;
    if (applicable.length < specification.min || applicable.length > specification.max) finding.push({ specification: name, status: "fail", message: `Matched ${applicable.length} products; expected ${specification.min}–${specification.max === Infinity ? "unbounded" : specification.max}.` });
    for (const product of applicable) {
      checked.add(product.globalId);
      for (const f of specification.requirements) { checks++; const v = field(product, f), present = exists(product, f), match = matches(product, f, normalizeMeasure); const pass = f.cardinality === "prohibited" ? f.kind === "attribute" && f.value !== undefined ? !match : !present : f.cardinality === "optional" ? !present || match : match;
        finding.push({ specification: name, globalId: product.globalId, status: pass ? "pass" : "fail", message: `${f.cardinality} ${f.kind} ${f.propertySet ? `${f.propertySet}.` : ""}${f.name}${f.dataType ? ` (${f.dataType})` : ""}${f.predefinedType ? ` / ${f.predefinedType}` : ""}${f.value === undefined ? "" : ` = ${f.value}`}; actual ${(v ?? "missing").slice(0, 500)}.` });
      }
    }
    if (!applicable.length && specification.min === 0) finding.push({ specification: name, status: "pass", message: specification.max === 0 ? "No matching products; prohibited applicability is satisfied." : "No matching products; applicability is optional." });
  }
  const unsupported = finding.some(f => f.status === "unsupported");
  return { status: unsupported ? "incomplete" : finding.some(f => f.status === "fail") ? "fail" : "pass", findings: finding, checkedProducts: checked.size, certification: false };
}

export function inspectBimGeometry(document: IfcDocument): BimValidationReport {
  const findings: BimFinding[] = document.issues.slice(0, 19999).map(message => ({ specification: "Geometry coverage", status: "unsupported", message }));
  if (document.issues.length > 19999) { findings.push({ specification: "Coverage budget", status: "unsupported", message: "Document issues exceed the 20,000-record budget; product coverage was not evaluated." }); return { status: "incomplete", findings, checkedProducts: 0, certification: false }; }
  for (const p of document.products) { if (findings.length + p.issues.length + (p.metadataIssues?.length ?? 0) >= 20000) { findings.push({ specification: "Coverage budget", status: "unsupported", message: "Remaining product findings exceed the 20,000-record budget; full coverage was not evaluated." }); break; } if (p.issues.length) for (const message of p.issues) findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "unsupported", message }); else if (!p.meshes.length) findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "unsupported", message: "No supported geometry parts." }); else findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "pass", message: `${p.meshes.length} supported mesh parts; stable source GlobalId.` }); for (const message of p.metadataIssues ?? []) findings.push({ specification: "Metadata coverage", globalId: p.globalId, status: "unsupported", message }); }
  return { status: findings.some(f => f.status === "unsupported") ? "incomplete" : "pass", findings, checkedProducts: document.products.length, certification: false };
}
