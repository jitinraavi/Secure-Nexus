import { communityReviewFindings, infraReviewFindings } from "./review";
import type { ReviewWorkerRequest, ReviewWorkerResponse } from "./reviewWorkerProtocol";

// DOM and WebWorker library declarations cannot both be enabled in this project.
// Describe only the dedicated worker operations used here.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ReviewWorkerRequest>) => void) | null;
  postMessage: (message: ReviewWorkerResponse) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const findings = data.kind === "community" ? communityReviewFindings(data.design) : infraReviewFindings(data.design);
    scope.postMessage({ id: data.id, ok: true, findings });
  } catch (error) {
    scope.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : "Coordination analysis failed." });
  }
};
