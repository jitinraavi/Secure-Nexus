import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "./ui";
import type { AssistantPlan } from "../types";
import type { AssistantActionPreview } from "../lib/assistant";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
}

export function DesignAssistantPanel({ messages, onCommand, plan, busy, onPreview, previews, onApply }: { messages: AssistantMessage[]; onCommand: (command: string) => void; plan?: AssistantPlan | null; busy?: boolean; onPreview?: () => void; previews?: AssistantActionPreview[]; onApply?: () => void }) {
  const [command, setCommand] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const submit = () => {
    if (!command.trim()) return;
    onCommand(command.trim());
    setCommand("");
  };
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.originX + event.clientX - dragRef.current.startX,
        y: dragRef.current.originY + event.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  };
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="flex items-center gap-2 rounded-full border border-[#d6a84a]/50 bg-slate-950/95 px-4 py-2 text-xs font-semibold text-[#e5bd67] shadow-2xl backdrop-blur-xl"
        style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      >
        <span className="h-2 w-2 rounded-full bg-[#d6a84a]" />
        Open design assistant
      </button>
    );
  }
  return (
    <aside className="flex w-[min(36rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#d6a84a]/30 bg-slate-950/95 shadow-2xl backdrop-blur-xl" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}>
      <div onPointerDown={beginDrag} className="cursor-move border-b border-slate-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d6a84a]">Design assistant</p>
        <p className="mt-1 text-xs text-slate-500">Commands become reversible design actions.</p>
          </div>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setMinimized(true)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Minimize design assistant">Minimize</button>
        </div>
      </div>
      <div className="min-h-48 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs leading-relaxed text-slate-400">Describe the complete design you want. Example: “Build a 10-house villa community on a 100 m × 80 m plot with a pool, clubhouse, spa, gardens and internal roads.”</p>}
         {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-5 rounded-xl bg-[#d6a84a] p-2.5 text-xs text-[#17130b]" : "mr-5 rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-xs text-slate-300"}>
            {message.text}
          </div>
         ))}
         {plan && <div className="mr-5 space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-2.5 text-xs text-slate-300">
           <p>{plan.summary}</p>
            <p className="text-slate-500">{plan.actions.length} proposed action{plan.actions.length === 1 ? "" : "s"}. Existing editors are unchanged until you explicitly apply a preview.</p>
            {previews?.map((item, index) => <div key={`${item.action.type}-${index}`} className={item.applicable ? "text-emerald-300" : "text-amber-300"}>{item.applicable ? "Ready: " : "Preview only: "}{item.label}{item.reason ? ` (${item.reason})` : ""}</div>)}
            {plan.warnings.map((warning) => <p key={warning} className="text-amber-300">{warning}</p>)}
            {onPreview && <Button className="w-full" size="sm" variant="secondary" onClick={onPreview}>Review action preview</Button>}
            {onApply && previews?.some((item) => item.applicable) && <Button className="w-full" size="sm" onClick={onApply}>Confirm and apply {previews.filter((item) => item.applicable).length} action{previews.filter((item) => item.applicable).length === 1 ? "" : "s"}</Button>}
         </div>}
      </div>
      <div className="border-t border-slate-800 p-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Design request</span>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }}
            placeholder="Build a 10-house villa community with all residential amenities..."
            rows={4}
            className="min-h-28 w-full resize-y rounded-xl border border-slate-700/80 bg-slate-950/55 px-3.5 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
          />
          <span className="text-[11px] text-slate-500">Use Ctrl/Cmd + Enter to request a plan.</span>
        </label>
         <Button className="mt-2 w-full" size="sm" onClick={submit} loading={busy}>Request plan</Button>
      </div>
    </aside>
  );
}
