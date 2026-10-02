import type { Design, DimensionStyle, TechnicalGraphicsSettings } from "../types";

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  name: "Groundwork ISO",
  textHeightMm: 2.5,
  arrowSizeMm: 2.5,
  precision: 2,
  units: "m",
  suppressTrailingZeros: false,
};

export const DEFAULT_TECHNICAL_GRAPHICS: TechnicalGraphicsSettings = {
  displayMode: "shaded-edges",
  lineweights: {
    walls: 50,
    structure: 45,
    mep: 25,
    furniture: 18,
    dimensions: 18,
    annotations: 18,
    site: 25,
  },
  dimensionStyle: DEFAULT_DIMENSION_STYLE,
  showAxes: true,
  showNorthArrow: true,
  showScaleBar: true,
  showElevationMarkers: true,
};

export function technicalGraphicsSettings(value?: Design["technicalGraphics"]): TechnicalGraphicsSettings {
  return {
    ...DEFAULT_TECHNICAL_GRAPHICS,
    ...(value ?? {}),
    lineweights: { ...DEFAULT_TECHNICAL_GRAPHICS.lineweights, ...(value?.lineweights ?? {}) },
    dimensionStyle: { ...DEFAULT_DIMENSION_STYLE, ...(value?.dimensionStyle ?? {}) },
  };
}

export function formatDimensionMetres(valueM: number, style: DimensionStyle): string {
  const precision = Math.min(Math.max(Math.round(style.precision), 0), 6);
  if (style.units === "mm") {
    const raw = (valueM * 1000).toFixed(precision);
    return `${style.suppressTrailingZeros ? trimZeros(raw) : raw} mm`;
  }
  if (style.units === "ft-in") {
    const totalInches = Math.max(valueM, 0) / 0.0254;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches - feet * 12;
    const raw = inches.toFixed(precision);
    return `${feet}'-${style.suppressTrailingZeros ? trimZeros(raw) : raw}"`;
  }
  const raw = valueM.toFixed(precision);
  return `${style.suppressTrailingZeros ? trimZeros(raw) : raw} m`;
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function dxfLineweightHundredthsMm(value: number): number {
  const allowed = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
  return allowed.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, 25);
}
