import { useState } from "react";
import { Button } from "./ui";
import type { AssistantPlan } from "../types";
import type { AssistantActionPreview } from "../lib/assistant";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
}

export function DesignAssistantPanel({ messages, onCommand, plan, busy, onPreview, previews, onApply }: { messages: AssistantMessage[]; onCommand: (command: string) => void; plan?: AssistantPlan | null; busy?: boolean; onPreview?: () => void; previews?: AssistantActionPreview[]; onApply?: () => void }) {
  const [command, setCommand] = useState("");
  const submit = () => {
    if (!command.trim()) return;
    onCommand(command.trim());
    setCommand("");
  };
  return (
    <aside className="flex w-[min(36rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#d6a84a]/30 bg-slate-950/95 shadow-2xl backdrop-blur-xl">
      <div className="border-b border-slate-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d6a84a]">Design assistant</p>
        <p className="mt-1 text-xs text-slate-500">Commands become reversible design actions.</p>
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
