import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Popup,
  Tooltip,
  useMapEvents,
} from "react-leaflet";


// Fix de ícone padrão do Leaflet (caminhos quebrados via bundler)
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
};


function ClickCatcher({ onClick }: { onClick: (l: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
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
}: Props) {

  const mapRef = useRef<L.Map | null>(null);
  const center = useMemo<[number, number]>(() => {
    if (start) return [start.lat, start.lng];
    return [-22.0154, -47.8911]; // SP central default
  }, [start]);

  useEffect(() => {
    if (!mapRef.current || polyline.length < 2) return;
    const bounds = L.latLngBounds(polyline.map(([a, b]) => L.latLng(a, b)));
    mapRef.current.fitBounds(bounds, { padding: [30, 30] });
  }, [polyline]);

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-lg border border-white/10">
      <div className="absolute left-2 top-2 z-[400] rounded bg-black/70 px-3 py-1 text-xs text-white">
        Modo:{" "}
        <span className="font-bold text-cyan-300">
          {mode === "start" ? "Clique para marcar INÍCIO" : mode === "end" ? "Clique para marcar FIM" : "Clique para adicionar PONTO"}
        </span>
      </div>
      <MapContainer
        ref={(m) => {
          mapRef.current = m as unknown as L.Map | null;
        }}
        center={center}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickCatcher onClick={onClick} />

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

        {manualPoints.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            draggable={Boolean(onMovePoint)}
            eventHandlers={
              onMovePoint
                ? {
                    drag: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePoint(p.id, { lat: ll.lat, lng: ll.lng });
                    },
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePoint(p.id, { lat: ll.lat, lng: ll.lng });
                    },
                  }
                : undefined
            }
          >
            <Tooltip direction="top" offset={[0, -30]}>
              {p.label || "ponto"} (~km {p.km.toFixed(3)})
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
        ))}
      </MapContainer>
    </div>
  );
}

