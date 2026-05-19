import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Popup,
  Tooltip,
  LayersControl,
  useMap,
  useMapEvents,
} from "react-leaflet";

const { BaseLayer, Overlay } = LayersControl;


// Fix de ícone padrão do Leaflet (caminhos quebrados via bundler)
if (typeof window !== "undefined") {
  const defaultIcon = L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
  L.Marker.prototype.options.icon = defaultIcon;
}

export type LatLng = { lat: number; lng: number };
export type KmMarker = { km: number; lat: number; lng: number };
export type ManualPoint = { id: string; km: number; lat: number; lng: number; label: string };

type Mode = "start" | "end" | "manual";

type Props = {
  start: LatLng | null;
  end: LatLng | null;
  polyline: [number, number][]; // [lat,lng] pairs
  kmMarkers: KmMarker[];
  manualPoints: ManualPoint[];
  mode: Mode;
  onClick: (latlng: LatLng) => void;
  onUpdatePoint?: (id: string, patch: Partial<Pick<ManualPoint, "km" | "label">>) => void;
  onRemovePoint?: (id: string) => void;
  onMovePoint?: (id: string, latlng: LatLng) => void;
  onMovePointEnd?: (id: string) => void;
  onReady?: () => void;
  /** Geometrias da rodovia destacada (cada way = uma polyline [lat,lng]). */
  highlightedRoad?: [number, number][][];
  /** bbox a enquadrar imperativamente (incrementa a cada nova busca). */
  fitBbox?: { south: number; west: number; north: number; east: number; key: number } | null;
  /** Overlays importados (DXF/TXT) sobre o mapa. */
  overlays?: Array<{
    id: string;
    polylines: [number, number][][];
    points: Array<{ lat: number; lng: number; label?: string }>;
    offset?: { dx: number; dy: number };
  }>;
  /** Id do overlay que o usuário está arrastando (modo posicionar). */
  draggingOverlayId?: string | null;
  /** Recebe arrasto em graus (relativo). */
  onOverlayDrag?: (id: string, deltaLat: number, deltaLng: number) => void;
};

function ReadySignal({ onReady }: { onReady?: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onReady) return;
    let fired = false;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const fire = () => {
      if (fired || cancelled) return;
      fired = true;
      // aguarda dois frames para garantir layout/tiles, sem disparar se desmontou.
      raf1 = requestAnimationFrame(() => {
        if (cancelled) return;
        raf2 = requestAnimationFrame(() => {
          if (cancelled) return;
          onReady();
        });
      });
    };
    map.whenReady(fire);
    // fallback: se whenReady atrasar, dispara em até 1500ms
    const t = setTimeout(fire, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [map, onReady]);
  return null;
}


function ClickCatcher({ onClick }: { onClick: (l: LatLng) => void }) {
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useMapEvents({
    click(e) {
      if (!mountedRef.current) return;
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FitBoundsOnChange({
  bbox,
  onApplied,
}: {
  bbox: Props["fitBbox"];
  onApplied?: () => void;
}) {
  const map = useMap();
  const lastKey = useRef<number | null>(null);
  useEffect(() => {
    if (!bbox) return;
    if (lastKey.current === bbox.key) return;
    lastKey.current = bbox.key;
    const bounds = L.latLngBounds(
      L.latLng(bbox.south, bbox.west),
      L.latLng(bbox.north, bbox.east),
    );
    map.fitBounds(bounds, { padding: [40, 40] });
    onApplied?.();
  }, [map, bbox, onApplied]);
  return null;
}

export default function RouteMap({
  start,
  end,
  polyline,
  kmMarkers,
  manualPoints,
  mode,
  onClick,
  onUpdatePoint,
  onRemovePoint,
  onMovePoint,
  onMovePointEnd,
  onReady,
  highlightedRoad,
  fitBbox,
  overlays,
  draggingOverlayId,
  onOverlayDrag,
}: Props) {

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const VIEW_KEY = "pista.mapView.v1";
  const polylineSignatureRef = useRef<string>("");
  const userInteractedRef = useRef<boolean>(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Wrappers que ignoram chamadas tardias do Leaflet após desmontar.
  const safeOnClick = useCallback(
    (ll: LatLng) => {
      if (!mountedRef.current) return;
      onClick(ll);
    },
    [onClick],
  );
  const safeOnReady = useCallback(() => {
    if (!mountedRef.current) return;
    onReady?.();
  }, [onReady]);
  const safeOnMovePoint = useCallback(
    (id: string, ll: LatLng) => {
      if (!mountedRef.current) return;
      onMovePoint?.(id, ll);
    },
    [onMovePoint],
  );
  const safeOnMovePointEnd = useCallback(
    (id: string) => {
      if (!mountedRef.current) return;
      onMovePointEnd?.(id);
    },
    [onMovePointEnd],
  );

  // Restaura view persistida (ou usa start/default) — só leitura inicial, não muda em re-render.
  const initialView = useMemo<{ center: [number, number]; zoom: number }>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(VIEW_KEY);
        if (raw) {
          const v = JSON.parse(raw) as { lat: number; lng: number; zoom: number };
          if (Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom)) {
            userInteractedRef.current = true; // respeita view persistida, não força fitBounds
            return { center: [v.lat, v.lng], zoom: v.zoom };
          }
        }
      } catch { /* ignore */ }
    }
    if (start) return { center: [start.lat, start.lng], zoom: 11 };
    return { center: [-22.0154, -47.8911], zoom: 11 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit bounds APENAS quando a rota muda de identidade (novos endpoints), respeitando interação do usuário.
  useEffect(() => {
    if (!mapRef.current || polyline.length < 2) return;
    const sig = `${polyline[0]?.join(",")}|${polyline[polyline.length - 1]?.join(",")}|${polyline.length}`;
    if (sig === polylineSignatureRef.current) return;
    polylineSignatureRef.current = sig;
    if (userInteractedRef.current) return; // usuário já moveu o mapa — não realinha
    const bounds = L.latLngBounds(polyline.map(([a, b]) => L.latLng(a, b)));
    mapRef.current.fitBounds(bounds, { padding: [30, 30] });
  }, [polyline]);

  // Persiste center/zoom em cada moveend/zoomend e marca interação manual.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const save = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      try {
        window.localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: z }));
      } catch { /* ignore */ }
    };
    const markInteracted = () => { userInteractedRef.current = true; };
    map.on("moveend", save);
    map.on("zoomend", save);
    map.on("dragstart", markInteracted);
    map.on("zoomstart", markInteracted);
    return () => {
      map.off("moveend", save);
      map.off("zoomend", save);
      map.off("dragstart", markInteracted);
      map.off("zoomstart", markInteracted);
    };
  }, []);

  // Cleanup final: remove a instância do Leaflet ao desmontar para liberar
  // listeners de tiles/eventos e evitar callbacks tardios em estado já desmontado.
  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        map.off();
        map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
  }, []);

  // Fullscreen: sincroniza estado com a Fullscreen API e ajusta o tamanho do mapa.
  useEffect(() => {
    const onFsChange = () => {
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      // Após transição, recalcula tiles para preencher a nova área.
      setTimeout(() => mapRef.current?.invalidateSize(), 200);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? "relative h-screen w-screen bg-slate-950"
          : "relative h-[480px] w-full overflow-hidden rounded-lg border border-white/10"
      }
    >
      <div className="absolute left-2 top-2 z-[400] rounded bg-black/70 px-3 py-1 text-xs text-white">
        Modo:{" "}
        <span className="font-bold text-cyan-300">
          {mode === "start" ? "Clique para marcar INÍCIO" : mode === "end" ? "Clique para marcar FIM" : "Clique para adicionar PONTO"}
        </span>
      </div>
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-2 top-2 z-[400] rounded bg-black/70 px-3 py-1 text-xs font-medium text-white hover:bg-black/90"
        title={isFullscreen ? "Sair de tela cheia" : "Tela cheia"}
      >
        {isFullscreen ? "↙ Sair" : "⛶ Tela cheia"}
      </button>
      <MapContainer
        ref={(m) => {
          mapRef.current = m as unknown as L.Map | null;
        }}
        center={initialView.center}
        zoom={initialView.zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <LayersControl position="topright" collapsed>
          <BaseLayer checked name="Padrão (OSM)">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </BaseLayer>
          <BaseLayer name="Satélite">
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </BaseLayer>
          <BaseLayer name="Híbrido">
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </BaseLayer>
          <BaseLayer name="Topográfico">
            <TileLayer
              attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              maxZoom={17}
            />
          </BaseLayer>
          <Overlay name="Rótulos (sobre Satélite/Híbrido)">
            <TileLayer
              attribution="Labels &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </Overlay>
          <Overlay name="Transporte (ferrovias/transit)">
            <TileLayer
              attribution='&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
              url="https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
              maxZoom={19}
              opacity={0.85}
            />
          </Overlay>
          <Overlay name="Trânsito (relativo, OSM)">
            <TileLayer
              attribution="OpenStreetMap"
              url="https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png"
              maxZoom={18}
              opacity={0.6}
            />
          </Overlay>
        </LayersControl>

        <ClickCatcher onClick={safeOnClick} />
        <ReadySignal onReady={safeOnReady} />
        <FitBoundsOnChange bbox={fitBbox ?? null} />

        {/* Rodovia destacada (resultado da busca) — amarelo translúcido por baixo do traçado roxo. */}
        {highlightedRoad?.map((way, i) => (
          <Polyline
            key={`hl-${i}`}
            positions={way}
            pathOptions={{ color: "#facc15", weight: 6, opacity: 0.55 }}
          />
        ))}

        {/* Overlays importados (DXF/TXT) */}
        {overlays?.map((ov) => {
          const dx = ov.offset?.dx ?? 0;
          const dy = ov.offset?.dy ?? 0;
          const shift = (p: [number, number]): [number, number] => [p[0] + dy, p[1] + dx];
          return (
            <div key={ov.id} style={{ display: "contents" }}>
              {ov.polylines.map((pl, i) => (
                <Polyline
                  key={`${ov.id}-pl-${i}`}
                  positions={pl.map(shift)}
                  pathOptions={{
                    color: draggingOverlayId === ov.id ? "#f97316" : "#34d399",
                    weight: 2.5,
                    opacity: 0.9,
                  }}
                />
              ))}
              {ov.points.map((p, i) => (
                <CircleMarker
                  key={`${ov.id}-pt-${i}`}
                  center={[p.lat + dy, p.lng + dx]}
                  radius={3}
                  pathOptions={{
                    color: "#34d399",
                    fillColor: "#34d399",
                    fillOpacity: 0.95,
                  }}
                >
                  {p.label && <Tooltip direction="top">{p.label}</Tooltip>}
                </CircleMarker>
              ))}
            </div>
          );
        })}

        {/* Captura arrasto no mapa quando um overlay está em modo posicionar. */}
        {draggingOverlayId && onOverlayDrag && (
          <OverlayDragHandler id={draggingOverlayId} onDrag={onOverlayDrag} />
        )}




        {start && (
          <Marker position={[start.lat, start.lng]}>
            <Tooltip permanent direction="top">Início (km 0)</Tooltip>
          </Marker>
        )}
        {end && (
          <Marker position={[end.lat, end.lng]}>
            <Tooltip permanent direction="top">Fim</Tooltip>
          </Marker>
        )}

        {polyline.length > 1 && (
          <Polyline positions={polyline} pathOptions={{ color: "#a855f7", weight: 4 }} />
        )}

        {kmMarkers.map((m) => (
          <CircleMarker
            key={`km-${m.km}`}
            center={[m.lat, m.lng]}
            radius={5}
            pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.9 }}
          >
            <Tooltip direction="top">km {m.km}</Tooltip>
          </CircleMarker>
        ))}

        {manualPoints.map((p) => {
          let markerRef: L.Marker | null = null;
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              draggable={Boolean(onMovePoint)}
              ref={(m) => {
                markerRef = m as unknown as L.Marker | null;
              }}
              eventHandlers={
                onMovePoint
                  ? {
                      drag: (e) => {
                        const ll = (e.target as L.Marker).getLatLng();
                        safeOnMovePoint(p.id, { lat: ll.lat, lng: ll.lng });
                      },
                      dragend: (e) => {
                        const ll = (e.target as L.Marker).getLatLng();
                        safeOnMovePoint(p.id, { lat: ll.lat, lng: ll.lng });
                        safeOnMovePointEnd(p.id);
                      },
                    }
                  : undefined
              }
            >
              <Tooltip direction="top" offset={[0, -30]} permanent interactive opacity={0.95}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span>
                    {p.label || "ponto"} (~km {p.km.toFixed(3)})
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      markerRef?.openPopup();
                    }}
                    style={{
                      background: "#0ea5e9",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Editar
                  </button>
                </div>
              </Tooltip>
            <Popup>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
                <label style={{ fontSize: 11, color: "#475569" }}>Descrição</label>
                <input
                  defaultValue={p.label}
                  onBlur={(e) => onUpdatePoint?.(p.id, { label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    padding: "4px 6px",
                    fontSize: 13,
                  }}
                />
                <label style={{ fontSize: 11, color: "#475569" }}>Km</label>
                <input
                  type="number"
                  step="0.001"
                  defaultValue={Number(p.km.toFixed(3))}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) onUpdatePoint?.(p.id, { km: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    padding: "4px 6px",
                    fontSize: 13,
                  }}
                />
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Dica: arraste o pino para reposicionar.
                </div>
                <button
                  type="button"
                  onClick={() => onRemovePoint?.(p.id)}
                  style={{
                    marginTop: 4,
                    background: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    padding: "6px 8px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Remover ponto
                </button>
              </div>
            </Popup>
          </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

