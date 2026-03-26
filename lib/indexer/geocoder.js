const https = require('https');
const inFlightGeocodes = new Map();

function isMostlyAscii(value) {
  return typeof value === 'string' && /^[\x00-\x7F]+$/.test(value);
}

// Nominatim usage policy: max 1 request per second, with exponential backoff on errors
const THROTTLE_MS = 1100;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2000;
let lastRequestAt = 0;
let consecutiveErrors = 0;

function throttledDelay() {
  const backoffMs = consecutiveErrors > 0
    ? Math.min(BACKOFF_BASE_MS * Math.pow(2, consecutiveErrors - 1), 30000)
    : 0;
  const minGap = THROTTLE_MS + backoffMs;
  const elapsed = Date.now() - lastRequestAt;
  return elapsed >= minGap ? 0 : minGap - elapsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchPlace(lat, lon) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`;
    const options = {
      headers: { 'User-Agent': 'MemoryGallery/1.0.0 (Electron; https://github.com)' },
    };

    lastRequestAt = Date.now();

    https.get(url, options, (res) => {
      if (res.statusCode === 429 || res.statusCode >= 500) {
        consecutiveErrors++;
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ error: res.statusCode, body }));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          consecutiveErrors = 0;
          const json = JSON.parse(data);
          const address = json.address || {};
          const locality = address.city || address.town || address.village || address.municipality || address.suburb || address.county || address.state;
          const country = address.country;
          const place = locality && country && locality !== country
            ? `${locality}, ${country}`
            : locality || country || null;
          resolve({ place });
        } catch (e) {
          resolve({ place: null });
        }
      });
    }).on('error', () => {
      consecutiveErrors++;
      resolve({ error: 'network' });
    });
  });
}

async function reverseGeocode(db, lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;

  try {
    const cached = db.prepare('SELECT place_name FROM geocoding_cache WHERE lat_lon_key = ?').get(key);
    if (cached && isMostlyAscii(cached.place_name)) return cached.place_name;
  } catch (err) {
    console.error('Error reading geocoding cache:', err);
  }

  if (inFlightGeocodes.has(key)) {
    return inFlightGeocodes.get(key);
  }

  const requestPromise = (async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const delay = throttledDelay();
      if (delay > 0) await sleep(delay);

      const result = await fetchPlace(lat, lon);

      if (!result.error) {
        if (result.place) {
          try {
            db.prepare('INSERT OR REPLACE INTO geocoding_cache (lat_lon_key, place_name, updated_at_ms) VALUES (?, ?, ?)')
              .run(key, result.place, Date.now());
          } catch (_) { }
        }
        return result.place;
      }

      if (attempt < MAX_RETRIES) {
        console.warn(`[Geocoder] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${result.error}`);
      }
    }
    return null;
  })().finally(() => {
    inFlightGeocodes.delete(key);
  });

  inFlightGeocodes.set(key, requestPromise);
  return requestPromise;
}

module.exports = {
  reverseGeocode,
};
