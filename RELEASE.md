# Delivery Platform v1.0

v1.0 is the first release-candidate baseline for a pharmacy pilot.

## Included

- multi-tenant organization model and staff roles
- first-admin setup and login
- enrolled driver devices
- Saint Mary delivery-receipt PDF parsing
- Log # / barcode duplicate protection
- automatic driver assignment from printed aliases
- Windows virtual printer installer + GitHub-built EXE
- same-address stop grouping
- route planning / re-optimization
- driver ETA using driving time + 5 minutes per physical stop
- offline driver queue
- barcode verification before delivery
- missing-package / refusal / unavailable / access / wrong-package outcomes
- recipient relationship + signature
- signed PDF generated from the original receipt
- dispatcher delivery proof view
- return-to-pharmacy workflow
- audit events and dispatcher alerts
- CasaOS/Docker deployment
- backup / restore scripts
- CI build validation
- synthetic receipt parser/signing test
- PostgreSQL-backed API ingestion integration test

## Release gate

Code is considered release-ready when both GitHub workflows are green:

1. **Validate Delivery Platform**
2. **Build Windows Virtual Printer**

The remaining work before processing real production PHI is environment validation, not missing core application code:

- install the EXE on the actual pharmacy Windows PC
- print several receipts back-to-back from the exact pharmacy application
- test the driver PWA on the real Android/iPhone devices
- verify barcode camera behavior
- verify signed-field alignment on a real printed receipt
- verify HTTPS, backups and restore on the deployment host
- review hosting/vendor/privacy requirements for the pharmacy

## First pilot

Use one synthetic or authorized test delivery first:

`PRINT → IMPORT → ASSIGN → ROUTE → SCAN → SIGN → SIGNED PDF → DISPATCHER PROOF`

Do not use the public GitHub repository to store patient receipts, signatures or exported production data.
