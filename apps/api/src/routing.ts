export type GeoPoint = { latitude: number; longitude: number };
export type RouteCandidate = GeoPoint & { id: string };

const EARTH_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// Conservative local fallback when a road-routing service is not configured.
// It intentionally does not pretend to be live traffic: road distance is approximated
// as 1.22x straight-line distance and urban average speed as 35 km/h.
export function estimatedDriveMinutes(a: GeoPoint, b: GeoPoint) {
  const roadKm = haversineKm(a, b) * 1.22;
  return Math.max(1, Math.round((roadKm / 35) * 60));
}

export async function roadDurationMatrix(points: GeoPoint[]): Promise<number[][] | null> {
  const base = (process.env.ROUTER_BASE_URL || process.env.ROUTING_BASE_URL || '').replace(/\/$/, '');
  if (!base || points.length < 2) return null;
  const coords = points.map(p => `${p.longitude},${p.latitude}`).join(';');
  const response = await fetch(`${base}/table/v1/driving/${coords}?annotations=duration`);
  if (!response.ok) throw new Error(`Routing table failed: ${response.status}`);
  const payload: any = await response.json();
  if (!Array.isArray(payload.durations)) throw new Error('Routing service did not return durations');
  return payload.durations.map((row: Array<number | null>) => row.map(v => v == null ? Number.POSITIVE_INFINITY : Math.max(1, Math.round(v / 60))));
}

export function nearestNeighborOrder(candidates: RouteCandidate[], origin: GeoPoint, matrix?: number[][] | null) {
  if (!candidates.length) return [] as RouteCandidate[];
  // matrix layout when supplied is [origin, ...candidates].
  const pending = new Set(candidates.map((_, i) => i));
  const order: RouteCandidate[] = [];
  let currentPoint = origin;
  let currentMatrixIndex = 0;
  while (pending.size) {
    let bestIndex = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const i of pending) {
      const cost = matrix
        ? matrix[currentMatrixIndex]?.[i + 1] ?? Number.POSITIVE_INFINITY
        : estimatedDriveMinutes(currentPoint, candidates[i]);
      if (cost < bestCost) { bestCost = cost; bestIndex = i; }
    }
    if (bestIndex < 0) bestIndex = [...pending][0];
    const chosen = candidates[bestIndex];
    order.push(chosen);
    pending.delete(bestIndex);
    currentPoint = chosen;
    currentMatrixIndex = bestIndex + 1;
  }
  return order;
}

export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const base = (process.env.GEOCODER_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const url = `${base}/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
  const response = await fetch(url, { headers: { 'user-agent': process.env.GEOCODER_USER_AGENT || 'delivery-platform/1.0' } });
  if (!response.ok) throw new Error(`Geocoder failed: ${response.status}`);
  const payload: any[] = await response.json();
  if (!payload?.length) return null;
  const latitude = Number(payload[0].lat), longitude = Number(payload[0].lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}


function matrixPathMinutes(order: RouteCandidate[], candidates: RouteCandidate[], matrix: number[][]) {
  let total = 0;
  let previousMatrixIndex = 0;
  for (const stop of order) {
    const candidateIndex = candidates.findIndex(c => c.id === stop.id);
    if (candidateIndex < 0) return Number.POSITIVE_INFINITY;
    const matrixIndex = candidateIndex + 1;
    total += matrix[previousMatrixIndex]?.[matrixIndex] ?? Number.POSITIVE_INFINITY;
    previousMatrixIndex = matrixIndex;
  }
  return total;
}

// Improve the road-matrix nearest-neighbor result with a bounded 2-opt pass.
// This is an open route (pharmacy origin -> final stop), so no return leg is
// included unless dispatch explicitly creates one as a stop.
export function improveRoadOrder(
  initial: RouteCandidate[],
  candidates: RouteCandidate[],
  matrix?: number[][] | null,
  maxPasses = 5
) {
  if (!matrix || initial.length < 4) return initial;

  let best = [...initial];
  let bestCost = matrixPathMinutes(best, candidates, matrix);

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1)
        ];
        const cost = matrixPathMinutes(candidate, candidates, matrix);
        if (cost + 0.01 < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return best;
}
