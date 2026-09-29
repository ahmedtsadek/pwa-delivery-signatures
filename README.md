# Delivery Platform v0.7

Standalone pharmacy delivery / proof-of-delivery system. It remains intentionally separate from Pharmacy Swisskit so Swisskit can integrate later through API/webhooks.

## Current capabilities

- Pharmacy receipt PDF import.
- Saint Mary receipt parsing: Log #, patient, destination, Rx list, printed driver and barcode.
- Automatic driver assignment using configured aliases.
- Duplicate/reprint protection.
- Same-address stop grouping.
- Route optimization and remaining-route re-optimization.
- Route ETA = driving time + **5 minutes per physical stop**.
- Dispatcher live route dashboard.
- Very simple driver PWA.
- Mandatory package barcode verification.
- Missing-package override.
- Recipient unavailable / refused / unable-to-access / wrong-package outcomes.
- Signature, recipient relationship and automatic date/time.
- Signed copy written onto the original pharmacy receipt layout.
- Return-to-pharmacy queue and reassignment.
- Offline driver route cache and ordered action queue.
- Driver phone one-time enrollment.
- Staff authentication and roles.
- **v0.7:** scoped Print Agent credentials, staff-user management, dispatcher alerts and safer offline conflict behavior.

## Driver workflow

The driver is intentionally kept simple:

`NEXT STOP → NAVIGATE → I ARRIVED → SCAN → RESULT → SIGN → COMPLETE → NEXT STOP`

Drivers do not manage routes, accounts, reports, filters or settings.

## Staff roles

- `SUPER_ADMIN`
- `PHARMACY_ADMIN`
- `DISPATCHER`
- `AUDITOR`
- `DRIVER` exists in the data model, while operational drivers normally use enrolled-device access rather than a daily password.

Use **Dispatcher → Users / Print Agents** to create staff users and pharmacy-PC credentials.

## Secure Print Agent setup

Create one Print Agent credential per pharmacy Windows PC. The raw credential is displayed once.

Set:

```text
DELIVERY_API_BASE=https://delivery.example.com
DELIVERY_ORGANIZATION_ID=<organization id>
DELIVERY_PRINT_AGENT_TOKEN=<one-time token from dispatcher system page>
PRINT_WATCH_DIR=C:\DeliveryPrint\Inbox
PRINT_ARCHIVE_DIR=C:\DeliveryPrint\Archive
PRINT_FAILED_DIR=C:\DeliveryPrint\Failed
```

The agent uploads to `/api/ingest/pdf` with source `PRINT_AGENT`. The API rejects a token belonging to a different organization or a revoked credential.

## Authentication

### First setup

Open `/setup` with an empty database to create the first organization and `SUPER_ADMIN` account.

If `BOOTSTRAP_KEY` is configured on the API, the matching key is required during bootstrap.

### Dispatcher/admin login

Use `/login`.

Passwords use Node `scrypt` with a random salt. Session/device/Print-Agent secrets are stored server-side only as hashes.

### Driver phones

1. Dispatcher opens **Driver Phones**.
2. Select driver and generate a 6-digit code.
3. Driver opens `/enroll` once and enters the code.
4. The phone remains enrolled until revoked/expired.

## Offline operation

The driver should open the route once while online before leaving the pharmacy.

When connectivity drops:

- route stays available locally;
- expected barcodes remain available for local verification;
- arrival, scan and completion actions queue in IndexedDB;
- signatures stay in the queued completion payload;
- queued actions replay in order after reconnection.

v0.7 no longer discards a queued action just because the server returns a conflict. If dispatch changed the route while the phone was offline, the queued action stays preserved and the driver is told to contact dispatch.

## Database migration

v0.7 adds:

- `PrintAgentCredential`
- `DispatcherAlert`

Run:

```bash
npm install
npm run prisma:generate -w @delivery/api
npm run prisma:migrate -w @delivery/api
npm run build
```

## Development

Typical environment variables:

```text
DATABASE_URL=postgresql://...
API_PORT=8787
BOOTSTRAP_KEY=<optional bootstrap key>
USER_SESSION_HOURS=12
DEVICE_TOKEN_DAYS=180
DEV_AUTH_BYPASS=false
NEXT_PUBLIC_API_URL=http://localhost:8787
```

Then:

```bash
npm install
npm run prisma:generate -w @delivery/api
npm run prisma:migrate -w @delivery/api
npm run dev
```

## Still outstanding before production rollout

- Native Windows virtual-printer driver/installer.
- Full dependency-backed build and end-to-end test run.
- Production object storage and backup/retention plan.
- HTTPS/reverse-proxy hardening.
- Browser/device testing for barcode camera support.
- Optional native/web push notifications.

## CasaOS / Docker deployment

The repository now includes production Dockerfiles and a CasaOS-ready Compose stack. The default external port is `8677`; persistent data defaults to `/DATA/AppData/pwa-delivery-signatures`.

See [`CASAOS.md`](./CASAOS.md) for installation, first-time setup, reverse-proxy, persistence, and update instructions.
