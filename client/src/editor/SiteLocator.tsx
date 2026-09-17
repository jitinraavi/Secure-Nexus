import { useEffect, useRef, useState } from "react";
import type { SiteLocation } from "../types";
import { Button, Input } from "../components/ui";
import { bearingDeg, boundaryMetrics, googleEarthUrl, polylineLengthM, type BoundaryMetrics } from "../lib/geo";

/**
 * Site locator.
 *
 * Uses the Google Maps JavaScript API (satellite/hybrid) to find the site,
 * drop a draggable pin, and either trace a boundary (area mode — airports,
 * ports, dams) or a route centreline (route mode — highways). When no
 * VITE_GOOGLE_MAPS_KEY is configured it degrades to manual coordinate entry
 * plus a Google Earth deep link, so the wizard keeps working offline.
 */

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "").trim();
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };

type MapsStatus = "loading" | "ready" | "error" | "nokey";
export type LocatorMode = "area" | "route";

let loaderPromise: Promise<typeof google> | null = null;

function loadGoogleMaps(key: string): Promise<typeof google> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { google?: typeof google };
    if (w.google?.maps) {
      resolve(w.google);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => (w.google ? resolve(w.google) : reject(new Error("Google Maps loaded without namespace")));
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loaderPromise;
}

interface SiteLocatorProps {
  location?: SiteLocation;
  mode?: LocatorMode;
  onChange: (location: SiteLocation | undefined) => void;
  onApplyBoundary?: (metrics: BoundaryMetrics) => void;
}

export function SiteLocator({ location, mode = "area", onChange, onApplyBoundary }: SiteLocatorProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const routePoints = useRef<{ lat: number; lng: number }[]>([]);
  const routeDraw = useRef(false);
  const metricsRef = useRef<BoundaryMetrics | null>(null);
  const cbRef = useRef({ onChange, onApplyBoundary });
  const locRef = useRef(location);
  cbRef.current = { onChange, onApplyBoundary };
  locRef.current = location;

  const [status, setStatus] = useState<MapsStatus>(KEY ? "loading" : "nokey");
  const [tracing, setTracing] = useState(false);
  const [routing, setRouting] = useState(false);
  const [manualLat, setManualLat] = useState(location ? String(location.lat) : "");
  const [manualLng, setManualLng] = useState(location ? String(location.lng) : "");
  const [metrics, setMetrics] = useState<BoundaryMetrics | null>(null);
  const [routeLength, setRouteLength] = useState<number | null>(location?.routeLengthM ?? null);

  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;
    loadGoogleMaps(KEY)
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        const center = locRef.current ? { lat: locRef.current.lat, lng: locRef.current.lng } : DEFAULT_CENTER;
        const map = new g.maps.Map(mapEl.current, {
          center,
          zoom: locRef.current?.zoom ?? 17,
          mapTypeId: "hybrid",
          tilt: 0,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          mapTypeControlOptions: {
            style: g.maps.MapTypeControlStyle.HORIZONTAL_BAR,
            position: g.maps.ControlPosition.TOP_RIGHT,
          },
        });
        mapRef.current = map;

        const marker = new g.maps.Marker({ position: center, map, draggable: true, title: "Drag to set the site centre" });
        markerRef.current = marker;

        const sync = (lat: number, lng: number, extra?: Partial<SiteLocation>) => {
          cbRef.current.onChange({ lat, lng, zoom: map.getZoom(), ...extra });
        };

        const ensurePolygon = () => {
          if (polygonRef.current) return polygonRef.current;
          const polygon = new g.maps.Polygon({
            map,
            paths: [],
            fillColor: "#34d399",
            fillOpacity: 0.25,
            strokeColor: "#34d399",
            strokeWeight: 2,
            editable: true,
            draggable: true,
            clickable: false,
          });
          const recompute = () => {
            const path = polygon.getPath().getArray().map((p) => ({ lat: p.lat(), lng: p.lng() }));
            const m = boundaryMetrics(path);
            if (!m) return;
            metricsRef.current = m;
            setMetrics(m);
            cbRef.current.onChange({
              ...(locRef.current ?? { lat: m.center.lat, lng: m.center.lng }),
              lat: m.center.lat,
              lng: m.center.lng,
              zoom: map.getZoom(),
              boundary: path,
              boundaryWidthM: m.widthM,
              boundaryDepthM: m.depthM,
              boundaryRotationDeg: m.rotationDeg,
            });
          };
          const path = polygon.getPath();
          path.addListener("set_at", recompute);
          path.addListener("insert_at", recompute);
          path.addListener("remove_at", recompute);
          polygonRef.current = polygon;
          return polygon;
        };

        const refreshRoute = () => {
          const pts = routePoints.current;
          const len = polylineLengthM(pts);
          setRouteLength(pts.length >= 2 ? len : null);
          const last = pts[pts.length - 1];
          const bearing = pts.length >= 2 ? bearingDeg(pts[0], pts[1]) : undefined;
          cbRef.current.onChange({
            ...(locRef.current ?? { lat: last.lat, lng: last.lng }),
            lat: last.lat,
            lng: last.lng,
            zoom: map.getZoom(),
            route: pts,
            routeLengthM: pts.length >= 2 ? Math.round(len * 10) / 10 : undefined,
            routeBearingDeg: bearing !== undefined ? Math.round(bearing * 10) / 10 : undefined,
          });
        };

        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) sync(pos.lat(), pos.lng(), { address: locRef.current?.address, route: locRef.current?.route });
        });

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          if (mode === "route" && routeDraw.current) {
            routePoints.current = [...routePoints.current, { lat: e.latLng.lat(), lng: e.latLng.lng() }];
            if (!routeRef.current) {
              routeRef.current = new g.maps.Polyline({
                map,
                path: routePoints.current,
                strokeColor: "#34d399",
                strokeWeight: 4,
                clickable: false,
              });
            } else {
              routeRef.current.setPath(routePoints.current);
            }
            refreshRoute();
            return;
          }
          if (mode === "area" && tracing) {
            ensurePolygon().getPath().push(e.latLng);
            return;
          }
          marker.setPosition(e.latLng);
          sync(e.latLng.lat(), e.latLng.lng(), { address: locRef.current?.address });
        });

        map.addListener("dblclick", () => {
          if (tracing) {
            setTracing(false);
            map.setOptions({ draggableCursor: undefined });
          }
          if (routeDraw.current) {
            routeDraw.current = false;
            setRouting(false);
            map.setOptions({ draggableCursor: undefined });
          }
        });

        if (searchEl.current) {
          const ac = new g.maps.places.Autocomplete(searchEl.current, { fields: ["geometry", "formatted_address", "name"] });
          ac.bindTo("bounds", map);
          ac.addListener("place_changed", () => {
            const place = ac.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            map.setCenter(loc);
            map.setZoom(mode === "route" ? 15 : 18);
            marker.setPosition(loc);
            sync(loc.lat(), loc.lng(), { address: place.formatted_address ?? place.name });
          });
        }

        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!location || !mapRef.current || !markerRef.current) return;
    const pos = { lat: location.lat, lng: location.lng };
    const current = markerRef.current.getPosition();
    if (!current || Math.abs(current.lat() - pos.lat) > 1e-9 || Math.abs(current.lng() - pos.lng) > 1e-9) {
      markerRef.current.setPosition(pos);
      mapRef.current.panTo(pos);
    }
  }, [location]);

  const startTracing = () => {
    polygonRef.current?.setMap(null);
    polygonRef.current = null;
    metricsRef.current = null;
    setMetrics(null);
    setTracing(true);
    mapRef.current?.setOptions({ draggableCursor: "crosshair" });
  };

  const stopTracing = () => {
    setTracing(false);
    mapRef.current?.setOptions({ draggableCursor: undefined });
  };

  const startRoute = () => {
    routePoints.current = [];
    routeRef.current?.setMap(null);
    routeRef.current = null;
    setRouteLength(null);
    routeDraw.current = true;
    setRouting(true);
    setTracing(false);
    mapRef.current?.setOptions({ draggableCursor: "crosshair" });
  };

  const stopRoute = () => {
    routeDraw.current = false;
    setRouting(false);
    mapRef.current?.setOptions({ draggableCursor: undefined });
  };

  const undoRoute = () => {
    if (routePoints.current.length === 0) return;
    routePoints.current = routePoints.current.slice(0, -1);
    routeRef.current?.setPath(routePoints.current);
    const pts = routePoints.current;
    setRouteLength(pts.length >= 2 ? polylineLengthM(pts) : null);
    if (locRef.current) onChange({ ...locRef.current, route: pts, routeLengthM: pts.length >= 2 ? Math.round(polylineLengthM(pts) * 10) / 10 : undefined });
  };

  const clearBoundary = () => {
    polygonRef.current?.setMap(null);
    polygonRef.current = null;
    metricsRef.current = null;
    setMetrics(null);
    stopTracing();
    if (location) {
      const { boundary, boundaryWidthM, boundaryDepthM, boundaryRotationDeg, ...rest } = location;
      void boundary;
      void boundaryWidthM;
      void boundaryDepthM;
      void boundaryRotationDeg;
      onChange(rest);
    }
  };

  const clearRoute = () => {
    routeRef.current?.setMap(null);
    routeRef.current = null;
    routePoints.current = [];
    setRouteLength(null);
    stopRoute();
    if (location) {
      const { route, routeLengthM, routeBearingDeg, ...rest } = location;
      void route;
      void routeLengthM;
      void routeBearingDeg;
      onChange(rest);
    }
  };

  const applyManual = () => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    onChange({ ...(location ?? {}), lat, lng });
  };

  const locateMe = () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      const next = { ...(location ?? {}), lat: pos.coords.latitude, lng: pos.coords.longitude };
      setManualLat(String(next.lat));
      setManualLng(String(next.lng));
      onChange(next);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Site location</p>
        <div className="flex-1" />
        {location && (
          <a
            href={googleEarthUrl(location.lat, location.lng)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            Open in Google Earth
          </a>
        )}
      </div>

      {status === "loading" && <p className="text-xs text-slate-500">Loading map…</p>}

      {status === "ready" && (
        <>
          <input
            ref={searchEl}
            placeholder="Search address, landmark or locality…"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
          />
          <div ref={mapEl} className="h-72 w-full overflow-hidden rounded-xl border border-slate-800" data-map="site" />

          {mode === "route" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={locateMe}>Use my location</Button>
              {routing ? (
                <Button size="sm" onClick={stopRoute}>Finish route</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={startRoute}>Draw route</Button>
              )}
              <Button size="sm" variant="secondary" onClick={undoRoute} disabled={!routeLength && routeLength !== 0}>Undo point</Button>
              <Button size="sm" variant="secondary" onClick={clearRoute} disabled={routeLength == null}>Clear route</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={locateMe}>Use my location</Button>
              {tracing ? (
                <Button size="sm" onClick={stopTracing}>Finish boundary</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={startTracing}>Draw boundary</Button>
              )}
              <Button size="sm" variant="secondary" onClick={clearBoundary} disabled={!metrics && !location?.boundary}>Clear boundary</Button>
              <Button size="sm" onClick={() => metrics && cbRef.current.onApplyBoundary?.(metrics)} disabled={!metrics}>
                Apply boundary as size
              </Button>
            </div>
          )}

          {mode === "route" && routing && (
            <p className="text-[11px] font-semibold text-emerald-400">Tap along the road to trace the alignment · double-click or “Finish route” to stop.</p>
          )}
          {mode === "area" && tracing && (
            <p className="text-[11px] font-semibold text-emerald-400">Tap the map to add boundary corners · double-click or “Finish boundary” to close.</p>
          )}

          {routeLength != null && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
              Route {routeLength < 1000 ? `${Math.round(routeLength)} m` : `${(routeLength / 1000).toFixed(2)} km`}
              {location?.routeBearingDeg !== undefined ? ` · bearing ${location.routeBearingDeg}°` : ""}
            </p>
          )}
          {metrics && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
              Boundary {metrics.widthM} × {metrics.depthM} m · {metrics.areaM2.toLocaleString()} m² · rotated {metrics.rotationDeg}°
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500">
            {mode === "route"
              ? "Search the corridor on the map, then trace the centreline — the route length and bearing drive the model."
              : "Drag the pin or tap the map to set the site centre, then trace the boundary — the size updates from the best-fit rectangle."}
          </p>
        </>
      )}

      {(status === "nokey" || status === "error") && (
        <div className="space-y-3">
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
            {status === "nokey"
              ? "Add VITE_GOOGLE_MAPS_KEY to client/.env.local to enable the satellite map, route and boundary tracing."
              : "The map could not be loaded (check the API key, billing and allowed referrers). Enter coordinates manually instead."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Latitude" value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="12.9716" />
            <Input label="Longitude" value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="77.5946" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={applyManual} disabled={!manualLat.trim() || !manualLng.trim()}>Set location</Button>
            <Button size="sm" variant="secondary" onClick={locateMe}>Use my location</Button>
          </div>
        </div>
      )}
    </div>
  );
}
