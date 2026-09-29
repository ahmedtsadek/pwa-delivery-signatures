# Windows Print Agent — v0.7

The Print Agent is the local bridge between pharmacy PCs and the standalone Delivery Platform.

## Security change in v0.7

Each installation now uses its own revocable **Print Agent credential**. The agent cannot use a dispatcher/driver token and its credential is scoped to one organization.

Required environment variables:

```text
DELIVERY_API_BASE=https://delivery.example.com
DELIVERY_ORGANIZATION_ID=<organization id>
DELIVERY_PRINT_AGENT_TOKEN=<token created in Dispatcher → System>
PRINT_WATCH_DIR=C:\DeliveryPrint\Inbox
PRINT_ARCHIVE_DIR=C:\DeliveryPrint\Archive
PRINT_FAILED_DIR=C:\DeliveryPrint\Failed
```

The credential is shown once when created. If a pharmacy PC is replaced or compromised, revoke that Print Agent from the dispatcher dashboard and create another token.

## Behavior

- waits until a PDF is fully written;
- authenticates to the delivery API with its own credential;
- uploads with source `PRINT_AGENT`;
- API parses and auto-assigns recognized driver aliases;
- successful jobs move to Archive;
- failed jobs move to Failed;
- exact duplicate/reprint handling remains server-side.

## Run

```bash
npm run dev -w @delivery/print-agent
```

A packaged Windows virtual-printer installer is still a later deployment slice; this agent is the authenticated ingestion bridge it will use.
