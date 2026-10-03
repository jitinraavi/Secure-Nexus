import { useEffect, useMemo, useState } from "react";
import { getCountries, type CountryOption } from "../api";
import {
  changeEngineeringCountry, countryName, ENGINEERING_MODULES, ENGINEERING_STANDARD_DOMAINS,
  engineeringStandardReferences, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis,
  type AdoptedEngineeringStandard, type EngineeringBasisModule, type EngineeringDesignBasis,
  type EngineeringStandardDomain, type EngineeringUserCriterion,
} from "../lib/engineeringBasis";
import { Badge, Button, Input, Select } from "./ui";

const fallbackCountries = [
  { iso2: "IN", name: "India" }, { iso2: "US", name: "United States" }, { iso2: "AU", name: "Australia" },
  { iso2: "CA", name: "Canada" }, { iso2: "GB", name: "United Kingdom" }, { iso2: "AE", name: "United Arab Emirates" },
  { iso2: "ZA", name: "South Africa" },
];
const declarationLabels: Record<keyof EngineeringDesignBasis["declaration"], string> = {
  occupancy: "Occupancy / use", riskCategory: "Risk / importance category", structuralSystem: "Structural and MEP systems",
  material: "Material grades, strengths and property sources", soil: "Site class, soil and geotechnical report",
  loads: "Load cases, combinations and factor sources", hazards: "Wind, seismic, snow, flood and other hazards / sources",
};
const newCustom = () => ({ domain: "other" as EngineeringStandardDomain, code: "", edition: "", sourceUrl: "", adoptionReference: "", amendments: "" });
const newCriterion = () => ({ module: "frame" as EngineeringBasisModule, name: "", value: "", unit: "", source: "", standardId: "", clause: "" });
function nextId(prefix: string, used: string[]): string {
  const ids = new Set(used);
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function EngineeringBasisPanel({ value, onChange, disabled = false }: {
  value: EngineeringDesignBasis;
  onChange: (basis: EngineeringDesignBasis) => void;
  disabled?: boolean;
}) {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [manualCountry, setManualCountry] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [custom, setCustom] = useState(newCustom);
  const [criterion, setCriterion] = useState(newCriterion);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    getCountries().then(options => { if (active) setCountries(options); }).catch(() => { if (active) setCountries([]); });
    return () => { active = false; };
  }, []);
  useEffect(() => { setReferenceId(""); setCustom(newCustom()); setCriterion(newCriterion()); setMessage(""); }, [value.countryCode]);
  const options = countries.length ? countries : fallbackCountries;
  const references = engineeringStandardReferences(value.countryCode);
  const errors = useMemo(() => validateEngineeringDesignBasis(value), [value]);
  const update = (next: EngineeringDesignBasis) => {
    try { const parsed = parseEngineeringDesignBasis({ ...next, confirmed: false }); setMessage(""); onChange(parsed); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Invalid design basis input."); }
  };
  const updateCountry = (code: string) => {
    if (code === value.countryCode) return;
    update(changeEngineeringCountry(value, code));
  };
  const updateStandard = (id: string, patch: Partial<AdoptedEngineeringStandard>) => update({ ...value, standards: value.standards.map(item => item.id === id ? { ...item, ...patch } : item) });
  const addReference = () => {
    const reference = references.find(item => item.id === referenceId);
    if (!reference || value.standards.length >= 40 || value.standards.some(item => item.id === reference.id)) return;
    // Choosing a reference does not adopt its edition. Edition and local adoption remain explicit.
    update({ ...value, standards: [...value.standards, { id: reference.id, domain: reference.domain, code: reference.code, edition: "", sourceUrl: reference.sourceUrl, adoptionReference: "", amendments: "" }] });
    setReferenceId("");
  };
  const addCustom = () => {
    if (!custom.code.trim() || !custom.edition.trim() || !isEngineeringSourceUrl(custom.sourceUrl) || !custom.adoptionReference.trim() || !custom.amendments.trim()) { setMessage("Supply the custom code, edition, HTTPS source, adoption reference and amendments declaration."); return; }
    if (value.standards.length >= 40) { setMessage("The basis supports at most 40 standards."); return; }
    update({ ...value, standards: [...value.standards, { ...custom, id: nextId("custom-standard", value.standards.map(item => item.id)) }] });
    setCustom(newCustom());
  };
  const addCriterion = () => {
    const number = Number(criterion.value);
    if (!criterion.value.trim() || !Number.isFinite(number) || Math.abs(number) > 1e18 || !criterion.name.trim() || !criterion.unit.trim() || !criterion.source.trim()) { setMessage("Supply a criterion name, finite numeric value, unit and traceable source."); return; }
    if (criterion.standardId && (!value.standards.some(item => item.id === criterion.standardId) || !criterion.clause.trim())) { setMessage("Choose an adopted standard and enter the criterion clause."); return; }
    if (value.criteria.length >= 64) { setMessage("The basis supports at most 64 criteria."); return; }
    const entry: EngineeringUserCriterion = { id: nextId("criterion", value.criteria.map(item => item.id)), module: criterion.module, name: criterion.name, value: number, unit: criterion.unit, source: criterion.source, ...(criterion.standardId ? { standardId: criterion.standardId, clause: criterion.clause } : {}) };
    update({ ...value, criteria: [...value.criteria, entry] });
    setCriterion(newCriterion());
  };

  return <fieldset disabled={disabled} className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-semibold text-slate-100">Project engineering design basis</h3>
      <Badge tone={errors.length ? "amber" : "emerald"}>{errors.length ? "Adoption review required" : "Declared basis"}</Badge>
    </div>
    <p className="text-sm text-slate-400">Select the project country, then record the locally adopted editions and project inputs. Country selection supplies publisher references; calculations use the supplied model and criteria.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Project country" value={value.countryCode} onChange={event => updateCountry(event.target.value)}>
        <option value="">Select country</option>
        {value.countryCode && !options.some(item => item.iso2 === value.countryCode) && <option value={value.countryCode}>{countryName(value.countryCode)}</option>}
        {options.map(item => <option key={item.iso2} value={item.iso2}>{item.name}</option>)}
      </Select>
      <Input label="State / region / municipality" value={value.region} maxLength={500} onChange={event => update({ ...value, region: event.target.value })} />
      <Input label="Authority having jurisdiction" value={value.authority} maxLength={500} onChange={event => update({ ...value, authority: event.target.value })} />
      <div className="flex items-end gap-2">
        <Input label="Other country (ISO alpha-2)" value={manualCountry} maxLength={2} onChange={event => setManualCountry(event.target.value.toUpperCase())} />
        <Button type="button" size="sm" variant="secondary" disabled={!/^[A-Z]{2}$/.test(manualCountry)} onClick={() => updateCountry(manualCountry)}>Use country</Button>
      </div>
    </div>
    <p className="text-xs text-amber-300">Changing country clears the adopted standards, project declarations and criteria so they can be reviewed for the new jurisdiction.</p>
    {value.countryCode && references.length === 0 && <p className="text-sm text-slate-300">This country requires custom publisher or local authority references. Add the actual applicable standards and editions below.</p>}
    {references.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <Select label={`${countryName(value.countryCode)} publisher references`} value={referenceId} onChange={event => setReferenceId(event.target.value)}>
        <option value="">Choose a reference to adopt</option>
        {references.filter(item => !value.standards.some(standard => standard.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.code} - {item.title}</option>)}
      </Select>
      <Button type="button" variant="secondary" disabled={!referenceId || value.standards.length >= 40} onClick={addReference}>Add reference</Button>
    </div>}
    <div className="space-y-3">
      {value.standards.map(standard => {
        const reference = references.find(item => item.id === standard.id);
        return <div key={standard.id} className="space-y-3 rounded-xl border border-slate-700 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-200">{standard.code} <span className="text-xs text-slate-400">{standard.domain}</span></span>
            <Button type="button" size="sm" variant="ghost" onClick={() => update({ ...value, standards: value.standards.filter(item => item.id !== standard.id) })}>Remove</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {reference ? <Select label="Locally adopted edition" value={standard.edition} onChange={event => updateStandard(standard.id, { edition: event.target.value })}>
              <option value="">Select adopted edition</option>
              {!reference.editions.includes(standard.edition) && standard.edition && <option value={standard.edition}>{standard.edition} (outside catalog)</option>}
              {reference.editions.map(edition => <option key={edition} value={edition}>{edition}</option>)}
            </Select> : <Input label="Locally adopted edition" value={standard.edition} maxLength={100} onChange={event => updateStandard(standard.id, { edition: event.target.value })} />}
            <Input label="Local adoption / approval reference" value={standard.adoptionReference} maxLength={2000} onChange={event => updateStandard(standard.id, { adoptionReference: event.target.value })} />
            <Input label="Amendments, supplements and errata (or verified none)" value={standard.amendments} maxLength={2000} onChange={event => updateStandard(standard.id, { amendments: event.target.value })} />
            {isEngineeringSourceUrl(standard.sourceUrl) && <a className="self-center text-sm text-cyan-300 underline" href={standard.sourceUrl} target="_blank" rel="noopener noreferrer">Publisher / authority source</a>}
          </div>
        </div>;
      })}
    </div>
    <details className="rounded-xl border border-slate-700 p-3">
      <summary className="cursor-pointer font-medium text-slate-200">Add custom standard / another published edition</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select label="Domain" value={custom.domain} onChange={event => setCustom({ ...custom, domain: event.target.value as EngineeringStandardDomain })}>{ENGINEERING_STANDARD_DOMAINS.map(domain => <option key={domain} value={domain}>{domain}</option>)}</Select>
        <Input label="Code / title" value={custom.code} maxLength={160} onChange={event => setCustom({ ...custom, code: event.target.value })} />
        <Input label="Adopted edition" value={custom.edition} maxLength={100} onChange={event => setCustom({ ...custom, edition: event.target.value })} />
        <Input label="HTTPS publisher / authority source" value={custom.sourceUrl} maxLength={2000} onChange={event => setCustom({ ...custom, sourceUrl: event.target.value })} />
        <Input label="Local adoption / approval reference" value={custom.adoptionReference} maxLength={2000} onChange={event => setCustom({ ...custom, adoptionReference: event.target.value })} />
        <Input label="Amendments, supplements and errata (or verified none)" value={custom.amendments} maxLength={2000} onChange={event => setCustom({ ...custom, amendments: event.target.value })} />
        <Button type="button" variant="secondary" onClick={addCustom}>Add custom standard</Button>
      </div>
    </details>
    <div className="grid gap-3 sm:grid-cols-2">
      {(Object.keys(declarationLabels) as (keyof EngineeringDesignBasis["declaration"])[]).map(key => <label key={key} className="space-y-1 text-sm text-slate-300">
        <span>{declarationLabels[key]}</span>
        <textarea className="min-h-20 w-full rounded-xl border border-slate-700 bg-slate-950/55 p-3 text-sm text-slate-100" maxLength={key === "loads" || key === "hazards" ? 4000 : 2000} value={value.declaration[key]} onChange={event => update({ ...value, declaration: { ...value.declaration, [key]: event.target.value } })} />
      </label>)}
    </div>
    <details className="rounded-xl border border-slate-700 p-3">
      <summary className="cursor-pointer font-medium text-slate-200">Traceable numeric criteria ({value.criteria.length})</summary>
      <p className="mt-2 text-xs text-slate-400">Record approved limits and their units/sources here. Values in the model input control the analysis; verify their agreement with this declaration.</p>
      {value.criteria.map(entry => <div key={entry.id} className="mt-2 flex items-center justify-between gap-2 text-sm text-slate-300">
        <span>{entry.module}: {entry.name} = {entry.value} {entry.unit}; {entry.source}{entry.clause ? `, clause ${entry.clause}` : ""}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => update({ ...value, criteria: value.criteria.filter(item => item.id !== entry.id) })}>Remove</Button>
      </div>)}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select label="Module" value={criterion.module} onChange={event => setCriterion({ ...criterion, module: event.target.value as EngineeringBasisModule })}>{ENGINEERING_MODULES.map(module => <option key={module} value={module}>{module}</option>)}</Select>
        <Input label="Criterion name" value={criterion.name} maxLength={200} onChange={event => setCriterion({ ...criterion, name: event.target.value })} />
        <Input label="Explicit numeric value" type="number" step="any" value={criterion.value} onChange={event => setCriterion({ ...criterion, value: event.target.value })} />
        <Input label="Unit (use ratio for dimensionless)" value={criterion.unit} maxLength={100} onChange={event => setCriterion({ ...criterion, unit: event.target.value })} />
        <Input label="Source / approval reference" value={criterion.source} maxLength={2000} onChange={event => setCriterion({ ...criterion, source: event.target.value })} />
        <Select label="Adopted standard (optional)" value={criterion.standardId} onChange={event => setCriterion({ ...criterion, standardId: event.target.value })}>
          <option value="">Project supplied criterion</option>
          {value.standards.map(standard => <option key={standard.id} value={standard.id}>{standard.code} {standard.edition}</option>)}
        </Select>
        <Input label="Clause (required when citing a standard)" value={criterion.clause} maxLength={200} onChange={event => setCriterion({ ...criterion, clause: event.target.value })} />
        <Button type="button" variant="secondary" onClick={addCriterion}>Add criterion</Button>
      </div>
    </details>
    <Input label="Adoption review recorded by" value={value.reviewer} maxLength={500} onChange={event => update({ ...value, reviewer: event.target.value })} />
    <Input label="Review note / scope exclusions" value={value.reviewNote} maxLength={4000} onChange={event => update({ ...value, reviewNote: event.target.value })} />
    <Button type="button" variant="secondary" onClick={() => {
      const candidate = { ...value, confirmed: true };
      const pending = validateEngineeringDesignBasis(candidate);
      if (pending.length) { setMessage(pending.join(" ")); return; }
      setMessage(""); onChange(candidate);
    }}>Confirm adopted editions and project declaration</Button>
    <p className="text-xs text-slate-400">Confirmation records your declared basis. Reports state which numerical checks ran and their limits of applicability.</p>
    {message && <p role="alert" className="text-sm text-amber-300">{message}</p>}
    {errors.length > 0 && <details className="text-sm text-slate-400"><summary className="cursor-pointer">Remaining declaration requirements ({errors.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></details>}
  </fieldset>;
}
