import { useMemo, useState } from "react";
import { createEngineeringDesignBasis, parseEngineeringDesignBasis, type EngineeringDesignBasis } from "../lib/engineeringBasis";
import { EngineeringBasisPanel } from "./EngineeringBasisPanel";
import { Button, Modal } from "./ui";

/** Stored on the whole CAD design, so every editor shares one authored project basis. */
export function ProjectEngineeringBasisControl({ value, onChange, disabled = false }: {
  value?: EngineeringDesignBasis; onChange: (value: EngineeringDesignBasis) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    try { return { basis: value === undefined ? createEngineeringDesignBasis() : parseEngineeringDesignBasis(value), error: "" }; }
    catch (cause) { return { basis: null, error: cause instanceof Error ? cause.message : "Stored engineering basis cannot be read." }; }
  }, [value]);
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Engineering country{parsed.basis?.countryCode ? `: ${parsed.basis.countryCode}` : ""}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Project country and engineering basis">
      <p className="mb-4 text-sm text-slate-400">This basis is saved with the CAD project. Import the linked project explicitly in the engineering workbench to copy it into that workspace. Each calculation retains its captured basis.</p>
      {parsed.basis ? <EngineeringBasisPanel value={parsed.basis} onChange={onChange} disabled={disabled} /> : <div className="space-y-3"><p role="alert" className="text-sm text-amber-300">{parsed.error} Stored data is retained until explicitly replaced.</p><Button variant="outline" disabled={disabled} onClick={() => onChange(createEngineeringDesignBasis())}>Replace invalid basis with an empty draft</Button></div>}
    </Modal>
  </>;
}
