import { RouteMetrics, RouteStop } from '../../core/domain/route.models';

export function haversineDistanceKm(from: RouteStop, to: RouteStop): number {
  const earthRadiusKm = 6371;
  const dLat = degToRad(to.lat - from.lat);
  const dLng = degToRad(to.lng - from.lng);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const a =
    sinLat * sinLat +
    Math.cos(degToRad(from.lat)) * Math.cos(degToRad(to.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function buildMetrics(stops: RouteStop[]): RouteMetrics {
  if (stops.length < 2) {
    return { totalDistanceKm: 0, estimatedMinutes: 0 };
  }

  let distance = 0;
  for (let index = 0; index < stops.length - 1; index += 1) {
    distance += haversineDistanceKm(stops[index], stops[index + 1]);
  }
  const averageUrbanSpeedKmH = 35;
  const estimatedMinutes = Math.round((distance / averageUrbanSpeedKmH) * 60);
  return {
    totalDistanceKm: Number(distance.toFixed(2)),
    estimatedMinutes
  };
}

function degToRad(value: number): number {
  return value * (Math.PI / 180);
}
