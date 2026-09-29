# Windows Virtual Printer

The Windows virtual printer is the pharmacy-PC bridge for the Delivery Platform.

It creates a real Windows printer queue using the built-in **Microsoft Print To PDF**
driver. Printing to that queue silently produces a PDF, which the local background
agent uploads to the Delivery Platform.

## Driver-facing workflow

There is no driver-side change. This is only installed on the pharmacy/dispatcher PC.

## Build locally

On Windows:

```bat
cd tools\windows-virtual-printer
build_exe.bat
```

The EXE is created at:

```text
dist\DeliveryPrinterInstaller.exe
```

Run it as Administrator.

## GUI fields

- **Virtual printer name** — e.g. `Saint Mary Delivery`
- **Delivery Platform URL** — e.g. `https://delivery.example.com`
- **Organization ID** — copied from the Delivery Platform
- **Print Agent token** — created in Dispatcher → System
- **Start Print Agent with Windows**
- **Start immediately after install/update**

The token is protected using Windows DPAPI before it is saved to disk.

## Server contract

The installer is aligned with the v0.7+ API:

```http
POST /api/ingest/pdf
Authorization: Bearer <print-agent-token>
X-Organization-ID: <organization-id>
X-Ingest-Source: PRINT_AGENT
Content-Type: multipart/form-data
```

Multipart fields:

```text
organizationId=<organization-id>
source=PRINT_AGENT
file=<receipt.pdf>
```

The API then parses the receipt, detects the Log #, destination, patient and driver
alias, stores the original PDF, and creates or updates the delivery.

## Local folders

```text
C:\ProgramData\DeliveryPrinter\
├── Archive
├── Failed
├── Logs
├── Pending
├── Spool
└── config.json
```

Successful uploads are retained in Archive. Failed uploads remain in Pending and are
retried automatically.

## Important production test

Before rolling this out to all pharmacy PCs, test repeated back-to-back print jobs from
the exact pharmacy application. The implementation uses a fixed local spool file and
moves each completed PDF immediately into a unique pending filename.
