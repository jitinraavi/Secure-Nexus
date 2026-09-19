import { cn } from "../lib/cn";

export type CadTool =
  | "select"
  | "move"
  | "rotate"
  | "measure"
  | "line"
  | "rectangle"
  | "circle"
  | "dimension"
  | "wall"
  | "slab"
  | "column"
  | "roof"
  | "offset"
  | "trim"
  | "extend"
  | "mirror"
  | "array"
  | "extrude"
  | "add-building"
  | "add-feature";

const TOOLS: { id: CadTool; label: string; shortcut: string }[] = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "move", label: "Move", shortcut: "M" },
  { id: "rotate", label: "Rotate", shortcut: "R" },
  { id: "measure", label: "Measure", shortcut: "D" },
  { id: "line", label: "Line", shortcut: "L" },
  { id: "rectangle", label: "Rectangle", shortcut: "REC" },
  { id: "circle", label: "Circle", shortcut: "C" },
  { id: "dimension", label: "Dimension", shortcut: "DI" },
  { id: "wall", label: "Wall", shortcut: "WA" },
  { id: "slab", label: "Slab", shortcut: "SL" },
  { id: "column", label: "Column", shortcut: "CO" },
  { id: "roof", label: "Roof", shortcut: "RF" },
  { id: "offset", label: "Offset", shortcut: "O" },
  { id: "trim", label: "Trim", shortcut: "TR" },
  { id: "extend", label: "Extend", shortcut: "EX" },
  { id: "mirror", label: "Mirror", shortcut: "MI" },
  { id: "array", label: "Array", shortcut: "AR" },
  { id: "extrude", label: "Extrude", shortcut: "EXT" },
  { id: "add-building", label: "Add building", shortcut: "B" },
  { id: "add-feature", label: "Add feature", shortcut: "F" },
];

export function CadToolPalette({
  active,
  onChange,
  compact = false,
  tools = TOOLS.map((tool) => tool.id),
}: {
  active: CadTool;
  onChange: (tool: CadTool) => void;
  compact?: boolean;
  tools?: CadTool[];
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 overflow-x-auto", compact ? "py-0" : "py-1")} role="toolbar" aria-label="CAD tools">
      {TOOLS.filter((tool) => tools.includes(tool.id)).map((tool) => (
        <button
          key={tool.id}
          type="button"
          onClick={() => onChange(tool.id)}
          title={`${tool.label} (${tool.shortcut})`}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
            active === tool.id
              ? "border-[#d6a84a]/60 bg-[#d6a84a] text-[#17130b]"
              : "border-slate-700/70 text-slate-400 hover:border-slate-500 hover:bg-white/[0.05] hover:text-slate-100",
          )}
        >
          <span>{tool.label}</span>
          {!compact && <kbd className="hidden rounded bg-black/15 px-1 text-[9px] font-bold opacity-70 sm:inline">{tool.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
