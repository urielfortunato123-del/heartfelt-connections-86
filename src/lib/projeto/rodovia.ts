// Busca uma rodovia por "ref" (ex: SP-261, BR-116) na OpenStreetMap via Overpass API,
// retornando todas as geometrias (ways) e uma polyline única "costurada" pela proximidade
// de extremos, pronta para cálculo de km.

import { haversineKm, type LL } from "./geo";

export type RodoviaResult = {
  ref: string;
  ways: [number, number][][]; // cada way em [lat,lng]
  stitched: [number, number][]; // união ordenada de todas as ways
  bbox: { south: number; west: number; north: number; east: number };
  totalKm: number;
};

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function normalizeRef(input: string): string {
  // "sp 261", "sp261", "SP-261" → "SP-261"
  const m = input.trim().toUpperCase().match(/^([A-Z]{2,3})[\s-]?0*(\d{1,4})([A-Z]?)$/);
  if (!m) return input.trim().toUpperCase();
  return `${m[1]}-${m[2]}${m[3]}`;
}

function buildQuery(ref: string): string {
  // Aceita o ref normalizado e variações sem hífen / com zeros à esquerda.
  const alt = ref.replace("-", "");
  // Restringe a busca ao território brasileiro — sem isso a Overpass roda out-of-memory
  // ao varrer todas as rodovias do mundo só pelo ref.
  return `[out:json][timeout:60];
area["ISO3166-1"="BR"][admin_level=2]->.br;
(
  way["highway"]["ref"~"(^|;)${ref}($|;)"](area.br);
  way["highway"]["ref"~"(^|;)${alt}($|;)"](area.br);
);
out geom;`;
}


async function fetchOverpass(query: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${url} ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass falhou em todos os mirrors");
}

/** Stitching greedy: começa pela way mais longa e vai anexando a próxima cujo extremo
 *  mais próximo está mais perto do extremo atual, invertendo quando necessário. */
function stitchWays(ways: [number, number][][]): [number, number][] {
  if (ways.length === 0) return [];
  const remaining = ways.map((w) => w.slice());
  // começa pela mais longa
  remaining.sort((a, b) => b.length - a.length);
  const result = remaining.shift()!;

  while (remaining.length > 0) {
    const headPt = result[0];
    const tailPt = result[result.length - 1];

    let bestIdx = -1;
    let bestDist = Infinity;
    let attachAt: "head" | "tail" = "tail";
    let reverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      const wHead = w[0];
      const wTail = w[w.length - 1];
      const candidates: { d: number; at: "head" | "tail"; rev: boolean }[] = [
        { d: distPts(tailPt, wHead), at: "tail", rev: false },
        { d: distPts(tailPt, wTail), at: "tail", rev: true },
        { d: distPts(headPt, wTail), at: "head", rev: false },
        { d: distPts(headPt, wHead), at: "head", rev: true },
      ];
      for (const c of candidates) {
        if (c.d < bestDist) {
          bestDist = c.d;
          bestIdx = i;
          attachAt = c.at;
          reverse = c.rev;
        }
      }
    }

    // se o próximo trecho está absurdamente longe (>5 km), pare — provavelmente é um ramal solto
    if (bestIdx < 0 || bestDist > 5) break;

    const seg = remaining.splice(bestIdx, 1)[0];
    const ordered = reverse ? seg.slice().reverse() : seg;
    if (attachAt === "tail") {
      // evita duplicar vértice de junção
      if (distPts(result[result.length - 1], ordered[0]) < 0.01) ordered.shift();
      result.push(...ordered);
    } else {
      if (distPts(result[0], ordered[ordered.length - 1]) < 0.01) ordered.pop();
      result.unshift(...ordered);
    }
  }
  return result;
}

function distPts(a: [number, number], b: [number, number]): number {
  return haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
}

function totalKmOf(poly: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < poly.length; i++) {
    s += distPts(poly[i - 1], poly[i]);
  }
  return s;
}

export async function searchRodoviaByRef(input: string): Promise<RodoviaResult> {
  const ref = normalizeRef(input);
  const query = buildQuery(ref);
  const data = (await fetchOverpass(query)) as {
    elements?: Array<{
      type: string;
      geometry?: Array<{ lat: number; lon: number }>;
    }>;
  };
  const ways: [number, number][][] = [];
  for (const el of data.elements || []) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    ways.push(el.geometry.map((p) => [p.lat, p.lon] as [number, number]));
  }
  if (ways.length === 0) {
    throw new Error(`Rodovia "${ref}" não encontrada no OpenStreetMap.`);
  }
  const stitched = stitchWays(ways);
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const w of ways) {
    for (const [lat, lng] of w) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }
  return {
    ref,
    ways,
    stitched,
    bbox: { south, west, north, east },
    totalKm: totalKmOf(stitched),
  };
}

export type { LL };
