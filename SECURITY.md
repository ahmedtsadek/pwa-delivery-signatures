# Security and PHI Handling

This repository contains application source code for a pharmacy delivery workflow.
The repository must **not** be used to store real patient receipts, signatures,
addresses, medication lists, exported delivery logs, database dumps, access tokens,
or other protected health information (PHI).

## Repository rules

- Use synthetic data in tests and screenshots.
- Do not commit real receipt PDFs.
- Do not commit signature images.
- Do not commit production `.env` files, Print Agent tokens, database dumps, or backups.
- Production receipt/signature storage belongs in the configured application storage
  volume or an approved private object store, not Git.
- Treat logs as sensitive; production logging should avoid patient/medication payloads
  unless explicitly required and access-controlled.

## Print Agent credentials

Print Agent raw tokens are shown once when created. The server stores only their hash.
The Windows installer protects the locally stored token with Windows DPAPI.

If a pharmacy PC is lost, replaced, or suspected compromised, revoke its Print Agent
credential from Dispatcher -> Users / Print Agents and issue a new credential.

## Production checklist

Before using real patient data:

1. Serve the platform only over HTTPS.
2. Disable `DEV_AUTH_BYPASS`.
3. Use strong production secrets and restricted database credentials.
4. Restrict application/storage access by organization and role.
5. Enable encrypted backups and test restoration.
6. Define receipt/signature retention and deletion policy.
7. Review hosting, vendors, and agreements for the pharmacy's regulatory obligations.
8. Test account/device revocation and audit logging.
