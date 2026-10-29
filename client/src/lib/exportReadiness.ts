import type { CadExchangeStatusResponse } from "../api";

export type CadExportReadiness =
  | { status: "loading" }
  | { status: "ready"; data: CadExchangeStatusResponse }
  | { status: "error" };

/** Each observation belongs to one open dialog/request; cancelled results cannot replace a retry. */
export function observeCadExportReadiness(
  request: () => Promise<CadExchangeStatusResponse>,
  publish: (state: CadExportReadiness) => void,
): () => void {
  let active = true;
  publish({ status: "loading" });
  void Promise.resolve().then(request).then(
    data => { if (active) publish({ status: "ready", data }); },
    () => { if (active) publish({ status: "error" }); },
  );
  return () => { active = false; };
}

export function dwgExportReadiness(state: CadExportReadiness): { label: string; message: string; available: boolean } {
  if (state.status === "loading") return {
    label: "Checking DWG availability",
    message: "Reading this server's conversion-worker configuration.",
    available: false,
  };
  if (state.status === "error") return {
    label: "DWG availability could not be checked",
    message: "Check your connection and retry. No worker availability has been confirmed.",
    available: false,
  };
  const capability = state.data.nativeCapabilities?.find(item => item.kind === "dxf-to-dwg");
  return capability ? {
    label: capability.available ? "DWG conversion can be queued" : "DWG conversion unavailable",
    message: capability.reason,
    available: capability.available,
  } : {
    label: "DWG conversion unavailable",
    message: "This server did not report a DWG conversion worker.",
    available: false,
  };
}
