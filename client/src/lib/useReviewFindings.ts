import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunityDesign, InfraDesign } from "../types";
import { communityReviewFindings, infraReviewFindings, type ReviewFinding } from "./review";
import type { ReviewWorkerRequest, ReviewWorkerResponse } from "./reviewWorkerProtocol";

export type ReviewAnalysisStatus = "pending" | "ready" | "error" | "fallback-running" | "fallback-ready";
interface AnalysisState {
  input: ReviewWorkerRequest;
  findings: ReviewFinding[];
  status: ReviewAnalysisStatus;
  error: string | null;
}

export function useReviewFindings(kind: "community", design: CommunityDesign): { findings: ReviewFinding[]; status: ReviewAnalysisStatus; error: string | null; runFallback: () => void; retry: () => void };
export function useReviewFindings(kind: "infra", design: InfraDesign): { findings: ReviewFinding[]; status: ReviewAnalysisStatus; error: string | null; runFallback: () => void; retry: () => void };
export function useReviewFindings(kind: "community" | "infra", design: CommunityDesign | InfraDesign) {
  const community = kind === "community" ? design as CommunityDesign : undefined;
  const infra = kind === "infra" ? design as InfraDesign : undefined;
  const input = useMemo<ReviewWorkerRequest>(() => {
    if (kind === "community") {
      const value = design as CommunityDesign;
      return { id: 0, kind, design: { towers: value.towers, amenities: value.amenities, drafts: value.drafts, structuralGrid: value.structuralGrid, structural: value.structural, mep: value.mep } };
    }
    const value = design as InfraDesign;
    return { id: 0, kind, design: { location: value.location, facilities: value.facilities, drafts: value.drafts, mep: value.mep } };
  }, [kind, community?.towers, community?.amenities, community?.drafts, community?.structuralGrid, community?.structural, community?.mep, infra?.location, infra?.facilities, infra?.drafts, infra?.mep]);
  const [state, setState] = useState<AnalysisState>({ input, findings: [], status: "pending", error: null });
  const [attempt, setAttempt] = useState({ number: 0, mode: "worker" as "worker" | "fallback", input });
  const sequence = useRef(0);
  useEffect(() => {
    const id = ++sequence.current;
    const mode = attempt.input === input ? attempt.mode : "worker";
    let cancelled = false;
    let worker: Worker | null = null;
    let deadline: number | undefined;
    const complete = (findings: ReviewFinding[], status: "ready" | "fallback-ready") => {
      if (!cancelled) setState({ input, findings, status, error: null });
      cancelled = true;
      if (deadline !== undefined) window.clearTimeout(deadline);
      worker?.terminate();
    };
    const fail = (message: string) => {
      if (!cancelled) setState({ input, findings: [], status: "error", error: message });
      cancelled = true;
      if (deadline !== undefined) window.clearTimeout(deadline);
      worker?.terminate();
    };
    setState({ input, findings: [], status: mode === "fallback" ? "fallback-running" : "pending", error: null });
    // Debounce repeated edits; cancellation terminates the previous computation.
    const timer = window.setTimeout(() => {
      if (mode === "fallback") {
        try {
          const findings = input.kind === "community" ? communityReviewFindings(input.design) : infraReviewFindings(input.design);
          complete(findings, "fallback-ready");
        } catch (error) { fail(error instanceof Error ? error.message : "Coordination analysis failed."); }
        return;
      }
      try {
        if (typeof Worker === "undefined") throw new Error("This browser does not provide background workers.");
        worker = new Worker(new URL("./review.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<ReviewWorkerResponse>) => {
          if (cancelled || event.data.id !== id) return;
          if (event.data.ok) complete(event.data.findings, "ready");
          else fail(event.data.error);
        };
        worker.onerror = () => fail("Background coordination analysis could not start or complete.");
        worker.onmessageerror = () => fail("Background coordination results could not be read.");
        deadline = window.setTimeout(() => fail("Background coordination analysis exceeded 30 seconds. Reduce the model or retry."), 30000);
        worker.postMessage({ ...input, id } satisfies ReviewWorkerRequest);
      } catch (error) { fail(error instanceof Error ? error.message : "Background coordination analysis unavailable."); }
    }, mode === "fallback" ? 50 : 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (deadline !== undefined) window.clearTimeout(deadline);
      worker?.terminate();
    };
  }, [input, attempt]);
  // Do not show a clean result from an older model while a new job is starting.
  const current = state.input === input ? state : { findings: [], status: "pending" as const, error: null };
  return {
    findings: current.findings,
    status: current.status,
    error: current.error,
    runFallback: () => setAttempt(value => ({ number: value.number + 1, mode: "fallback", input })),
    retry: () => setAttempt(value => ({ number: value.number + 1, mode: "worker", input })),
  };
}
