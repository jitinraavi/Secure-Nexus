import type { ReviewAnalysisStatus } from "../lib/useReviewFindings";
import { Button } from "./ui";

export function ReviewAnalysisState({ status, error, retry, runFallback }: { status: ReviewAnalysisStatus; error: string | null; retry: () => void; runFallback: () => void }) {
  if (status === "pending") return <p role="status" className="text-xs text-cyan-300">Updating coordination checks in the background…</p>;
  if (status === "fallback-running") return <p role="status" className="text-xs text-amber-300">Running checks on this tab. Editing may pause until analysis finishes.</p>;
  if (status === "fallback-ready") return <p className="text-xs text-amber-300">Checks completed on this tab using the requested fallback.</p>;
  if (status !== "error") return null;
  return <div role="status" className="space-y-2 rounded-lg border border-amber-500/30 p-3 text-xs text-amber-200">
    <p>Coordination checks are unavailable. {error}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={retry}>Retry background checks</Button><Button size="sm" variant="outline" onClick={runFallback}>Run on this tab (may pause editing)</Button></div>
  </div>;
}
