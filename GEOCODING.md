# Geocoding setup

PWA Pharmacy Delivery uses a Nominatim-compatible forward-geocoding endpoint.

## Environment variables

- `GEOCODER_BASE_URL`: base URL of the Nominatim-compatible service, without `/search`.
- `GEOCODER_COUNTRYCODES`: optional comma-separated country filter. For a US-only pharmacy set `us`.
- `GEOCODER_USER_AGENT`: identifiable User-Agent sent to the geocoder.
- `GEOCODER_MIN_INTERVAL_MS`: minimum delay between requests in one API process. Leave blank to use 1100 ms automatically for `nominatim.openstreetmap.org`; self-hosted services default to no artificial delay.

Example pilot configuration:

```
GEOCODER_BASE_URL=https://nominatim.openstreetmap.org
GEOCODER_COUNTRYCODES=us
GEOCODER_USER_AGENT=PWA-Pharmacy-Delivery/1.1.6
GEOCODER_MIN_INTERVAL_MS=1100
```

The public OpenStreetMap Nominatim service is suitable only for light/pilot usage and must follow its usage policy. Daily production traffic should use a private/self-hosted Nominatim-compatible service or another supported provider.

## Self-hosted Nominatim

The API expects:

```
GET <GEOCODER_BASE_URL>/search?format=jsonv2&limit=1&q=<address>
```

A self-hosted Nominatim instance therefore works directly. Configure the API container with the internal or HTTPS base URL of that service.

Coordinates are stored on each delivery after a successful lookup so route rebuilding does not need to geocode the same delivery again unless its address is edited or the dispatcher explicitly re-geocodes it.
