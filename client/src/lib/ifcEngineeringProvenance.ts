import { parseEngineeringExchangeProvenance, type EngineeringExchangeProvenance } from "./exchangeProvenance";
import type { IfcDocument, StepEntity, StepValue } from "./ifcGeometry";

export interface IfcEngineeringDeclaration { provenance: EngineeringExchangeProvenance | null; issues: string[] }
/** Read only our project property set, preserving imported source and unsupported external metadata. */
export function inspectIfcEngineeringDeclaration(document: IfcDocument): IfcEngineeringDeclaration {
  const resolve = (value: StepValue | undefined): StepEntity | undefined => value && typeof value === "object" && !Array.isArray(value) && "ref" in value ? document.entities.get(value.ref) : undefined;
  const projects = [...document.entities.values()].filter(entity => entity.type === "IFCPROJECT");
  const issues: string[] = [], declarations: EngineeringExchangeProvenance[] = [];
  let matchedSets = 0;
  if (projects.length !== 1) return { provenance: null, issues: ["Exactly one IFC project is required to identify a unique engineering declaration."] };
  for (const relation of document.entities.values()) {
    if (relation.type !== "IFCRELDEFINESBYPROPERTIES" || !Array.isArray(relation.args[4]) || !relation.args[4].some(value => resolve(value)?.id === projects[0].id)) continue;
    const set = resolve(relation.args[5]);
    if (set?.type !== "IFCPROPERTYSET" || set.args[2] !== "SecureNexus Engineering Basis") continue;
    // Reject ambiguity before parsing another payload, including many relations reusing one large set.
    if (++matchedSets > 1) return { provenance: null, issues: [...issues, "Multiple engineering declaration assignments are ambiguous; no declaration was selected."] };
    if (set.args.length !== 5 || !Array.isArray(set.args[4]) || set.args[4].length > 1024) { issues.push("The engineering declaration property set needs a bounded property list and supported argument count."); continue; }
    const setProperties = set.args[4].map(resolve).filter((entity): entity is StepEntity => entity !== undefined);
    if (setProperties.length !== set.args[4].length) { issues.push("The engineering declaration property list contains unresolved references."); continue; }
    const properties = setProperties.filter(entity => entity.args[0] === "Declaration");
    if (properties.length !== 1) { issues.push("The engineering declaration property is missing or duplicated."); continue; }
    const value = properties[0].args[2];
    if (properties[0].type !== "IFCPROPERTYSINGLEVALUE" || properties[0].args.length !== 4 || properties[0].args[3] !== null || !value || typeof value !== "object" || Array.isArray(value) || !("type" in value) || value.type !== "IFCTEXT" || value.values.length !== 1 || typeof value.values[0] !== "string" || value.values[0].length > 1_000_000) { issues.push("The engineering declaration must be bounded IFC text JSON in one unitless single-value property."); continue; }
    try {
      const declaration = parseEngineeringExchangeProvenance(JSON.parse(value.values[0]) as unknown);
      const labels = [["CountryCode", declaration.designBasis?.countryCode ?? "undeclared"], ["NationalCodeCompliance", declaration.nationalCodeCompliance], ["Verification", declaration.verification]];
      let conflicting = false;
      for (const [name, expected] of labels) {
        const matches = setProperties.filter(property => property.args[0] === name);
        if (!matches.length) continue; // External declarations may omit optional readable labels.
        const label = matches[0].args[2];
        if (matches.length !== 1 || matches[0].type !== "IFCPROPERTYSINGLEVALUE" || matches[0].args.length !== 4 || matches[0].args[3] !== null || !label || typeof label !== "object" || Array.isArray(label) || !("type" in label) || label.type !== "IFCLABEL" || label.values.length !== 1 || label.values[0] !== expected) {
          issues.push(`The engineering declaration ${name} label is duplicated, malformed or conflicts with its captured JSON.`); conflicting = true;
        }
      }
      if (!conflicting) declarations.push(declaration);
    }
    catch (error) { issues.push(error instanceof Error ? error.message : "Invalid engineering declaration metadata."); }
  }
  if (declarations.length > 1) issues.push("Multiple engineering declaration sets are ambiguous; no declaration was selected.");
  if (!declarations.length && !issues.length) issues.push("The imported IFC contains no SecureNexus engineering declaration; local adoption is not inferred.");
  return { provenance: issues.length || declarations.length !== 1 ? null : declarations[0], issues };
}
