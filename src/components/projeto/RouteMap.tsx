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
  /** Sub-chave para persistir center/zoom por projeto/contexto. */
  viewKey?: string;
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


function OverlayDragHandler({
  id,
  onDrag,
}: {
  id: string;
  onDrag: (id: string, deltaLat: number, deltaLng: number) => void;
}) {
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  useMapEvents({
    mousedown(e) {
      lastRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
    },
    mousemove(e) {
      if (!lastRef.current) return;
      const dLat = e.latlng.lat - lastRef.current.lat;
      const dLng = e.latlng.lng - lastRef.current.lng;
      lastRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
      onDrag(id, dLat, dLng);
    },
    mouseup() {
      lastRef.current = null;
    },
  });
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
  viewKey,
}: Props) {

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const VIEW_KEY_BASE = "pista.mapView.v1";
  const storageKey = `${VIEW_KEY_BASE}:${viewKey ?? "default"}`;
  const storageKeyRef = useRef(storageKey);
  const polylineSignatureRef = useRef<string>("");
  const userInteractedRef = useRef<boolean>(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mantém SEMPRE a última versão dos handlers em refs. Isso permite que os
  // wrappers `safeOn*` sejam estáveis (sem dependências), evitando re-render
  // do MapContainer e duplicação de listeners do Leaflet ao trocar de rota
  // ou quando o pai redefine inline as funções a cada render.
  const handlersRef = useRef({ onClick, onReady, onMovePoint, onMovePointEnd });
  useEffect(() => {
    handlersRef.current = { onClick, onReady, onMovePoint, onMovePointEnd };
  }, [onClick, onReady, onMovePoint, onMovePointEnd]);

  const safeOnClick = useCallback((ll: LatLng) => {
    if (!mountedRef.current) return;
    handlersRef.current.onClick(ll);
  }, []);
  const safeOnReady = useCallback(() => {
    if (!mountedRef.current) return;
    handlersRef.current.onReady?.();
  }, []);
  const safeOnMovePoint = useCallback((id: string, ll: LatLng) => {
    if (!mountedRef.current) return;
    handlersRef.current.onMovePoint?.(id, ll);
  }, []);
  const safeOnMovePointEnd = useCallback((id: string) => {
    if (!mountedRef.current) return;
    handlersRef.current.onMovePointEnd?.(id);
  }, []);

  // Restaura view persistida (ou usa start/default) — só leitura inicial, não muda em re-render.
  type SavedView = {
    lat: number;
    lng: number;
    zoom: number;
    baseLayer?: string;
    overlays?: string[];
  };

  // Restaura view persistida (ou usa start/default) — só leitura inicial, não muda em re-render.
  // Inclui também as configurações visuais (camada base ativa + overlays habilitados),
  // que só podem ser honradas via `checked` no mount do LayersControl.
  const initialSaved = useMemo<SavedView | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const currentKey = storageKeyRef.current;
      const LEGACY_KEY = "pista.mapView.v1";
      if (currentKey !== LEGACY_KEY) {
        const legacy = window.localStorage.getItem(LEGACY_KEY);
        const existing = window.localStorage.getItem(currentKey);
        if (legacy && !existing) window.localStorage.setItem(currentKey, legacy);
        if (legacy) window.localStorage.removeItem(LEGACY_KEY);
      }
      const raw = window.localStorage.getItem(currentKey);
      if (!raw) return null;
      const v = JSON.parse(raw) as SavedView;
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || !Number.isFinite(v.zoom)) return null;
      return v;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialView = useMemo<{ center: [number, number]; zoom: number }>(() => {
    if (initialSaved) {
      userInteractedRef.current = true; // respeita view persistida, não força fitBounds
      return { center: [initialSaved.lat, initialSaved.lng], zoom: initialSaved.zoom };
    }
    if (start) return { center: [start.lat, start.lng], zoom: 11 };
    return { center: [-22.0154, -47.8911], zoom: 11 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSaved]);

  // Default e estado inicial dos visuais (apenas no primeiro mount).
  const DEFAULT_BASE = "Padrão (OSM)";
  const initialBaseLayer = initialSaved?.baseLayer ?? DEFAULT_BASE;
  const initialOverlaysSet = useMemo(
    () => new Set(initialSaved?.overlays ?? []),
    [initialSaved],
  );
  // Estado em ref para que o save debounced sempre leia o valor mais recente.
  const visualsRef = useRef<{ baseLayer: string; overlays: Set<string> }>({
    baseLayer: initialBaseLayer,
    overlays: new Set(initialOverlaysSet),
  });

  // Registry das instâncias L.TileLayer por nome — permite alternar camadas
  // imperativamente quando o viewKey muda (sem remount do MapContainer).
  const BASE_NAMES = ["Padrão (OSM)", "Satélite", "Híbrido", "Topográfico"] as const;
  const OVERLAY_NAMES = [
    "Rótulos (sobre Satélite/Híbrido)",
    "Transporte (ferrovias/transit)",
    "Trânsito (relativo, OSM)",
  ] as const;
  const tileLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const registerTile = useCallback(
    (name: string) => (layer: L.Layer | null) => {
      if (layer) tileLayersRef.current.set(name, layer);
    },
    [],
  );
  const syncVisuals = useCallback((baseLayer: string | undefined, overlays: string[] | undefined) => {
    const map = mapRef.current;
    if (!map) return;
    const tiles = tileLayersRef.current;
    const targetBase = baseLayer && (BASE_NAMES as readonly string[]).includes(baseLayer)
      ? baseLayer
      : "Padrão (OSM)";
    if (targetBase !== visualsRef.current.baseLayer) {
      for (const n of BASE_NAMES) {
        const l = tiles.get(n);
        if (!l) continue;
        const has = map.hasLayer(l);
        if (n === targetBase && !has) map.addLayer(l);
        else if (n !== targetBase && has) map.removeLayer(l);
      }
      visualsRef.current.baseLayer = targetBase;
    }
    const targetOverlays = new Set(overlays ?? []);
    for (const n of OVERLAY_NAMES) {
      const l = tiles.get(n);
      if (!l) continue;
      const want = targetOverlays.has(n);
      const has = map.hasLayer(l);
      if (want && !has) map.addLayer(l);
      else if (!want && has) map.removeLayer(l);
    }
    visualsRef.current.overlays = targetOverlays;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reenquadramento inteligente:
  // - só refaz fitBounds quando o usuário não interagiu;
  // - só refaz quando a polyline muda de forma RELEVANTE (bbox arredondado a ~0.0005°
  //   ≈ 50m, ou contagem com salto > 10%), evitando refits por jitter numérico;
  // - quando não há polyline, garante que o mapa fique visível usando, em ordem,
  //   start+end → start → rodovia destacada → bbox externo → centro default.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userInteractedRef.current) return;

    // Caso vazio: ainda assim, garante que algo esteja visível.
    if (polyline.length < 2) {
      const fallbackSig = (() => {
        if (start && end) return `se|${start.lat.toFixed(4)},${start.lng.toFixed(4)}|${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
        if (start) return `s|${start.lat.toFixed(4)},${start.lng.toFixed(4)}`;
        if (highlightedRoad?.length) return `hl|${highlightedRoad.length}|${highlightedRoad[0]?.length ?? 0}`;
        return "";
      })();
      if (!fallbackSig || fallbackSig === polylineSignatureRef.current) return;
      polylineSignatureRef.current = fallbackSig;
      if (start && end) {
        map.fitBounds(L.latLngBounds([[start.lat, start.lng], [end.lat, end.lng]]), { padding: [40, 40], animate: false });
      } else if (start) {
        map.setView([start.lat, start.lng], Math.max(map.getZoom(), 12), { animate: false });
      } else if (highlightedRoad?.length) {
        const pts = highlightedRoad.flat();
        if (pts.length) map.fitBounds(L.latLngBounds(pts as L.LatLngTuple[]), { padding: [40, 40], animate: false });
      }
      return;
    }

    // bbox arredondado para 4 casas (~10m) e contagem em bucket de 10%
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [a, b] of polyline) {
      if (a < minLat) minLat = a;
      if (a > maxLat) maxLat = a;
      if (b < minLng) minLng = b;
      if (b > maxLng) maxLng = b;
    }
    const r = (n: number) => Math.round(n / 0.0005) * 0.0005;
    const countBucket = Math.round(polyline.length / Math.max(1, polyline.length * 0.1));
    const sig = `${r(minLat)},${r(minLng)}|${r(maxLat)},${r(maxLng)}|${countBucket}`;
    if (sig === polylineSignatureRef.current) return;
    polylineSignatureRef.current = sig;
    map.fitBounds(L.latLngBounds([[minLat, minLng], [maxLat, maxLng]]), { padding: [30, 30], animate: false });
  }, [polyline, start, end, highlightedRoad]);

  // Persiste center/zoom em moveend/zoomend, mas com debounce (250ms) + dedup
  // para evitar escrita excessiva ao arrastar/zoom contínuo. Flush ao desmontar
  // e ao esconder a aba, garantindo que o último estado nunca se perca.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSerialized = "";
    const flush = () => {
      timer = null;
      const c = map.getCenter();
      const z = map.getZoom();
      const payload = JSON.stringify({
        lat: c.lat,
        lng: c.lng,
        zoom: z,
        baseLayer: visualsRef.current.baseLayer,
        overlays: [...visualsRef.current.overlays],
      });
      if (payload === lastSerialized) return;
      lastSerialized = payload;
      try {
        window.localStorage.setItem(storageKeyRef.current, payload);
      } catch { /* ignore */ }
    };
    const scheduleSave = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 250);
    };
    const flushNow = () => {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    const markInteracted = () => { userInteractedRef.current = true; };
    const onBaseChange = (e: L.LayersControlEvent) => {
      visualsRef.current.baseLayer = e.name;
      scheduleSave();
    };
    const onOverlayAdd = (e: L.LayersControlEvent) => {
      visualsRef.current.overlays.add(e.name);
      scheduleSave();
    };
    const onOverlayRemove = (e: L.LayersControlEvent) => {
      visualsRef.current.overlays.delete(e.name);
      scheduleSave();
    };
    map.on("moveend", scheduleSave);
    map.on("zoomend", scheduleSave);
    map.on("dragstart", markInteracted);
    map.on("zoomstart", markInteracted);
    map.on("baselayerchange", onBaseChange);
    map.on("overlayadd", onOverlayAdd);
    map.on("overlayremove", onOverlayRemove);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      map.off("moveend", scheduleSave);
      map.off("zoomend", scheduleSave);
      map.off("dragstart", markInteracted);
      map.off("zoomstart", markInteracted);
      map.off("baselayerchange", onBaseChange);
      map.off("overlayadd", onOverlayAdd);
      map.off("overlayremove", onOverlayRemove);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      flushNow();
    };
  }, []);

  // Aplica a view persistida da chave atual; se não houver, faz fitBounds/default.
  // Usa animate:false para evitar flicker visual ao rehidratar.
  const applySavedView = useCallback(
    (key: string) => {
      const map = mapRef.current;
      if (!map) return;
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const v = JSON.parse(raw) as { lat: number; lng: number; zoom: number };
          if (Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom)) {
            const c = map.getCenter();
            const z = map.getZoom();
            if (Math.abs(c.lat - v.lat) > 1e-7 || Math.abs(c.lng - v.lng) > 1e-7 || z !== v.zoom) {
              map.setView([v.lat, v.lng], v.zoom, { animate: false });
            }
            userInteractedRef.current = true;
            map.invalidateSize({ animate: false });
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    },
    [],
  );

  // Quando a chave de contexto muda (projeto/filtros diferentes), troca a sub-chave
  // de persistência e reaplica a view salva para esse contexto (ou refaz fitBounds).
  useEffect(() => {
    if (storageKeyRef.current === storageKey) return;
    storageKeyRef.current = storageKey;
    const map = mapRef.current;
    if (!map) return;
    // Sincroniza camada base + overlays a partir do que foi salvo p/ esse contexto.
    let saved: SavedView | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw) as SavedView;
    } catch { /* ignore */ }
    syncVisuals(saved?.baseLayer, saved?.overlays);
    const applied = applySavedView(storageKey);
    if (!applied) {
      userInteractedRef.current = false;
      polylineSignatureRef.current = "";
      if (polyline.length > 1) {
        const bounds = L.latLngBounds(polyline.map(([a, b]) => L.latLng(a, b)));
        map.fitBounds(bounds, { padding: [30, 30], animate: false });
      } else if (start) {
        map.setView([start.lat, start.lng], 11, { animate: false });
      }
    }
  }, [storageKey, polyline, start, applySavedView, syncVisuals]);

  // Retorno da aba/janela: reaplica a última view salva e revalida tiles sem flicker.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      applySavedView(storageKeyRef.current);
    };
    const onFocus = () => applySavedView(storageKeyRef.current);
    const onPageShow = () => applySavedView(storageKeyRef.current);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [applySavedView]);

  // Cleanup final: remove a instância do Leaflet ao desmontar para liberar
  // listeners de tiles/eventos e evitar callbacks tardios em estado já desmontado.
  // Guardamos um flag de teardown para detectar (em dev) chamadas duplicadas — o
  // StrictMode dispara o efeito 2x, e queremos garantir que map.off()/map.remove()
  // rodem exatamente uma vez por instância de mapa.
  const teardownDoneRef = useRef(false);
  useEffect(() => {
    teardownDoneRef.current = false;
    return () => {
      const isDev = typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
      const map = mapRef.current;
      if (teardownDoneRef.current) {
        if (isDev) console.warn("[RouteMap] cleanup chamado mais de uma vez — ignorando.");
        return;
      }
      if (!map) {
        if (isDev) console.debug("[RouteMap] cleanup: mapRef já estava nulo, nada a fazer.");
        teardownDoneRef.current = true;
        return;
      }
      try {
        map.off();
        map.remove();
        if (isDev) console.debug("[RouteMap] cleanup OK: map.off() + map.remove() executados.");
      } catch (err) {
        if (isDev) console.error("[RouteMap] cleanup falhou:", err);
      } finally {
        mapRef.current = null;
        teardownDoneRef.current = true;
        if (isDev && mapRef.current !== null) {
          console.error("[RouteMap] mapRef não foi limpo após cleanup!");
        }
      }
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

  const resetView = useCallback(() => {
    const map = mapRef.current;
    try {
      window.localStorage.removeItem(storageKeyRef.current);
    } catch {
      /* ignore */
    }
    userInteractedRef.current = false;
    polylineSignatureRef.current = "";
    if (!map) return;
    if (polyline.length > 1) {
      const bounds = L.latLngBounds(polyline.map(([a, b]) => L.latLng(a, b)));
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (start) {
      map.setView([start.lat, start.lng], 11);
    } else {
      map.setView([-22.0154, -47.8911], 11);
    }
  }, [polyline, start]);

  // Em modo "arrastar overlay", desliga o pan do mapa para que o mouse mova só o overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (draggingOverlayId) {
      map.dragging.disable();
      map.getContainer().style.cursor = "grabbing";
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    }
  }, [draggingOverlayId]);


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
      <div className="absolute right-2 top-2 z-[400] flex gap-2">
        <button
          type="button"
          onClick={resetView}
          className="rounded bg-black/70 px-3 py-1 text-xs font-medium text-white hover:bg-black/90"
          title="Redefinir zoom e centro do mapa (limpa persistência)"
        >
          ⟳ Redefinir vista
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded bg-black/70 px-3 py-1 text-xs font-medium text-white hover:bg-black/90"
          title={isFullscreen ? "Sair de tela cheia" : "Tela cheia"}
        >
          {isFullscreen ? "↙ Sair" : "⛶ Tela cheia"}
        </button>
      </div>
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
          <BaseLayer checked={initialBaseLayer === "Padrão (OSM)"} name="Padrão (OSM)">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </BaseLayer>
          <BaseLayer checked={initialBaseLayer === "Satélite"} name="Satélite">
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </BaseLayer>
          <BaseLayer checked={initialBaseLayer === "Híbrido"} name="Híbrido">
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </BaseLayer>
          <BaseLayer checked={initialBaseLayer === "Topográfico"} name="Topográfico">
            <TileLayer
              attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              maxZoom={17}
            />
          </BaseLayer>
          <Overlay checked={initialOverlaysSet.has("Rótulos (sobre Satélite/Híbrido)")} name="Rótulos (sobre Satélite/Híbrido)">
            <TileLayer
              attribution="Labels &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </Overlay>
          <Overlay checked={initialOverlaysSet.has("Transporte (ferrovias/transit)")} name="Transporte (ferrovias/transit)">
            <TileLayer
              attribution='&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
              url="https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
              maxZoom={19}
              opacity={0.85}
            />
          </Overlay>
          <Overlay checked={initialOverlaysSet.has("Trânsito (relativo, OSM)")} name="Trânsito (relativo, OSM)">
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

