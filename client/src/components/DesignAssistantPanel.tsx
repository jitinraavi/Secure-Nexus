import { useState } from "react";
import { Button, Input } from "./ui";
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
    <aside className="flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-[#d6a84a]/30 bg-slate-950/95 shadow-2xl backdrop-blur-xl">
      <div className="border-b border-slate-800 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d6a84a]">Design assistant</p>
        <p className="mt-1 text-xs text-slate-500">Commands become reversible design actions.</p>
      </div>
      <div className="min-h-48 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs leading-relaxed text-slate-400">Try “create a 30 m x 20 m plot”, “add a swimming pool”, or “add a 4-floor tower”.</p>}
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
        <Input label="Command" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} placeholder="Add a 4-floor villa..." />
         <Button className="mt-2 w-full" size="sm" onClick={submit} loading={busy}>Request plan</Button>
      </div>
    </aside>
  );
}
