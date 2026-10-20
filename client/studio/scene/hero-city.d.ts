export interface HeroCityFrame {
  time?: number;
  progress?: number;
  pointerX?: number;
  pointerY?: number;
}

export interface HeroCityScene {
  render(frame?: HeroCityFrame): void;
  resize(): void;
  dispose(): void;
}

export function createHeroCity(options: {
  canvas: HTMLCanvasElement;
  reducedMotion?: boolean;
  framing?: "hero" | "panel";
}): HeroCityScene;
