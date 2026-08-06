# HARA frontend

Next.js 16 attendee frontend for event discovery, authentication, checkout,
sandbox payment completion and the ticket wallet.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

`NEXT_PUBLIC_HARA_API_BASE_URL` must point to the HARA backend, for example
`http://127.0.0.1:8000`. The backend must allow the frontend origin through
CORS.

Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to a Google Maps browser key and
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` to the map ID used by Advanced Markers. In
Google Cloud, enable Maps JavaScript API and restrict the key by HTTP referrer
to `https://hara.today/*`, `https://www.hara.today/*`, and the local development
origins. `DEMO_MAP_ID` can be used during development when a custom map ID is
not available.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Current API limitation

The public event list/detail response does not include attendee-readable ticket
types, prices, inventory or sales windows. The frontend therefore does not
invent a ticket picker. `POST /api/orders/` and the checkout primitives are
typed and implemented, but creating an order from event detail requires a new
public attendee ticket-type contract from the backend.

The Ticket API returns a UUID QR payload rather than a rendered image. Ticket
detail displays the payload without fabricating a QR graphic.
