import { useEffect, useId, useMemo, useState } from "react";
import { guidedEngineeringFields, updateGuidedEngineeringNumber, type GuidedEngineeringField } from "../lib/guidedEngineering";

function NumericField({ field, onCommit }: { field: GuidedEngineeringField; onCommit: (field: GuidedEngineeringField, value: number) => void }) {
  const display = String(Number((field.value * field.multiplier).toPrecision(12)));
  const [text, setText] = useState(display);
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => { setText(display); setError(""); }, [display]);
  const commit = () => {
    try {
      if (text === display) { setError(""); return; }
      if (!text.trim()) throw new Error("Enter a number, or press Escape to restore the current input value.");
      onCommit(field, Number(text)); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Input could not be updated."); }
  };
  return <label className="block text-sm text-slate-300"><span>{field.label} ({field.unit})</span><input type="number" step="any" value={text} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="gw-field mt-1 w-full px-3 py-2.5" onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); setText(display); setError(""); } }} />{error && <span id={`${id}-error`} role="alert" className="mt-1 block text-xs text-rose-300">{error}</span>}</label>;
}

export function GuidedEngineeringInputs({ module, source, onChange }: { module: string; source: string; onChange: (source: string) => void }) {
  const guide = useMemo(() => guidedEngineeringFields(source, module), [source, module]);
  const groups = useMemo(() => {
    const result = new Map<string, GuidedEngineeringField[]>();
    for (const field of guide.fields) {
      const separator = field.label.indexOf(" · "), name = separator < 0 ? "Fluid properties" : field.label.slice(0, separator);
      result.set(name, [...(result.get(name) ?? []), field]);
    }
    return [...result];
  }, [guide.fields]);
  if (module !== "frame" && module !== "water") return null;
  return <section aria-label="Guided engineering inputs" className="space-y-3 rounded-xl border border-slate-700 p-3">
    <h3 className="font-semibold text-slate-100">Guided numeric inputs</h3>
    <p className="text-xs text-slate-400">Edit the existing values below. Units are shown on every field; the same SI input is updated when you leave a field. Supports, connectivity, load combinations and design criteria remain in Advanced JSON. Nothing is inferred.</p>
    {guide.problem && <p role="alert" className="text-sm text-amber-200">Guided fields are unavailable: {guide.problem} Your input is preserved. Open Advanced JSON below to correct it.</p>}
    {!guide.problem && guide.fields.length === 0 && <p className="text-sm text-slate-400">No supported numeric fields are present. Review the input in Advanced JSON.</p>}
    {groups.map(([name, fields], index) => <details key={name} open={index === 0} className="space-y-3 border-t border-slate-700 pt-3"><summary className="cursor-pointer text-sm font-medium text-slate-200">{name} · {fields.length} numeric fields</summary><div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <NumericField key={JSON.stringify(field.path)} field={field} onCommit={(entry, value) => onChange(updateGuidedEngineeringNumber(source, module, entry.path, value))} />)}</div></details>)}
    {guide.limited && <p className="text-xs text-amber-200">This guided view is limited to 30 records per group and 240 fields. The complete input remains available in Advanced JSON.</p>}
  </section>;
}
