import { createAutodeskOdaAdapter } from "./autodeskOda.js";
import type { CadExchangeAdapter, CadProviderStatus } from "./types.js";

export class CadExchangeProviderRegistry {
  private readonly providers = new Map<string, CadExchangeAdapter>();

  register(adapter: CadExchangeAdapter): void {
    this.providers.set(adapter.providerName, adapter);
  }

  get(providerName: string): CadExchangeAdapter | undefined {
    return this.providers.get(providerName);
  }

  statuses(): CadProviderStatus[] {
    return [...this.providers.values()].map((provider) => provider.status());
  }
}

export const cadExchangeProviders = new CadExchangeProviderRegistry();
cadExchangeProviders.register(createAutodeskOdaAdapter({
  providerName: process.env.CAD_EXCHANGE_PROVIDER_NAME || "Autodesk / ODA",
  licenseStatus: process.env.CAD_EXCHANGE_LICENSE_STATUS === "licensed" ? "licensed" : "unlicensed",
  endpoint: process.env.CAD_EXCHANGE_ENDPOINT || "",
  sdkCapability: process.env.CAD_EXCHANGE_SDK_CAPABILITY === "true",
}));
