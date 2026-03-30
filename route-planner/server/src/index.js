const express = require('express');
const polyline = require('@mapbox/polyline');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.ROUTE_PROXY_PORT || 8787);
const ORS_API_KEY = process.env.ORS_API_KEY || '';
const CACHE_TTL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

const cache = new Map();

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: ORS_API_KEY ? 'ors+osrm-fallback' : 'osrm' });
});

app.get('/api/geocode/suggest', async (req, res) => {
  const query = `${req.query.q ?? ''}`.trim();
  if (query.length < 2) {
    res.json({ suggestions: [] });
    return;
  }

  const cacheKey = `suggest:${query.toLowerCase()}`;
  const cached = readCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const endpoint = new URL(
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest'
    );
    endpoint.searchParams.set('f', 'json');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('maxSuggestions', '8');

    const payload = await fetchJson(endpoint.toString());
    const suggestions = (payload.suggestions ?? [])
      .filter((item) => !item.isCollection)
      .map((item) => ({
        displayName: item.text,
        magicKey: item.magicKey
      }));

    const response = { suggestions };
    writeCache(cacheKey, response);
    res.json(response);
  } catch (error) {
    res.status(200).json({ suggestions: [] });
  }
});

app.get('/api/geocode/resolve', async (req, res) => {
  const text = `${req.query.text ?? ''}`.trim();
  const magicKey = `${req.query.magicKey ?? ''}`.trim();
  if (!text) {
    res.status(400).json({ error: 'Missing text query.' });
    return;
  }

  const cacheKey = `resolve:${text.toLowerCase()}:${magicKey}`;
  const cached = readCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    let result = await resolveArcGis(text, magicKey);
    if (!result && !/south africa|johannesburg|gauteng/i.test(text)) {
      result = await resolveArcGis(`${text}, South Africa`, magicKey);
    }

    const response = { result };
    writeCache(cacheKey, response);
    res.json(response);
  } catch {
    res.status(200).json({ result: null });
  }
});

app.post('/api/route/driving', async (req, res) => {
  const stops = Array.isArray(req.body?.stops) ? req.body.stops : [];
  const includeAlternatives = Boolean(req.body?.includeAlternatives);
  if (stops.length < 2) {
    res.json({
      provider: 'none',
      primary: {
        coordinates: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        metrics: { totalDistanceKm: 0, estimatedMinutes: 0 }
      },
      alternatives: []
    });
    return;
  }

  const cacheKey = `route:${JSON.stringify({
    stops: stops.map((stop) => [round(stop.lat), round(stop.lng)]),
    includeAlternatives
  })}`;
  const cached = readCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = ORS_API_KEY
      ? await routeWithOrs(stops, includeAlternatives)
      : await routeWithOsrm(stops, includeAlternatives);
    writeCache(cacheKey, response);
    res.json(response);
  } catch {
    try {
      const response = await routeWithOsrm(stops, includeAlternatives);
      writeCache(cacheKey, response);
      res.json(response);
    } catch {
      res.status(502).json({ error: 'Route provider unavailable.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[route-proxy] listening on http://localhost:${PORT}`);
});

async function routeWithOrs(stops, includeAlternatives) {
  const endpoint = 'https://api.openrouteservice.org/v2/directions/driving-car';
  const body = {
    coordinates: stops.map((stop) => [stop.lng, stop.lat]),
    instructions: false
  };
  if (includeAlternatives) {
    body.alternative_routes = {
      target_count: 2,
      weight_factor: 1.6,
      share_factor: 0.6
    };
  }

  const payload = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      Authorization: ORS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const routes = payload.routes ?? [];
  const mappedRoutes = routes
    .map((route) => mapOrsRoute(route))
    .filter(Boolean);

  if (!mappedRoutes.length) {
    throw new Error('No route returned from ORS.');
  }

  return {
    provider: 'openrouteservice',
    primary: mappedRoutes[0],
    alternatives: mappedRoutes.slice(1)
  };
}

function mapOrsRoute(route) {
  const coordinates = decodeOrsGeometry(route.geometry);
  if (!coordinates.length || !route.summary) {
    return null;
  }
  return {
    coordinates,
    metrics: {
      totalDistanceKm: round(route.summary.distance / 1000),
      estimatedMinutes: Math.round(route.summary.duration / 60)
    }
  };
}

function decodeOrsGeometry(geometry) {
  if (!geometry) {
    return [];
  }
  if (Array.isArray(geometry?.coordinates)) {
    return geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  }
  if (typeof geometry === 'string') {
    const points = polyline.decode(geometry, 5);
    return points.map(([lat, lng]) => ({ lat, lng }));
  }
  return [];
}

async function routeWithOsrm(stops, includeAlternatives) {
  const coords = stops.map((stop) => `${stop.lng},${stop.lat}`).join(';');
  const endpoint = new URL(`https://router.project-osrm.org/route/v1/driving/${coords}`);
  endpoint.searchParams.set('overview', 'full');
  endpoint.searchParams.set('geometries', 'geojson');
  endpoint.searchParams.set('steps', 'false');
  endpoint.searchParams.set('alternatives', includeAlternatives ? 'true' : 'false');

  const payload = await fetchJson(endpoint.toString());
  const routes = payload.routes ?? [];
  if (!routes.length) {
    throw new Error('No route returned from OSRM.');
  }

  const mappedRoutes = routes.map((route) => ({
    coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    metrics: {
      totalDistanceKm: round(route.distance / 1000),
      estimatedMinutes: Math.round(route.duration / 60)
    }
  }));

  return {
    provider: 'osrm',
    primary: mappedRoutes[0],
    alternatives: mappedRoutes.slice(1)
  };
}

async function resolveArcGis(text, magicKey) {
  const endpoint = new URL(
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
  );
  endpoint.searchParams.set('f', 'json');
  endpoint.searchParams.set('SingleLine', text);
  endpoint.searchParams.set('maxLocations', '1');
  endpoint.searchParams.set('outSR', '4326');
  if (magicKey) {
    endpoint.searchParams.set('magicKey', magicKey);
  }

  const payload = await fetchJson(endpoint.toString());
  const candidate = payload.candidates?.[0];
  if (!candidate) {
    return null;
  }
  return {
    displayName: candidate.address,
    lat: candidate.location.y,
    lng: candidate.location.x
  };
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function writeCache(key, value) {
  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value
  });
}

function readCache(key) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function round(value) {
  return Number(value.toFixed(6));
}
