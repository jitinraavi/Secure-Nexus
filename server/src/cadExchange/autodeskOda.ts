import type {
  CadConversionExecutor,
  CadExchangeAdapter,
  CadExchangeRequest,
  CadExchangeResult,
  CadProviderStatus,
} from "./types.js";
import { validateCadMetadata } from "./types.js";

export interface AutodeskOdaAdapterConfig {
  providerName: string;
  licenseStatus: "licensed" | "unlicensed" | "unknown";
  endpoint: string;
  sdkCapability: boolean;
  executor?: CadConversionExecutor;
}

export function createAutodeskOdaAdapter(config: AutodeskOdaAdapterConfig): CadExchangeAdapter {
  const status = (): CadProviderStatus => {
    const endpointConfigured = Boolean(config.endpoint);
    const available = config.licenseStatus === "licensed" && endpointConfigured && config.sdkCapability && Boolean(config.executor);
    return {
      providerName: config.providerName,
      licenseStatus: config.licenseStatus,
      endpointConfigured,
      sdkCapability: config.sdkCapability,
      supportedFormats: ["dwg"],
      available,
      message: available
        ? "Licensed DWG provider is configured."
        : config.licenseStatus !== "licensed"
          ? "DWG export/import requires an active Autodesk or ODA license."
          : !config.sdkCapability
            ? "DWG provider SDK capability is not installed."
            : !endpointConfigured
              ? "DWG provider endpoint is not configured."
              : "DWG provider transport is not configured.",
    };
  };

  const unavailable = (request: CadExchangeRequest, code: "unlicensed" | "sdk_unavailable" | "endpoint_unconfigured" | "transport_unconfigured" | "validation_failed", message: string, issues = validateCadMetadata(request.metadata)): CadExchangeResult => ({
    outcome: "unavailable",
    code,
    message,
    metadata: request.metadata,
    issues,
  });

  const convert = async (operation: "import" | "export", request: CadExchangeRequest): Promise<CadExchangeResult> => {
    const issues = validateCadMetadata(request.metadata);
    if (issues.some((issue) => issue.blocking)) return unavailable(request, "validation_failed", "DWG conversion metadata failed validation.", issues);
    if (config.licenseStatus !== "licensed") return unavailable(request, "unlicensed", "DWG conversion is unavailable because no active provider license is configured.", issues);
    if (!config.sdkCapability) return unavailable(request, "sdk_unavailable", "DWG conversion is unavailable because the provider SDK capability is not installed.", issues);
    if (!config.endpoint) return unavailable(request, "endpoint_unconfigured", "DWG conversion is unavailable because the provider endpoint is not configured.", issues);
    if (!config.executor) return unavailable(request, "transport_unconfigured", "DWG conversion is unavailable because no licensed provider transport is configured.", issues);
    return config.executor(operation, request);
  };

  return {
    providerName: config.providerName,
    status,
    import: (request) => convert("import", request),
    export: (request) => convert("export", request),
  };
}
