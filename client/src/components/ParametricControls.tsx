import type { ParametricConstraint, ParametricConstraintKind, ParametricFamilyMetadata, ParametricLocks } from "../types";
import { Button, Input, Select, Toggle } from "./ui";

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
  const addConstraint = () => onChange({ constraints: [...current, { id: `constraint_${Math.random().toString(36).slice(2, 9)}`, kind: "alignment", targetId: targets[0]?.id, axis: "x", locked: true }] });
  return (
    <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300">Parametric family</p>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Family" value={family?.family ?? ""} placeholder="e.g. Wall" onChange={(e) => onChange({ family: { ...family, family: e.target.value } })} />
        <Input label="Type" value={family?.type ?? ""} placeholder="e.g. Exterior" onChange={(e) => onChange({ family: { ...family, type: e.target.value } })} />
      </div>
      <Input label="Instance" value={family?.instance ?? ""} placeholder="Optional instance name" onChange={(e) => onChange({ family: { ...family, instance: e.target.value } })} />
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
