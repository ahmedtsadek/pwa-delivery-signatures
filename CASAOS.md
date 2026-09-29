# PWA Pharmacy Delivery — CasaOS deployment

This repository is packaged as a self-contained CasaOS Docker Compose application.

## Services

- `web` — Next.js dispatcher + driver PWA, exposed on the CasaOS host.
- `api` — Express/Prisma API, reachable only inside the Docker network and proxied through the web service.
- `postgres` — private PostgreSQL database with persistent CasaOS storage.

Default host port: **8677**.

## Install from GitHub in CasaOS

1. Clone/download this repository onto the CasaOS host, or use CasaOS Compose import if your CasaOS build supports importing a Compose file from a repository.
2. No database password or bootstrap key is required; the database credential is generated automatically and persisted under the app data directory.
3. From the repository directory run:

```bash
docker compose up -d --build
```

4. Open:

```text
http://CASAOS-IP:8677/setup
```

5. Create the first organization and SUPER_ADMIN user. Bootstrap automatically closes after the first user is created.

After bootstrap, normal staff sign-in is at `/login` and driver phone enrollment is at `/enroll`.

## Persistent data

By default:

```text
/DATA/AppData/pwa-delivery-signatures/postgres
/DATA/AppData/pwa-delivery-signatures/storage
/DATA/AppData/pwa-delivery-signatures/secrets
```

The `storage` directory stores uploaded receipts, signatures, and signed receipt PDFs. The `secrets` directory contains the automatically generated database credential and should be backed up with the database.

## Reverse proxy / HTTPS

Point your reverse proxy to the `web` service only, e.g. `http://CASAOS-IP:8677`. The browser does not need direct access to port 8787 because `/api/*` is proxied internally to the API container.

HTTPS is strongly recommended before enrolling driver phones because PWA camera/barcode features commonly require a secure browser context outside localhost.

## Updating

```bash
git pull
docker compose up -d --build
```

The API container synchronizes the Prisma schema on startup. Back up the PostgreSQL and `storage` directories before version upgrades.

## Windows Print Agent

The Windows Print Agent remains a separate workstation component. Its `DELIVERY_API_BASE` should be the public base URL of this CasaOS deployment, for example:

```text
DELIVERY_API_BASE=https://delivery.example.com
```

Because the web container proxies `/api/*`, no public API port is required.


## Backup and restore

Create a timestamped database + receipt/signature backup:

```bash
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/backup.sh
```

Backups default to:

```text
/DATA/AppData/pwa-delivery-signatures/backups/<timestamp>/
```

Restore a selected backup:

```bash
./scripts/restore.sh /DATA/AppData/pwa-delivery-signatures/backups/<timestamp>
```

The restore command requires typing `RESTORE` before it replaces the database and storage.

For production, set `PUBLIC_BASE_URL` in `.env` to the exact HTTPS URL used by staff and drivers. This becomes the browser CORS allow-list origin.
