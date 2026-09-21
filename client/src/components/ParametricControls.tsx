import { useState } from "react";
import type { ParametricConstraint, ParametricConstraintKind, ParametricFamilyMetadata, ParametricLocks } from "../types";
import { Button, Input, Select, Toggle } from "./ui";
import { FAMILY_LIBRARY, familyForId, familyMetadata, type FamilyParameter } from "../lib/families";

interface ParametricControlsProps {
  family?: ParametricFamilyMetadata;
  locks?: ParametricLocks;
  constraints?: ParametricConstraint[];
  targets: { id: string; label: string }[];
  onChange: (patch: { family?: ParametricFamilyMetadata; locks?: ParametricLocks; constraints?: ParametricConstraint[] }) => void;
}

const kinds: { value: ParametricConstraintKind; label: string }[] = [
  { value: "alignment", label: "Align" },
  { value: "parallel", label: "Parallel" },
  { value: "perpendicular", label: "Perpendicular" },
  { value: "level", label: "Same level" },
  { value: "equal", label: "Equal size" },
];

export function ParametricControls({ family, locks, constraints, targets, onChange }: ParametricControlsProps) {
  const current = constraints ?? [];
  const definition = familyForId(family?.libraryId);
  const [search, setSearch] = useState("");
  const patchFamily = (next: ParametricFamilyMetadata) => onChange({ family: next });
  const editParameter = (scope: "typeParameters" | "instanceParameters", parameter: FamilyParameter, value: string) => {
    const parsed = parameter.type === "number" || parameter.type === "length" ? Number(value) || 0 : value;
    patchFamily({ ...family, [scope]: { ...(family?.[scope] ?? {}), [parameter.key]: parsed } });
  };
  const addConstraint = () => onChange({ constraints: [...current, { id: `constraint_${Math.random().toString(36).slice(2, 9)}`, kind: "alignment", targetId: targets[0]?.id, axis: "x", locked: true }] });
  return (
    <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300">Parametric family</p>
      <Input label="Search library" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="wall, slab, door..." />
      <Select label="Family" value={family?.libraryId ?? ""} onChange={(event) => { const selected = FAMILY_LIBRARY.find((item) => item.id === event.target.value); if (selected) patchFamily(familyMetadata(selected)); }}>
        <option value="">Custom / legacy</option>
        {FAMILY_LIBRARY.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Family" value={family?.family ?? ""} placeholder="e.g. Wall" onChange={(e) => onChange({ family: { ...family, family: e.target.value } })} />
        <Input label="Type" value={family?.type ?? ""} placeholder="e.g. Exterior" onChange={(e) => onChange({ family: { ...family, type: e.target.value } })} />
      </div>
      <Input label="Instance" value={family?.instance ?? ""} placeholder="Optional instance name" onChange={(e) => onChange({ family: { ...family, instance: e.target.value } })} />
      {definition && <>
        <Select label="Type" value={family?.type ?? definition.types[0]} onChange={(event) => patchFamily({ ...family, type: event.target.value })}>{definition.types.map((type) => <option key={type}>{type}</option>)}</Select>
        <p className="text-[10px] text-slate-500">{definition.description} · host: {definition.host}</p>
        <div className="grid grid-cols-2 gap-2">{definition.typeParameters.map((parameter) => <ParameterInput key={parameter.key} parameter={parameter} value={family?.typeParameters?.[parameter.key] ?? parameter.defaultValue} onChange={(value) => editParameter("typeParameters", parameter, value)} />)}</div>
        <div className="grid grid-cols-2 gap-2">{definition.instanceParameters.map((parameter) => <ParameterInput key={parameter.key} parameter={parameter} value={family?.instanceParameters?.[parameter.key] ?? parameter.defaultValue} onChange={(value) => editParameter("instanceParameters", parameter, value)} />)}</div>
        <div className="grid grid-cols-2 gap-2"><Input label="Host ID" value={family?.hostId ?? ""} onChange={(event) => patchFamily({ ...family, hostId: event.target.value || undefined })} /><Input label="Level ID" value={family?.levelId ?? ""} onChange={(event) => patchFamily({ ...family, levelId: event.target.value || undefined })} /></div>
      </>}
      <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lock dimensions / relationships</p>
      <div className="grid grid-cols-2 gap-1">
        {(["x", "z", "width", "depth", "height", "rotation"] as const).map((key) => <Toggle key={key} checked={Boolean(locks?.[key])} onChange={(value) => onChange({ locks: { ...locks, [key]: value } })} label={`Lock ${key}`} />)}
      </div>
      {current.map((constraint) => (
        <div key={constraint.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-1">
          <Select label="Relation" value={constraint.kind} onChange={(e) => onChange({ constraints: current.map((item) => item.id === constraint.id ? { ...item, kind: e.target.value as ParametricConstraintKind } : item) })}>
            {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </Select>
          <Select label="Target" value={constraint.targetId ?? ""} onChange={(e) => onChange({ constraints: current.map((item) => item.id === constraint.id ? { ...item, targetId: e.target.value || undefined } : item) })}>
            <option value="">Choose target</option>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
          </Select>
          <Button size="sm" variant="danger" onClick={() => onChange({ constraints: current.filter((item) => item.id !== constraint.id) })}>×</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={addConstraint} disabled={targets.length === 0}>+ Constraint</Button>
    </div>
  );
}

function ParameterInput({ parameter, value, onChange }: { parameter: FamilyParameter; value: number | string | boolean; onChange: (value: string) => void }) {
  return <Input label={`${parameter.label}${parameter.unit ? ` (${parameter.unit})` : ""}`} type={parameter.type === "number" || parameter.type === "length" ? "number" : "text"} value={String(value)} onChange={(event) => onChange(event.target.value)} />;
}
