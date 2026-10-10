export type CadFormat = "dwg" | "dxf" | "ifc";
export type CadLicenseStatus = "licensed" | "unlicensed" | "unknown";

export interface CadExchangeMetadata {
  sourceFormat: CadFormat;
  targetFormat: CadFormat;
  sourceUnits: string;
  targetUnits: string;
  layers: string[];
  blocks: string[];
  properties: string[];
  references: string[];
  conversionId?: string;
}

export type CadValidationScope = "layers" | "units" | "blocks" | "properties" | "references";

export interface CadValidationIssue {
  scope: CadValidationScope;
  message: string;
  blocking: boolean;
}

export interface CadExchangeRequest {
  payload: Uint8Array;
  metadata: CadExchangeMetadata;
}

export interface CadExchangeSuccess {
  outcome: "success";
  format: CadFormat;
  payload: Uint8Array;
  metadata: CadExchangeMetadata;
  warnings: CadValidationIssue[];
}

export interface CadExchangeUnavailable {
  outcome: "unavailable";
  code: "unlicensed" | "sdk_unavailable" | "endpoint_unconfigured" | "transport_unconfigured" | "validation_failed";
  message: string;
  metadata: CadExchangeMetadata;
  issues: CadValidationIssue[];
}

export type CadExchangeResult = CadExchangeSuccess | CadExchangeUnavailable;

export interface CadProviderStatus {
  providerName: string;
  licenseStatus: CadLicenseStatus;
  endpointConfigured: boolean;
  sdkCapability: boolean;
  supportedFormats: CadFormat[];
  available: boolean;
  message: string;
}

export interface CadExchangeAdapter {
  readonly providerName: string;
  status(): CadProviderStatus;
  import(request: CadExchangeRequest): Promise<CadExchangeResult>;
  export(request: CadExchangeRequest): Promise<CadExchangeResult>;
}

export type CadConversionExecutor = (operation: "import" | "export", request: CadExchangeRequest) => Promise<CadExchangeSuccess>;

export function validateCadMetadata(metadata: CadExchangeMetadata): CadValidationIssue[] {
  const issues: CadValidationIssue[] = [];
  if (!metadata.sourceUnits || !metadata.targetUnits) {
    issues.push({ scope: "units", message: "Source and target units are required.", blocking: true });
  }
  if (metadata.layers.some((layer) => !layer.trim())) {
    issues.push({ scope: "layers", message: "Layer names cannot be empty.", blocking: true });
  }
  if (metadata.blocks.some((block) => !block.trim())) {
    issues.push({ scope: "blocks", message: "Block names cannot be empty.", blocking: true });
  }
  if (metadata.properties.some((property) => !property.trim())) {
    issues.push({ scope: "properties", message: "Property names cannot be empty.", blocking: true });
  }
  if (metadata.references.some((reference) => !reference.trim())) {
    issues.push({ scope: "references", message: "Reference names cannot be empty.", blocking: true });
  }
  return issues;
}
