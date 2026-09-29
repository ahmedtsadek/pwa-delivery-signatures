# Development Status — v0.8

## Completed through v0.6

- Standalone multi-tenant delivery platform, separate from Pharmacy Swisskit.
- Receipt PDF ingestion, Saint Mary parsing, Log # grouping and driver-alias auto-assignment.
- Original/signed PDF storage model and signature stamping into the existing receipt layout.
- Driver PWA with large controls, barcode verification, exception outcomes, signature collection and offline queue.
- Same-address grouping, route optimization, manual reorder and re-optimize remaining stops.
- Dispatcher + driver ETA using road/driving estimate plus 5 minutes per physical stop.
- Return-to-pharmacy reconciliation.
- First-admin setup, staff login foundation and one-time driver phone enrollment.

## Added in v0.7

### Staff users and roles

- Admin page for creating dispatcher, pharmacy-admin and auditor users.
- Staff accounts can be enabled/disabled without deleting history.
- Disabling a staff account invalidates active sessions.
- Additional organization-scoped authorization is enforced on dispatcher dashboard, drivers, settings, imports, exceptions and route creation APIs.
- Legacy direct-delivery scan/outcome endpoints are no longer unauthenticated.

### Scoped Print Agent security

- New `PrintAgentCredential` model.
- Each pharmacy PC can receive its own revocable Print Agent token.
- `/api/ingest/pdf` now requires either:
  - a valid organization staff session for manual uploads, or
  - a valid Print Agent token scoped to the same organization for `PRINT_AGENT` uploads.
- Dispatcher/admin system page can create, list and revoke Print Agent credentials.
- Print Agent now requires `DELIVERY_PRINT_AGENT_TOKEN` and sends it as a bearer credential.
- Database stores only the SHA-256 token hash; the raw token is shown once when created.

### Dispatcher alerts

- New `DispatcherAlert` model.
- Delivery exceptions create dispatcher alerts automatically.
- Return-required exceptions are marked as warning severity.
- Dispatcher dashboard shows unacknowledged alerts with a one-click acknowledgement action.

### Offline conflict safety

- Offline queue no longer treats every HTTP 409 as safe.
- Failed queued actions are retained rather than silently deleted.
- If the route changed while a driver was offline (for example, dispatcher reassignment), the driver sees a clear sync-attention message instead of losing the queued action.

### Driver simplicity preserved

No new normal-route steps were added for drivers. The normal flow remains:

`NEXT STOP → NAVIGATE → I ARRIVED → SCAN → RESULT → SIGN → COMPLETE → NEXT STOP`

The new v0.7 features are almost entirely dispatcher/admin/security changes.

## Validation performed

- All TypeScript/TSX source files were parsed with TypeScript 5.8.3 using `--noCheck` to catch syntax errors without installed workspace dependencies.
- Package JSON files were parsed successfully.
- A full dependency-backed `npm run build` is still pending because this environment does not have the project dependency tree installed.
- Prisma migration SQL was added for `PrintAgentCredential` and `DispatcherAlert`; run Prisma migration/generate in the deployment environment before starting v0.7.

## Next development block

1. Native Windows virtual-printer queue / installer around the authenticated Print Agent.
2. Better conflict-resolution UI for dispatcher when a stale offline action is waiting.
3. Production object storage, backups and retention policy.
4. HTTPS / deployment hardening and end-to-end tests.
5. Optional push notification delivery in addition to the in-app dispatcher alerts.
6. Driver usability testing on older Android/iPhone devices and camera/barcode fallbacks.

## CasaOS deployment packaging

Added after v0.7 application work:

- production API Dockerfile
- production Next.js/PWA Dockerfile
- CasaOS-ready Compose stack
- private PostgreSQL service and persistent `/DATA/AppData/pwa-delivery-signatures` storage
- single externally exposed web port (`8677` by default)
- same-origin `/api/*` proxy from Next.js to the internal API container
- automatic Prisma schema synchronization on API container startup
- CasaOS install/update/reverse-proxy documentation

Validation in the packaging environment:

- Compose YAML parsed successfully.
- TypeScript/TSX syntax parsing completed successfully with TypeScript 5.8.3 `--noCheck`.
- Full dependency-backed npm build could not complete in the packaging environment because dependency installation exceeded the available execution window.
- Docker runtime launch could not be performed because Docker is not installed in the packaging environment.


## Added in v0.8

### Native Windows virtual-printer installer

- Added `tools/windows-virtual-printer/delivery_virtual_printer.py`.
- GUI allows the pharmacy to configure:
  - virtual printer name
  - Delivery Platform URL
  - organization ID
  - Print Agent token
  - Start with Windows
  - start immediately after install/update
- Creates a Windows printer queue backed by the built-in `Microsoft Print To PDF` driver.
- Uses a silent local spool-file port, then moves each completed PDF into a unique pending file.
- Upload contract is aligned with `POST /api/ingest/pdf` and the existing scoped Print Agent credential model.
- Failed uploads remain queued and retry automatically.
- Successful uploads are retained locally in an archive folder.
- Print Agent token is protected on disk with Windows DPAPI instead of being stored as clear text.
- Installer can remove the printer and startup task while preserving the local receipt archive.

### EXE build automation

- Added `tools/windows-virtual-printer/build_exe.bat` for local PyInstaller builds.
- Added GitHub Actions workflow `.github/workflows/build-windows-printer.yml`.
- The workflow builds `DeliveryPrinterInstaller.exe` on Windows and publishes it as a workflow artifact.
- Workflow can be started manually and also runs when virtual-printer files change.

## v0.8 validation still required

1. Build the EXE in GitHub Actions and confirm the artifact launches on Windows 10/11.
2. Test repeated back-to-back print jobs from the actual pharmacy software.
3. Confirm the Microsoft Print To PDF local-file port behaves silently on the target Windows machines.
4. Run an end-to-end real receipt test:
   `Pharmacy software → virtual printer → API → parsed delivery → driver PWA → barcode → signature → signed PDF`.


## Added after the initial v0.8 printer work

### Pilot operations / proof view

- Added dispatcher Deliveries screen with search and status filters.
- Added delivery detail screen showing:
  - Log #
  - patient/address
  - driver
  - barcode verification
  - recipient/relationship
  - receipt import history
  - audit timeline
- Added secure authenticated streaming for:
  - original receipt PDF
  - signed receipt PDF
  - captured signature PNG
- Object-storage keys are not exposed to the browser.
- Added Pilot Readiness dashboard with checks for:
  - active Print Agent
  - active driver
  - at least one imported receipt
  - unassigned imports
  - parser review items
  - observed signed-PDF completion flow
- Added Deliveries and Pilot Readiness shortcuts to the dispatcher dashboard.

### CI validation

- Bumped workspace package versions to 0.8.0.
- Added GitHub Actions validation workflow for dependency install, Prisma client generation, API build, web build and legacy Print Agent build.


## CI / pilot hardening follow-up

- Fixed the first GitHub Actions failure: `actions/setup-node` had npm caching enabled without a committed npm lockfile, so setup failed before dependencies were installed.
- CI now installs dependencies without the lockfile-dependent cache setting.
- Added a synthetic, non-PHI Saint Mary-style 3-page receipt smoke test.
- The smoke test validates:
  - template detection
  - delivery address parsing
  - facility name
  - driver alias normalization
  - Log # / barcode extraction
  - patient extraction
  - multi-page Rx extraction
  - signature stamping
  - signed PDF remains a valid 3-page PDF
- The synthetic test intentionally uses fake patient/address data so no production PHI is committed to the public repository.
