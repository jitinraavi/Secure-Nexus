import { useState } from "react";
import type { ParametricConstraint, ParametricConstraintAnchor, ParametricConstraintKind, ParametricFamilyMetadata, ParametricLocks } from "../types";
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
  { value: "coincident", label: "Coincident" },
  { value: "collinear", label: "Collinear" },
  { value: "parallel", label: "Parallel" },
  { value: "perpendicular", label: "Perpendicular" },
  { value: "level", label: "Same level" },
  { value: "equal", label: "Equal size" },
];

const anchors: { value: ParametricConstraintAnchor; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "midpoint", label: "Midpoint" },
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
  const addConstraint = () => onChange({ constraints: [...current, { id: `constraint_${Math.random().toString(36).slice(2, 9)}`, kind: "alignment", targetId: targets[0]?.id, axis: "x", anchor: "center", targetAnchor: "center", locked: true }] });
  const patchConstraint = (id: string, patch: Partial<ParametricConstraint>) => onChange({ constraints: current.map((item) => item.id === id ? { ...item, ...patch } : item) });
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
        <div key={constraint.id} className="space-y-1.5 rounded-lg border border-slate-800/80 bg-slate-950/35 p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1">
            <Select label="Relation" value={constraint.kind} onChange={(e) => patchConstraint(constraint.id, { kind: e.target.value as ParametricConstraintKind })}>
              {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </Select>
            <Select label="Target" value={constraint.targetId ?? ""} onChange={(e) => patchConstraint(constraint.id, { targetId: e.target.value || undefined })}>
              <option value="">Choose target</option>
              {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </Select>
            <Button size="sm" variant="danger" onClick={() => onChange({ constraints: current.filter((item) => item.id !== constraint.id) })}>×</Button>
          </div>
          {(constraint.kind === "alignment" || constraint.kind === "coincident" || constraint.kind === "collinear") && (
            <Select label="Constraint axis" value={constraint.axis ?? "both"} onChange={(e) => patchConstraint(constraint.id, { axis: e.target.value as "x" | "z" | "both" })}>
              <option value="both">X + Z</option>
              <option value="x">X only</option>
              <option value="z">Z only</option>
            </Select>
          )}
          {constraint.kind === "coincident" && (
            <div className="grid grid-cols-2 gap-1">
              <Select label="This anchor" value={constraint.anchor ?? "center"} onChange={(e) => patchConstraint(constraint.id, { anchor: e.target.value as ParametricConstraintAnchor })}>
                {anchors.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
              <Select label="Target anchor" value={constraint.targetAnchor ?? "center"} onChange={(e) => patchConstraint(constraint.id, { targetAnchor: e.target.value as ParametricConstraintAnchor })}>
                {anchors.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={addConstraint} disabled={targets.length === 0}>+ Constraint</Button>
    </div>
  );
}

function ParameterInput({ parameter, value, onChange }: { parameter: FamilyParameter; value: number | string | boolean; onChange: (value: string) => void }) {
  return <Input label={`${parameter.label}${parameter.unit ? ` (${parameter.unit})` : ""}`} type={parameter.type === "number" || parameter.type === "length" ? "number" : "text"} value={String(value)} onChange={(event) => onChange(event.target.value)} />;
}

