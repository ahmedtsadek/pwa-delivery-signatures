ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DriverDevice" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "name" TEXT,
  "tokenHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverDevice_tokenHash_key" ON "DriverDevice"("tokenHash");
CREATE INDEX "DriverDevice_driverId_active_idx" ON "DriverDevice"("driverId", "active");
ALTER TABLE "DriverDevice" ADD CONSTRAINT "DriverDevice_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeviceEnrollmentCode" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceEnrollmentCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceEnrollmentCode_codeHash_key" ON "DeviceEnrollmentCode"("codeHash");
CREATE INDEX "DeviceEnrollmentCode_driverId_expiresAt_idx" ON "DeviceEnrollmentCode"("driverId", "expiresAt");
ALTER TABLE "DeviceEnrollmentCode" ADD CONSTRAINT "DeviceEnrollmentCode_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
