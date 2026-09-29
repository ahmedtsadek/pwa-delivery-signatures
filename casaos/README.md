# One-click CasaOS install

This file exists specifically so CasaOS can install the PWA Pharmacy Delivery without
cloning the repository or building Node applications on the CasaOS server.

## Import URL

Use this raw Compose URL in CasaOS:

```text
https://raw.githubusercontent.com/ahmedtsadek/pwa-delivery-signatures/main/casaos/docker-compose.yml
```

If your CasaOS build only accepts pasted Compose YAML instead of a URL, open the URL,
copy its contents, then use **App Store → Custom Install → Import**.

The stack pulls prebuilt multi-architecture images from GitHub Container Registry:

- `ghcr.io/ahmedtsadek/pwa-delivery-signatures-api:latest`
- `ghcr.io/ahmedtsadek/pwa-delivery-signatures-web:latest`
- `postgres:16-alpine`

The UI opens on port **8677**.

## First launch

Open:

```text
http://YOUR-CASAOS-IP:8677/setup
```

Create the first pharmacy organization and SUPER_ADMIN account immediately.

For public/remote access, place the app behind HTTPS before enrolling driver phones
or using camera/barcode features.

## Persistent data

CasaOS stores data at:

```text
/DATA/AppData/com.tee4it.delivery-platform/postgres
/DATA/AppData/com.tee4it.delivery-platform/storage
```

If CasaOS substitutes a different `$AppID`, the paths will follow that installed app ID.

## Windows printer

The Windows virtual printer is installed separately on the pharmacy PC. Its Delivery
Platform URL should be the public HTTPS address (or LAN URL during local testing).


## CasaOS v1.0.2 compatibility note

Some CasaOS Custom Install versions flatten imported services onto Docker's default
`bridge` network and do not preserve Compose service DNS. v1.0.2 therefore uses
explicit service links (`postgres:postgres` and `api:api`) and fixed AppData paths
instead of depending on a custom Compose network or `$AppID` substitution.
