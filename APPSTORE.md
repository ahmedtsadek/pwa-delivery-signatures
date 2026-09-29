# TEE4IT CasaOS / ZimaOS App Store

This repository also publishes a standards-based CasaOS/ZimaOS third-party app store.

## Store source

The v2 store is published from the generated `gh-pages` branch.

Store root:

```text
https://cdn.jsdelivr.net/gh/ahmedtsadek/pwa-delivery-signatures@gh-pages/
```

Generated protocol files include:

```text
store.json
index.json
apps/com.tee4it.delivery-platform/docker-compose.yml
apps/com.tee4it.delivery-platform/meta.json
```

The builder generates a `content_hash` for each app. Clients can use that hash,
together with the semantic `version`, to detect changed app definitions and updates.

## Legacy CasaOS source

For older CasaOS versions that expect a ZIP app-store source:

```text
https://cdn.jsdelivr.net/gh/ahmedtsadek/pwa-delivery-signatures@gh-pages/store/main.zip
```

## Releasing an app update

1. Update `Apps/DeliveryPlatform/docker-compose.yml`.
2. Increment `x-casaos.version`.
3. Update `x-casaos.update_at`.
4. Update `x-casaos.release_notes.en_US`.
5. Merge to `main`.

GitHub Actions rebuilds and republishes the store automatically. The v2 build also
regenerates the app's `content_hash`.

The source layout follows the official IceWhaleTech App Store v2 protocol.
