import type { IfcDocument, IfcProduct } from "./ifcGeometry";

export interface BimFinding { specification: string; globalId?: string; status: "pass" | "fail" | "unsupported"; message: string }
export interface BimValidationReport { status: "pass" | "fail" | "incomplete"; findings: BimFinding[]; checkedProducts: number; certification: false }
type Facet = { kind: "entity" | "attribute" | "property"; name: string; propertySet?: string; value?: string; cardinality: "required" | "optional" | "prohibited" };
interface Specification { name: string; versions: string[]; applicability: Facet[]; requirements: Facet[]; min: number; max: number }
const NS = "http://standards.buildingsmart.org/IDS";
const children = (e: Element, name?: string) => Array.from(e.children).filter(c => c.namespaceURI === NS && (!name || c.localName === name));
function literal(element: Element, name: string, required: boolean): string | undefined {
  const fields = children(element, name); if (fields.length > 1) throw new Error(`Duplicate ${name}.`); const field = fields[0]; if (!field) { if (required) throw new Error(`Missing ${name}.`); return undefined; }
  const simple = children(field, "simpleValue"); if (simple.length !== 1 || field.children.length !== 1 || simple[0].children.length || field.attributes.length || simple[0].attributes.length) throw new Error(`${name} uses an unsupported restriction/structure; only plain simpleValue is supported.`);
  return simple[0].textContent ?? "";
}
function facets(element: Element): Facet[] {
  if (!element.children.length || element.children.length > 20) throw new Error("Each facet group must contain 1–20 facets.");
  if (Array.from(element.children).some(e => e.namespaceURI !== NS)) throw new Error("Foreign-namespace facets are unsupported.");
  return children(element).map(e => {
    const cardinality = e.getAttribute("cardinality") ?? "required";
    if (!["required", "optional", "prohibited"].includes(cardinality)) throw new Error("Unsupported facet cardinality.");
    const base = { cardinality: cardinality as Facet["cardinality"] };
    if (Array.from(e.attributes).some(a => a.namespaceURI || !["cardinality", "instructions", "uri", "dataType"].includes(a.localName))) throw new Error("Unsupported facet attribute.");
    const allowed: Record<string, string[]> = { entity: ["name", "predefinedType"], attribute: ["name", "value"], property: ["propertySet", "baseName", "value"] };
    if (!(e.localName in allowed) || Array.from(e.children).some(c => c.namespaceURI !== NS || !allowed[e.localName].includes(c.localName))) throw new Error(`Unsupported child structure in ${e.localName} facet.`);
    if (e.localName === "entity") { if (children(e, "predefinedType").length || cardinality !== "required") throw new Error("Entity predefinedType/subtype inheritance and non-required entity cardinalities are not implemented."); return { ...base, kind: "entity", name: literal(e, "name", true)!.toUpperCase() }; }
    if (e.localName === "attribute") { const name = literal(e, "name", true)!; if (!["GlobalId", "Name", "Description", "ObjectType"].includes(name)) throw new Error(`Attribute ${name} is outside the supported string attribute subset.`); return { ...base, kind: "attribute", name, value: literal(e, "value", false) }; }
    if (e.localName === "property") { if (e.hasAttribute("dataType")) throw new Error("Typed property validation is not implemented."); return { ...base, kind: "property", name: literal(e, "baseName", true)!, propertySet: literal(e, "propertySet", true)!, value: literal(e, "value", false) }; }
    throw new Error(`Unsupported IDS facet ${e.localName}.`);
  });
}
const field = (p: IfcProduct, f: Facet): string | undefined => f.kind === "entity" ? p.type : f.kind === "attribute" ? p.attributes[f.name] : p.properties[`${f.propertySet}.${f.name}`];
function matches(p: IfcProduct, f: Facet): boolean { const v = field(p, f); return f.kind === "entity" ? v === f.name : v !== undefined && v !== "" && (f.value === undefined || v === f.value); }

/** IDS XML literal entity/attribute/property subset. Unsupported facets fail closed as incomplete. */
export function validateIds(document: IfcDocument, xml: string): BimValidationReport {
  if (xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("IDS XML must be at most 2 MB and cannot contain DTD/entity declarations.");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length || dom.documentElement.namespaceURI !== NS || dom.documentElement.localName !== "ids") throw new Error("Invalid IDS XML root/namespace.");
  if (Array.from(dom.documentElement.children).some(c => c.namespaceURI !== NS || !["info", "specifications"].includes(c.localName)) || children(dom.documentElement, "info").length > 1) throw new Error("Unsupported IDS root child structure.");
  const containers = children(dom.documentElement, "specifications"); if (containers.length !== 1 || Array.from(containers[0].children).some(c => c.namespaceURI !== NS || c.localName !== "specification")) throw new Error("IDS requires one specifications group containing only IDS specifications.");
  const importedSteps = new Set(document.products.map(p => p.stepId)), omittedTypes = new Set([...document.entities.values()].filter(e => !importedSteps.has(e.id)).map(e => e.type));
  const finding: BimFinding[] = [], checked = new Set<string>(), nodes = children(containers[0], "specification"); let checks = 0;
  const globalIds = new Set<string>(); for (const p of document.products) { if (globalIds.has(p.globalId)) finding.push({ specification: "Model identity", globalId: p.globalId, status: "unsupported", message: "Duplicate GlobalId prevents unambiguous IDS product identity." }); globalIds.add(p.globalId); }
  if (!nodes.length || nodes.length > 100) throw new Error("IDS needs 1–100 specifications.");
  for (const node of nodes) {
    const name = node.getAttribute("name") ?? "Unnamed specification"; let specification: Specification;
    try {
      if (Array.from(node.children).some(c => c.namespaceURI !== NS || !["applicability", "requirements"].includes(c.localName)) || children(node, "applicability").length !== 1 || children(node, "requirements").length !== 1) throw new Error("Unsupported/duplicate specification child structure.");
      const applicability = children(node, "applicability")[0], requirements = children(node, "requirements")[0];
      if (!applicability || !requirements) throw new Error("Applicability and requirements are required.");
      const min = Number(applicability.getAttribute("minOccurs") ?? "1"), rawMax = applicability.getAttribute("maxOccurs") ?? "1", max = rawMax === "unbounded" ? Infinity : Number(rawMax);
      if (!Number.isInteger(min) || min < 0 || !(max === Infinity || Number.isInteger(max) && max >= min)) throw new Error("Invalid occurrence limits.");
      specification = { name, versions: (node.getAttribute("ifcVersion") ?? "").split(/\s+/).filter(Boolean), applicability: facets(applicability), requirements: facets(requirements), min, max };
      if (!specification.applicability.some(f => f.kind === "entity")) throw new Error("A literal entity applicability facet is required by this implementation.");
      if (specification.applicability.some(f => f.cardinality !== "required")) throw new Error("Applicability facets cannot use requirement cardinalities.");
      const entityFacet = specification.applicability.find(f => f.kind === "entity")!;
      if (omittedTypes.has(entityFacet.name)) throw new Error(`Entity ${entityFacet.name} includes records outside the imported metadata product subset.`);
      const valuedProperties = [...specification.applicability, ...specification.requirements].filter(f => f.kind === "property" && f.value !== undefined);
      for (const p of document.products) if (p.type === entityFacet.name) for (const facet of valuedProperties) { if (++checks > 200000) throw new Error("IDS metadata preflight/check budget exceeded."); const key = `${facet.propertySet}.${facet.name}`; if (p.properties[key] !== undefined && !["STRING", "IFCLABEL", "IFCTEXT", "IFCIDENTIFIER"].includes(p.propertyTypes?.[key] ?? "UNKNOWN")) throw new Error(`Property ${key} exact-value checks require textual IFC values; measure/boolean/unit normalization is unsupported.`); }
      const version = document.schema.toUpperCase();
      if (!specification.versions.length || !specification.versions.some(v => version === v || v === "IFC4" && /^IFC4(?:_|$)/.test(version))) throw new Error(`IDS schema ${specification.versions.join("/")} does not include ${version}.`);
    } catch (error) { finding.push({ specification: name, status: "unsupported", message: error instanceof Error ? error.message : "Unsupported specification." }); continue; }
    if (checks + document.products.length * (specification.applicability.length + specification.requirements.length) > 200000 || finding.length + document.products.length * specification.requirements.length > 20000) { finding.push({ specification: name, status: "unsupported", message: "IDS check/report budget exceeded; narrow the specification/model. Remaining specifications were not evaluated." }); break; }
    const applicable = document.products.filter(p => specification.applicability.every(f => matches(p, f))); checks += document.products.length * specification.applicability.length;
    if (applicable.length < specification.min || applicable.length > specification.max) finding.push({ specification: name, status: "fail", message: `Matched ${applicable.length} products; expected ${specification.min}–${specification.max === Infinity ? "unbounded" : specification.max}.` });
    for (const product of applicable) {
      checked.add(product.globalId);
      for (const f of specification.requirements) { checks++; const v = field(product, f), exists = v !== undefined && v !== "", match = matches(product, f); const pass = f.cardinality === "prohibited" ? !match : f.cardinality === "optional" ? !exists || match : match;
        finding.push({ specification: name, globalId: product.globalId, status: pass ? "pass" : "fail", message: `${f.cardinality} ${f.kind} ${f.propertySet ? `${f.propertySet}.` : ""}${f.name}${f.value === undefined ? "" : ` = ${f.value}`}; actual ${v ?? "missing"}.` });
      }
    }
    if (!applicable.length && specification.min === 0) finding.push({ specification: name, status: "pass", message: "No matching products; applicability is optional." });
  }
  const unsupported = finding.some(f => f.status === "unsupported");
  return { status: unsupported ? "incomplete" : finding.some(f => f.status === "fail") ? "fail" : "pass", findings: finding, checkedProducts: checked.size, certification: false };
}

export function inspectBimGeometry(document: IfcDocument): BimValidationReport {
  const findings: BimFinding[] = document.issues.map(message => ({ specification: "Geometry coverage", status: "unsupported", message }));
  for (const p of document.products) { if (p.issues.length) for (const message of p.issues) findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "unsupported", message }); else if (!p.meshes.length) findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "unsupported", message: "No supported geometry parts." }); else findings.push({ specification: "Geometry coverage", globalId: p.globalId, status: "pass", message: `${p.meshes.length} supported mesh parts; stable source GlobalId.` }); }
  return { status: findings.some(f => f.status === "unsupported") ? "incomplete" : "pass", findings, checkedProducts: document.products.length, certification: false };
}
