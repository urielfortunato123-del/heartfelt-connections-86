// Utilidades de geometria/rotação para o editor de projeto de pista.

export type LL = { lat: number; lng: number };

const R = 6371; // km

export function haversineKm(a: LL, b: LL): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Recebe polyline [lat,lng] e devolve distância total em km + array com soma acumulada por vértice. */
export function cumulativeKm(poly: [number, number][]): { total: number; cum: number[] } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
    const d = haversineKm(
      { lat: poly[i - 1][0], lng: poly[i - 1][1] },
      { lat: poly[i][0], lng: poly[i][1] },
    );
    total += d;
    cum.push(total);
  }
  return { total, cum };
}

/** Interpola um ponto a `targetKm` ao longo da polyline. */
export function pointAtKm(
  poly: [number, number][],
  cum: number[],
  targetKm: number,
): { lat: number; lng: number } | null {
  if (poly.length < 2) return null;
  if (targetKm <= 0) return { lat: poly[0][0], lng: poly[0][1] };
  if (targetKm >= cum[cum.length - 1]) {
    const last = poly[poly.length - 1];
    return { lat: last[0], lng: last[1] };
  }
  // busca binária
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= targetKm) lo = mid;
    else hi = mid;
  }
  const segKm = cum[hi] - cum[lo];
  const t = segKm === 0 ? 0 : (targetKm - cum[lo]) / segKm;
  return {
    lat: poly[lo][0] + t * (poly[hi][0] - poly[lo][0]),
    lng: poly[lo][1] + t * (poly[hi][1] - poly[lo][1]),
  };
}

/** Distribui marcadores a cada `stepKm` ao longo da polyline (0, step, 2*step, …, total). */
export function distributeKmMarkers(
  poly: [number, number][],
  stepKm: number,
): { km: number; lat: number; lng: number }[] {
  if (poly.length < 2 || stepKm <= 0) return [];
  const { total, cum } = cumulativeKm(poly);
  const out: { km: number; lat: number; lng: number }[] = [];
  for (let k = 0; k <= total + 1e-9; k += stepKm) {
    const p = pointAtKm(poly, cum, k);
    if (p) out.push({ km: Math.round(k * 1000) / 1000, ...p });
  }
  return out;
}

/** Chama OSRM público; retorna polyline [lat,lng] e distância em km. */
export async function fetchOsrmRoute(
  start: LL,
  end: LL,
): Promise<{ polyline: [number, number][]; distanceKm: number }> {
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM falhou: ${res.status}`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new Error("Nenhuma rota encontrada");
  const coords: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng],
  );
  return { polyline: coords, distanceKm: route.distance / 1000 };
}

/** Encontra o km mais próximo de uma lat/lng em relação à polyline. */
export function nearestKm(
  poly: [number, number][],
  cum: number[],
  pt: LL,
): number {
  if (poly.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = haversineKm({ lat: poly[i][0], lng: poly[i][1] }, pt);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return cum[bestIdx];
}
