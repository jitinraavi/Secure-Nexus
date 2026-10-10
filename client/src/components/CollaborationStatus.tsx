import { useEffect, useState } from "react";
import { subscribeToProject, type CollaborationEvent } from "../api";

export function CollaborationStatus({ projectId, onRemoteEvent }: { projectId: string; onRemoteEvent: (event: CollaborationEvent) => void }) {
  const [status, setStatus] = useState<"connected" | "disconnected">("disconnected");
  useEffect(() => subscribeToProject(projectId, onRemoteEvent, setStatus), [projectId, onRemoteEvent]);
  return <span className={status === "connected" ? "text-emerald-400" : "text-amber-400"}>{status === "connected" ? "Live" : "Reconnecting"}</span>;
}
