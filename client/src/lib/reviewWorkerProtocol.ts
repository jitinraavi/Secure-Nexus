import type { CommunityDesign, InfraDesign } from "../types";
import type { ReviewFinding } from "./review";

export type CommunityReviewInput = Pick<CommunityDesign, "towers" | "amenities" | "drafts" | "structuralGrid" | "structural" | "mep">;
export type InfraReviewInput = Pick<InfraDesign, "location" | "facilities" | "drafts" | "mep">;

export type ReviewWorkerRequest =
  | { id: number; kind: "community"; design: CommunityReviewInput }
  | { id: number; kind: "infra"; design: InfraReviewInput };
export type ReviewWorkerResponse =
  | { id: number; ok: true; findings: ReviewFinding[] }
  | { id: number; ok: false; error: string };
