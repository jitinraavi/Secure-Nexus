import { useState } from "react";
import type { SiteLocation } from "../types";
import { Button, Input } from "../components/ui";
import {
  boundaryMetrics,
  googleEarthUrl,
  type BoundaryMetrics,
  type LatLng,
} from "../lib/geo";

export type LocatorMode = "area" | "route";

interface SiteLocatorProps {
  location?: SiteLocation;
  mode?: LocatorMode;
  onChange: (location: SiteLocation | undefined) => void;
  onApplyBoundary?: (metrics: BoundaryMetrics) => void;
}

export function SiteLocator({ location, mode = "area", onChange, onApplyBoundary }: SiteLocatorProps) {
  const [lat, setLat] = useState(location?.lat ? String(location.lat) : "12.9716");
  const [lng, setLng] = useState(location?.lng ? String(location.lng) : "77.5946");
  const [landShape, setLandShape] = useState<"rectangle" | "polygon" | "corridor">("rectangle");
  const [measuredWidth, setMeasuredWidth] = useState(location?.boundaryWidthM ? String(location.boundaryWidthM) : "80");
  const [measuredLength, setMeasuredLength] = useState(location?.boundaryDepthM ? String(location.boundaryDepthM) : "60");
  const [unit, setUnit] = useState<"m" | "ft">("m");
  const [polygonCoordsText, setPolygonCoordsText] = useState("");
  const [rotationDeg, setRotationDeg] = useState(location?.boundaryRotationDeg ? String(location.boundaryRotationDeg) : "0");
  const [showEarthGuide, setShowEarthGuide] = useState(false);
  const [createdFeedback, setCreatedFeedback] = useState<string | null>(null);

  const currentLat = Number(lat) || 12.9716;
  const currentLng = Number(lng) || 77.5946;
  const earthUrl = googleEarthUrl(currentLat, currentLng);

  const handleCreateCanvas = () => {
    const toMetersFactor = unit === "ft" ? 0.3048 : 1;
    let wM = (Number(measuredWidth) || 80) * toMetersFactor;
    let lM = (Number(measuredLength) || 60) * toMetersFactor;
    const rot = Number(rotationDeg) || 0;
    const center: LatLng = { lat: currentLat, lng: currentLng };

    let boundaryPts: LatLng[] = [];

    if (landShape === "polygon" && polygonCoordsText.trim()) {
      // Parse custom corner coordinates if provided
      const lines = polygonCoordsText.trim().split("\n");
      const parsed: LatLng[] = [];
      for (const line of lines) {
        const parts = line.split(/[,\s]+/).map(Number);
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          parsed.push({ lat: parts[0], lng: parts[1] });
        }
      }
      if (parsed.length >= 3) {
        boundaryPts = parsed;
        const m = boundaryMetrics(parsed);
        if (m) {
          wM = m.widthM;
          lM = m.depthM;
        }
      }
    }

    // Default synthetic rectangular corners based on measured dimensions
    if (boundaryPts.length < 3) {
      const halfW = wM / 2 / 111320;
      const halfL = lM / 2 / 110540;
      boundaryPts = [
        { lat: currentLat + halfL, lng: currentLng - halfW },
        { lat: currentLat + halfL, lng: currentLng + halfW },
        { lat: currentLat - halfL, lng: currentLng + halfW },
        { lat: currentLat - halfL, lng: currentLng - halfW },
      ];
    }

    const calculatedArea = Math.round(wM * lM);
    const metrics: BoundaryMetrics = {
      center,
      widthM: Math.round(wM * 10) / 10,
      depthM: Math.round(lM * 10) / 10,
      rotationDeg: rot,
      areaM2: calculatedArea,
    };

    // Replicate exact dimensions into the site location
    const updatedLocation: SiteLocation = {
      lat: currentLat,
      lng: currentLng,
      zoom: 18,
      boundary: boundaryPts,
      boundaryWidthM: metrics.widthM,
      boundaryDepthM: metrics.depthM,
      boundaryRotationDeg: rot,
      ...(mode === "route" ? { routeLengthM: Math.max(wM, lM), routeBearingDeg: rot } : {}),
    };

    onChange(updatedLocation);
    onApplyBoundary?.(metrics);

    setCreatedFeedback(`Canvas created: ${metrics.widthM}m × ${metrics.depthM}m (${metrics.areaM2.toLocaleString()} m²) replicated in 3D scene.`);
    setTimeout(() => setCreatedFeedback(null), 6000);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-slate-100">
      {/* Header with Google Earth View Link */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              🌍
            </span>
            Google Earth Land & Canvas
          </h3>
          <p className="text-xs text-slate-400">
            Inspect real land in Google Earth, measure its boundary, and replicate exact dimensions as your project canvas.
          </p>
        </div>

        <a
          href={earthUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 shadow-sm"
        >
          <span>View in Google Earth</span>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Google Earth Measurement Guide Toggle */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
        <button
          type="button"
          onClick={() => setShowEarthGuide(!showEarthGuide)}
          className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-300 hover:text-emerald-300"
        >
          <span>📏 How to measure land in Google Earth</span>
          <span className="text-emerald-400 text-xs">{showEarthGuide ? "Hide guidance ▲" : "Show steps ▼"}</span>
        </button>
        {showEarthGuide && (
          <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-400">
            <li>Click <strong>"View in Google Earth"</strong> above to navigate to your site location.</li>
            <li>In Google Earth, click the <strong>Ruler / Measure</strong> icon (on the left panel).</li>
            <li>Click points around your property or plot boundary to measure perimeter, length & breadth, or area.</li>
            <li>Enter those measured numbers below and click <strong>"Create Canvas"</strong> to replicate the exact shape in 3D.</li>
          </ol>
        )}
      </div>

      {/* Coordinates */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Site Latitude"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="12.9716"
        />
        <Input
          label="Site Longitude"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          placeholder="77.5946"
        />
      </div>

      {/* Shape & Measurement Options */}
      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">Measured Land Shape</span>
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setUnit("m")}
              className={`rounded px-2.5 py-0.5 font-medium transition ${unit === "m" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400"}`}
            >
              Meters
            </button>
            <button
              type="button"
              onClick={() => setUnit("ft")}
              className={`rounded px-2.5 py-0.5 font-medium transition ${unit === "ft" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400"}`}
            >
              Feet
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          {(["rectangle", "polygon", "corridor"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setLandShape(s)}
              className={`flex-1 rounded-lg border py-1.5 text-xs font-medium capitalize transition ${
                landShape === s
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Breadth / Width (${unit})`}
            value={measuredWidth}
            onChange={(e) => setMeasuredWidth(e.target.value)}
            placeholder={unit === "m" ? "80" : "260"}
          />
          <Input
            label={`Length / Depth (${unit})`}
            value={measuredLength}
            onChange={(e) => setMeasuredLength(e.target.value)}
            placeholder={unit === "m" ? "60" : "200"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Plot Orientation / Rotation (°)"
            value={rotationDeg}
            onChange={(e) => setRotationDeg(e.target.value)}
            placeholder="0"
          />
          <div className="flex flex-col justify-end">
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2 text-xs text-slate-400">
              Est. Area: <strong className="text-emerald-400">
                {(
                  (Number(measuredWidth) || 0) * (Number(measuredLength) || 0)
                ).toLocaleString()} {unit === "m" ? "m²" : "sq ft"}
              </strong>
            </div>
          </div>
        </div>

        {landShape === "polygon" && (
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Optional Google Earth Corner Coordinates (lat, lng per line):
            </label>
            <textarea
              value={polygonCoordsText}
              onChange={(e) => setPolygonCoordsText(e.target.value)}
              placeholder="12.9716, 77.5946&#10;12.9720, 77.5950&#10;12.9715, 77.5955"
              rows={3}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500"
            />
          </div>
        )}
      </div>

      {/* Create Canvas Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Button
          onClick={handleCreateCanvas}
          className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold shadow-lg shadow-emerald-950/40"
        >
          ✨ Create Canvas from Measured Land
        </Button>

        {createdFeedback && (
          <p className="text-xs font-medium text-emerald-400 animate-fade-in">
            {createdFeedback}
          </p>
        )}
      </div>
    </div>
  );
}
