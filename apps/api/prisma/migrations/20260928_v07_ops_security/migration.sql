CREATE TABLE "PrintAgentCredential" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  CONSTRAINT "PrintAgentCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrintAgentCredential_tokenHash_key" ON "PrintAgentCredential"("tokenHash");
CREATE INDEX "PrintAgentCredential_organizationId_active_idx" ON "PrintAgentCredential"("organizationId", "active");
ALTER TABLE "PrintAgentCredential" ADD CONSTRAINT "PrintAgentCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DispatcherAlert" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "deliveryId" TEXT,
  "routeId" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatcherAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DispatcherAlert_organizationId_acknowledgedAt_createdAt_idx" ON "DispatcherAlert"("organizationId", "acknowledgedAt", "createdAt");
ALTER TABLE "DispatcherAlert" ADD CONSTRAINT "DispatcherAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
