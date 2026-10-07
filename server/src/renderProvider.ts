import zlib from "node:zlib";

export interface RenderProviderParams {
  prompt: string;
  negativePrompt?: string;
  stylePreset?: string;
  sourceImageBuffer: Buffer;
  sourceImageMime?: string;
  parameters?: Record<string, unknown>;
}

export interface RenderProviderResult {
  imageBuffer: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  version: string;
  metadata?: Record<string, unknown>;
}

export interface RenderPreset {
  id: string;
  name: string;
  description: string;
  promptEnhancement: string;
}

export const RENDER_STYLE_PRESETS: RenderPreset[] = [
  {
    id: "photorealistic-daylight",
    name: "Photorealistic Daylight",
    description: "Crisp natural daylight with soft realistic sun shadows, clear sky, and true-to-life building materials.",
    promptEnhancement: "photorealistic architectural photograph, natural bright daylight, sharp realistic shadows, 8k resolution, architectural magazine quality",
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    description: "Warm sunset lighting with long soft shadows, glowing atmosphere, and rich specular highlights.",
    promptEnhancement: "golden hour architectural rendering, warm sunset sunlight, warm atmospheric glow, dramatic lighting, detailed facade textures",
  },
  {
    id: "dusk-architectural",
    name: "Architectural Dusk",
    description: "Deep twilight sky with warmly illuminated interior spaces, facade accent lighting, and reflection pools.",
    promptEnhancement: "architectural dusk exterior, glowing warm interior lighting through windows, twilight sky, facade accent lights, photorealistic building visualization",
  },
  {
    id: "interior-warm",
    name: "Interior Warm Lighting",
    description: "Soft ambient indoor lighting emphasizing materiality, wood, stone, glass, and architectural detailing.",
    promptEnhancement: "architectural interior rendering, warm ambient recessed lighting, high detail materials, photorealistic finishes, elegant modern design",
  },
  {
    id: "modern-minimalist",
    name: "Modern Minimalist",
    description: "Clean diffused overcast daylight with subtle reflections, neutral palette, and pure geometry lines.",
    promptEnhancement: "modern minimalist architectural render, clean lines, diffused soft lighting, neutral tones, smooth concrete and glass textures",
  },
  {
    id: "dramatic-moody",
    name: "Dramatic Moody",
    description: "High contrast cloudy sky with wet ground reflections and bold atmospheric depth.",
    promptEnhancement: "dramatic architectural visualization, overcast cloudy sky, wet surface reflections, deep contrast, cinematic composition",
  },
];

export class RenderProviderError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = "RenderProviderError";
  }
}

export interface RenderProvider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  getUnconfiguredReason(): string | null;
  generate(params: RenderProviderParams, signal?: AbortSignal): Promise<RenderProviderResult>;
}

/**
 * Creates a valid standalone PNG buffer in pure Node.js without binary native dependencies.
 */
export function generatePurePng(
  width: number,
  height: number,
  pixelShader: (x: number, y: number, width: number, height: number) => [number, number, number, number],
): Buffer {
  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelShader(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = Math.max(0, Math.min(255, Math.round(r)));
      rawData[pixelOffset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rawData[pixelOffset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rawData[pixelOffset + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter None
  ihdr[12] = 0; // non-interlaced

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Demo rendering provider for testing and environments without external API keys.
 * Simulates high-quality architectural render synthesis with lighting, shading, and preset gradients.
 */
export class DemoRenderProvider implements RenderProvider {
  public readonly id = "demo-architectural";
  public readonly name = "Groundwork Architectural Synthesizer (Demo)";
  public readonly model = "groundwork-synth-2026.1";
  public readonly version = "1.0.0";

  public isConfigured(): boolean {
    return true;
  }

  public getUnconfiguredReason(): string | null {
    return null;
  }

  public async generate(params: RenderProviderParams, signal?: AbortSignal): Promise<RenderProviderResult> {
    if (signal?.aborted) {
      throw new DOMException("The rendering operation was cancelled", "AbortError");
    }

    // Determine color palette based on style preset
    const preset = RENDER_STYLE_PRESETS.find((p) => p.id === params.stylePreset) || RENDER_STYLE_PRESETS[0];

    const width = 512;
    const height = 512;

    const imageBuffer = generatePurePng(width, height, (x, y, w, h) => {
      const nx = x / w;
      const ny = y / h;

      let r = 240, g = 245, b = 250;
      if (preset.id === "golden-hour") {
        // Sky gradient: warm orange to violet-blue
        r = Math.floor(255 - ny * 70);
        g = Math.floor(180 - ny * 90);
        b = Math.floor(120 + ny * 60);
      } else if (preset.id === "dusk-architectural") {
        // Deep twilight sky
        r = Math.floor(25 + ny * 35);
        g = Math.floor(40 + ny * 45);
        b = Math.floor(95 + ny * 60);
      } else if (preset.id === "interior-warm") {
        r = Math.floor(245 - ny * 30);
        g = Math.floor(230 - ny * 40);
        b = Math.floor(210 - ny * 50);
      } else if (preset.id === "dramatic-moody") {
        const grey = Math.floor(130 - ny * 50);
        r = grey;
        g = grey + 5;
        b = grey + 15;
      } else {
        // Daylight sky
        r = Math.floor(180 + (1 - ny) * 50);
        g = Math.floor(215 + (1 - ny) * 35);
        b = Math.floor(248);
      }

      // Ground plane
      if (ny > 0.65) {
        const groundGrad = (ny - 0.65) / 0.35;
        r = Math.floor(120 - groundGrad * 40);
        g = Math.floor(130 - groundGrad * 40);
        b = Math.floor(135 - groundGrad * 35);
      }

      // Architectural structure silhouette & glass facades (centered block)
      if (nx >= 0.25 && nx <= 0.75 && ny >= 0.25 && ny <= 0.75) {
        const facadeGrad = (ny - 0.25) / 0.5;
        const column = Math.floor((nx - 0.25) * 16) % 2 === 0;

        if (preset.id === "dusk-architectural") {
          // Glowing warm windows at dusk
          if (column) {
            r = Math.floor(255 - facadeGrad * 30);
            g = Math.floor(215 - facadeGrad * 40);
            b = Math.floor(120 - facadeGrad * 50);
          } else {
            r = 60; g = 65; b = 75;
          }
        } else {
          // Reflective glass & concrete frame
          if (column) {
            r = Math.floor(190 + facadeGrad * 40);
            g = Math.floor(210 + facadeGrad * 35);
            b = Math.floor(230 + facadeGrad * 25);
          } else {
            r = Math.floor(90 + facadeGrad * 50);
            g = Math.floor(95 + facadeGrad * 50);
            b = Math.floor(105 + facadeGrad * 50);
          }
        }
      }

      // Border frame
      if (x < 4 || x >= w - 4 || y < 4 || y >= h - 4) {
        return [30, 41, 59, 255];
      }

      return [r, g, b, 255];
    });

    return {
      imageBuffer,
      mimeType: "image/png",
      provider: this.id,
      model: this.model,
      version: this.version,
      metadata: {
        preset: preset.id,
        resolution: `${width}x${height}`,
        simulated: true,
      },
    };
  }
}

/**
 * Google Gemini / Imagen photorealistic rendering provider.
 * Connects to Google's Imagen / Gemini multimodal image generation API when GEMINI_API_KEY is supplied.
 */
export class GeminiImagenRenderProvider implements RenderProvider {
  public readonly id = "gemini-imagen";
  public readonly name = "Google Gemini Imagen Photorealistic Renderer";
  public readonly model: string;
  public readonly version = "2026.1";

  constructor(private readonly apiKey: string, modelOverride?: string) {
    this.model = modelOverride || process.env.IMAGEN_MODEL || "imagen-3.0-generate-002";
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public getUnconfiguredReason(): string | null {
    if (!this.apiKey || !this.apiKey.trim()) {
      return "GEMINI_API_KEY is missing from environment. Configure GEMINI_API_KEY to enable photorealistic rendering.";
    }
    return null;
  }

  public async generate(params: RenderProviderParams, signal?: AbortSignal): Promise<RenderProviderResult> {
    if (!this.isConfigured()) {
      throw new RenderProviderError(503, this.getUnconfiguredReason() || "Provider not configured", "PROVIDER_UNCONFIGURED");
    }

    const preset = RENDER_STYLE_PRESETS.find((p) => p.id === params.stylePreset);
    const combinedPrompt = [
      params.prompt,
      preset ? preset.promptEnhancement : "photorealistic architectural building visualization, high realism, 8k resolution",
    ].filter(Boolean).join(". ");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.apiKey}`;

    const requestBody = {
      instances: [
        {
          prompt: combinedPrompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
        negativePrompt: params.negativePrompt || "blurry, distorted, low quality, cartoon, render artifact",
        personGeneration: "ALLOW_ADULT",
      },
    };

    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw error;
      }
      throw new RenderProviderError(502, `Failed to reach Gemini rendering service: ${(error as Error).message}`, "UPSTREAM_CONNECTION_FAILED");
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new RenderProviderError(401, `Gemini API key authentication failed (${response.status}): ${errText}`, "INVALID_API_KEY");
      }
      if (response.status === 429) {
        throw new RenderProviderError(429, `Gemini rendering quota exceeded: ${errText}`, "RATE_LIMITED");
      }
      throw new RenderProviderError(response.status, `Gemini image generation failed: ${errText}`, "GENERATION_FAILED");
    }

    const json = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };

    const firstPrediction = json.predictions?.[0];
    if (!firstPrediction?.bytesBase64Encoded) {
      throw new RenderProviderError(502, "Gemini returned empty image prediction data", "EMPTY_PREDICTION");
    }

    const buffer = Buffer.from(firstPrediction.bytesBase64Encoded, "base64");
    const mime = firstPrediction.mimeType || "image/png";

    return {
      imageBuffer: buffer,
      mimeType: mime,
      provider: this.id,
      model: this.model,
      version: this.version,
      metadata: {
        preset: preset?.id,
        bytes: buffer.length,
      },
    };
  }
}

/**
 * Unconfigured placeholder provider when no keys or demo flags are set.
 * Returns clear instructions on what is needed to activate the renderer.
 */
export class UnconfiguredRenderProvider implements RenderProvider {
  public readonly id = "unconfigured";
  public readonly name = "No AI Rendering Provider Configured";
  public readonly model = "none";
  public readonly version = "none";

  public isConfigured(): boolean {
    return false;
  }

  public getUnconfiguredReason(): string | null {
    return "AI photorealistic rendering requires GEMINI_API_KEY or an external render provider configuration. To enable demo mode for local evaluation, set RENDER_PROVIDER=demo in the server environment.";
  }

  public async generate(_params: RenderProviderParams): Promise<RenderProviderResult> {
    throw new RenderProviderError(
      503,
      this.getUnconfiguredReason() || "AI rendering provider is not configured",
      "PROVIDER_UNCONFIGURED",
    );
  }
}

let testProviderOverride: RenderProvider | null = null;

export function setRenderProviderForTesting(provider: RenderProvider | null): void {
  testProviderOverride = provider;
}

export function getRenderProvider(): RenderProvider {
  if (testProviderOverride) {
    return testProviderOverride;
  }

  const explicitProvider = process.env.RENDER_PROVIDER?.toLowerCase();
  if (explicitProvider === "demo" || process.env.NODE_ENV === "test") {
    return new DemoRenderProvider();
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.IMAGEN_API_KEY;
  if (geminiKey) {
    return new GeminiImagenRenderProvider(geminiKey);
  }

  return new UnconfiguredRenderProvider();
}
