import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import multer from 'multer';
import { PrismaClient, DeliveryOutcome, DeliveryStatus } from '@prisma/client';
import { z } from 'zod';
import { parseReceiptPdf } from './receiptParser.js';
import { savePdf, savePng, readObject } from './storage.js';
import { stampSaintMaryReceipt } from './signedReceipt.js';
import { estimatedDriveMinutes, geocodeAddress, nearestNeighborOrder, improveRoadOrder, roadDurationMatrix } from './routing.js';

const prisma = new PrismaClient();
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }
});

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    // Native/desktop agents do not send an Origin header. Browser origins can
    // be restricted in production with CORS_ORIGINS=https://delivery.example.com.
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: false
}));
app.use(express.json({ limit: '4mb' }));

const STOP_SERVICE_MINUTES = 5;
const port = Number(process.env.API_PORT || 8787);


const DEV_AUTH_BYPASS = String(process.env.DEV_AUTH_BYPASS || 'false').toLowerCase() === 'true';
const USER_SESSION_HOURS = Number(process.env.USER_SESSION_HOURS || 12);
const DEVICE_TOKEN_DAYS = Number(process.env.DEVICE_TOKEN_DAYS || 180);

function tokenHash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':', 2);
  try {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function bearerToken(req: express.Request) {
  const header = String(req.headers.authorization || '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function userFromRequest(req: express.Request) {
  const raw = bearerToken(req);
  if (!raw) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(raw) },
    include: { user: true }
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return session.user;
}

async function deviceFromRequest(req: express.Request) {
  const raw = bearerToken(req);
  if (!raw) return null;
  const device = await prisma.driverDevice.findUnique({
    where: { tokenHash: tokenHash(raw) },
    include: { driver: { include: { organization: true } } }
  });
  if (!device || !device.active || device.expiresAt <= new Date()) return null;
  await prisma.driverDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return device;
}

async function requireDispatcher(req: express.Request, res: express.Response) {
  if (DEV_AUTH_BYPASS) return { bypass: true } as any;
  const user = await userFromRequest(req);
  if (!user || !['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER'].includes(user.role)) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return user;
}

async function requireOrganizationUser(req: express.Request, res: express.Response, organizationId: string, roles: string[] = ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER','AUDITOR']) {
  if (DEV_AUTH_BYPASS) return { bypass: true, organizationId } as any;
  const user = await userFromRequest(req);
  if (!user) { res.status(401).json({ error: 'Authentication required' }); return null; }
  if (user.organizationId !== organizationId) { res.status(403).json({ error: 'Organization access denied' }); return null; }
  if (!roles.includes(user.role)) { res.status(403).json({ error: 'Role does not permit this action' }); return null; }
  return user;
}

async function printAgentFromRequest(req: express.Request) {
  const raw = bearerToken(req);
  if (!raw) return null;
  const agent = await prisma.printAgentCredential.findUnique({ where: { tokenHash: tokenHash(raw) } });
  if (!agent || !agent.active) return null;
  await prisma.printAgentCredential.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return agent;
}

async function createAlert(organizationId: string, type: string, title: string, message: string, extra: { severity?: string; deliveryId?: string; routeId?: string } = {}) {
  return prisma.dispatcherAlert.create({ data: { organizationId, type, title, message, severity: extra.severity || 'INFO', deliveryId: extra.deliveryId, routeId: extra.routeId } }).catch(() => null);
}

async function requireDriverDevice(req: express.Request, res: express.Response) {
  if (DEV_AUTH_BYPASS) return { bypass: true } as any;
  const device = await deviceFromRequest(req);
  if (!device) {
    res.status(401).json({ error: 'Driver device is not enrolled' });
    return null;
  }
  return device;
}

async function ensureStopBelongsToDevice(req: express.Request, res: express.Response, stopId: string) {
  if (DEV_AUTH_BYPASS) return true;
  const device = await deviceFromRequest(req);
  if (!device) {
    res.status(401).json({ error: 'Driver device is not enrolled' });
    return false;
  }
  const stop = await prisma.routeStop.findUnique({ where: { id: stopId }, include: { route: true } });
  if (!stop || stop.route.driverId !== device.driverId) {
    res.status(403).json({ error: 'This stop is not assigned to this driver device' });
    return false;
  }
  return true;
}

async function ensureRouteAccess(req: express.Request, res: express.Response, routeId: string) {
  if (DEV_AUTH_BYPASS) return true;
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) { res.status(404).json({ error: 'Route not found' }); return false; }
  const device = await deviceFromRequest(req);
  if (device && device.driverId === route.driverId) return true;
  const user = await userFromRequest(req);
  if (user && user.organizationId === route.organizationId && ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER','AUDITOR'].includes(user.role)) return true;
  res.status(403).json({ error: 'Not authorized for this route' });
  return false;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pwa-pharmacy-delivery-api', version: '1.1.6' }));


app.post('/api/auth/bootstrap', async (req, res) => {
  try {
    const parsed = z.object({
      organizationName: z.string().min(2),
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7331042026)');
      const existingUsers = await tx.user.count();
      if (existingUsers > 0) return null;
      const organization = await tx.organization.create({
        data: { name: parsed.data.organizationName.trim() }
      });
      const user = await tx.user.create({ data: {
        organizationId: organization.id,
        name: parsed.data.name.trim(),
        email: normalizeEmail(parsed.data.email),
        passwordHash: hashPassword(parsed.data.password),
        role: 'SUPER_ADMIN'
      }});
      return { organization, user };
    });

    if (!result) return res.status(409).json({ error: 'Bootstrap already completed' });
    res.status(201).json({
      organization: result.organization,
      user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role }
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Bootstrap failed', detail: error?.message || String(error) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.findFirst({ where: { email: normalizeEmail(parsed.data.email), active: true } });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password' });
  const rawToken = randomToken();
  const expiresAt = new Date(Date.now() + USER_SESSION_HOURS * 60 * 60 * 1000);
  await prisma.authSession.create({ data: { userId: user.id, tokenHash: tokenHash(rawToken), expiresAt } });
  res.json({ token: rawToken, expiresAt, user: { id: user.id, organizationId: user.organizationId, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/logout', async (req, res) => {
  const raw = bearerToken(req);
  if (raw) await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(raw) } });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: { id: user.id, organizationId: user.organizationId, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/organizations/:organizationId/users', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  const users = await prisma.user.findMany({ where: { organizationId: req.params.organizationId }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
  res.json({ users });
});

app.post('/api/organizations/:organizationId/users', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  const parsed = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), role: z.enum(['PHARMACY_ADMIN','DISPATCHER','AUDITOR']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const user = await prisma.user.create({ data: { organizationId: req.params.organizationId, name: parsed.data.name.trim(), email: normalizeEmail(parsed.data.email), passwordHash: hashPassword(parsed.data.password), role: parsed.data.role } });
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
  } catch (e: any) {
    res.status(409).json({ error: 'A user with that email already exists for this organization' });
  }
});

app.put('/api/users/:userId', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  const actor = await requireOrganizationUser(req, res, target.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  const parsed = z.object({ name: z.string().min(2).optional(), role: z.enum(['PHARMACY_ADMIN','DISPATCHER','AUDITOR']).optional(), active: z.boolean().optional(), password: z.string().min(8).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only a super admin can modify a super admin' });
  const data: any = { ...parsed.data };
  if (data.password) { data.passwordHash = hashPassword(data.password); delete data.password; }
  const user = await prisma.user.update({ where: { id: target.id }, data });
  if (parsed.data.active === false) await prisma.authSession.deleteMany({ where: { userId: target.id } });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
});

app.get('/api/organizations/:organizationId/print-agents', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  const agents = await prisma.printAgentCredential.findMany({ where: { organizationId: req.params.organizationId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, active: true, createdAt: true, lastSeenAt: true } });
  res.json({ agents });
});

app.post('/api/organizations/:organizationId/print-agents', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  const parsed = z.object({ name: z.string().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rawToken = randomToken();
  const agent = await prisma.printAgentCredential.create({ data: { organizationId: req.params.organizationId, name: parsed.data.name.trim(), tokenHash: tokenHash(rawToken) } });
  res.status(201).json({ agent: { id: agent.id, name: agent.name, active: agent.active }, token: rawToken });
});

app.get('/api/print-agent/check', async (req, res) => {
  const organizationId = String(req.header('x-organization-id') || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'X-Organization-ID is required' });
  const agent = await printAgentFromRequest(req);
  if (!agent) return res.status(401).json({ error: 'Invalid or revoked Print Agent token' });
  if (agent.organizationId !== organizationId) return res.status(403).json({ error: 'Print Agent token does not belong to this organization' });
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  res.json({ ok: true, organization, agent: { id: agent.id, name: agent.name } });
});

app.post('/api/print-agents/:agentId/revoke', async (req, res) => {
  const agent = await prisma.printAgentCredential.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: 'Print agent not found' });
  const actor = await requireOrganizationUser(req, res, agent.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;
  await prisma.printAgentCredential.update({ where: { id: agent.id }, data: { active: false } });
  res.json({ ok: true });
});

app.get('/api/organizations/:organizationId/alerts', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const alerts = await prisma.dispatcherAlert.findMany({ where: { organizationId: req.params.organizationId, acknowledgedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ alerts });
});

app.post('/api/alerts/:alertId/acknowledge', async (req, res) => {
  const alert = await prisma.dispatcherAlert.findUnique({ where: { id: req.params.alertId } });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const actor = await requireOrganizationUser(req, res, alert.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const updated = await prisma.dispatcherAlert.update({ where: { id: alert.id }, data: { acknowledgedAt: new Date() } });
  res.json(updated);
});


app.get('/api/drivers/:driverId/devices', async (req, res) => {
  const actor = await requireDispatcher(req, res);
  if (!actor) return;
  const driver = await prisma.driver.findUnique({ where: { id: req.params.driverId } });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!DEV_AUTH_BYPASS && actor.organizationId !== driver.organizationId) return res.status(403).json({ error: 'Driver belongs to another organization' });
  const devices = await prisma.driverDevice.findMany({ where: { driverId: driver.id }, orderBy: { enrolledAt: 'desc' }, select: { id: true, name: true, active: true, enrolledAt: true, expiresAt: true, lastSeenAt: true } });
  res.json({ devices });
});

app.post('/api/devices/:deviceId/revoke', async (req, res) => {
  const actor = await requireDispatcher(req, res);
  if (!actor) return;
  const device = await prisma.driverDevice.findUnique({ where: { id: req.params.deviceId }, include: { driver: true } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (!DEV_AUTH_BYPASS && actor.organizationId !== device.driver.organizationId) return res.status(403).json({ error: 'Device belongs to another organization' });
  await prisma.driverDevice.update({ where: { id: device.id }, data: { active: false } });
  res.json({ ok: true });
});

app.post('/api/drivers/:driverId/enrollment-codes', async (req, res) => {
  const actor = await requireDispatcher(req, res);
  if (!actor) return;
  const driver = await prisma.driver.findUnique({ where: { id: req.params.driverId } });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (!DEV_AUTH_BYPASS && actor.organizationId !== driver.organizationId) return res.status(403).json({ error: 'Driver belongs to another organization' });
  const rawCode = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
  await prisma.deviceEnrollmentCode.deleteMany({ where: { driverId: driver.id, usedAt: null } });
  await prisma.deviceEnrollmentCode.create({ data: { driverId: driver.id, codeHash: tokenHash(rawCode), expiresAt } });
  res.status(201).json({ code: rawCode, expiresAt, driver: { id: driver.id, displayName: driver.displayName } });
});

app.post('/api/device/enroll', async (req, res) => {
  const parsed = z.object({ code: z.string().min(4), deviceName: z.string().max(80).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const enrollment = await prisma.deviceEnrollmentCode.findUnique({ where: { codeHash: tokenHash(parsed.data.code.trim()) }, include: { driver: true } });
  if (!enrollment || enrollment.usedAt || enrollment.expiresAt <= new Date()) return res.status(400).json({ error: 'Enrollment code is invalid or expired' });
  const rawToken = randomToken();
  const deviceExpiresAt = new Date(Date.now() + DEVICE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const device = await prisma.driverDevice.create({ data: {
    driverId: enrollment.driverId,
    name: parsed.data.deviceName || null,
    tokenHash: tokenHash(rawToken),
    expiresAt: deviceExpiresAt
  }});
  await prisma.deviceEnrollmentCode.update({ where: { id: enrollment.id }, data: { usedAt: new Date() } });
  res.status(201).json({ token: rawToken, expiresAt: deviceExpiresAt, device: { id: device.id, name: device.name }, driver: { id: enrollment.driver.id, displayName: enrollment.driver.displayName } });
});

app.post('/api/device/logout', async (req, res) => {
  const raw = bearerToken(req);
  if (raw) await prisma.driverDevice.updateMany({ where: { tokenHash: tokenHash(raw) }, data: { active: false } });
  res.json({ ok: true });
});

app.get('/api/device/me', async (req, res) => {
  const device = await deviceFromRequest(req);
  if (!device) return res.status(401).json({ error: 'Device not enrolled' });
  res.json({ device: { id: device.id, name: device.name, lastSeenAt: device.lastSeenAt }, driver: { id: device.driver.id, displayName: device.driver.displayName, phone: device.driver.phone }, organization: { id: device.driver.organization.id, name: device.driver.organization.name, dispatcherPhone: device.driver.organization.dispatcherPhone } });
});

app.get('/api/driver/today', async (req, res) => {
  const device = await requireDriverDevice(req, res);
  if (!device) return;
  if (DEV_AUTH_BYPASS) return res.status(400).json({ error: 'Use /api/drivers/:driverId/today when DEV_AUTH_BYPASS=true' });
  const { start, end } = localDayRange();
  const route = await prisma.route.findFirst({
    where: { driverId: device.driverId, routeDate: { gte: start, lt: end } },
    include: {
      driver: true,
      organization: { select: { dispatcherPhone: true } },
      stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }
    }
  });
  res.json({ route, eta: route ? routeEta(route) : null });
});

app.get('/api/driver/returns', async (req, res) => {
  const device = await requireDriverDevice(req, res);
  if (!device) return;
  if (DEV_AUTH_BYPASS) return res.status(400).json({ error: 'Use /api/drivers/:driverId/returns when DEV_AUTH_BYPASS=true' });
  const deliveries = await prisma.delivery.findMany({ where: { driverId: device.driverId, status: DeliveryStatus.RETURN_REQUIRED }, orderBy: { updatedAt: 'desc' } });
  res.json({ deliveries });
});

app.post('/api/organizations', async (req, res) => {
  if (!DEV_AUTH_BYPASS) {
    const user = await userFromRequest(req);
    if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Super admin required' });
  }
  const parsed = z.object({ name: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const organization = await prisma.organization.create({ data: { name: parsed.data.name } });
  res.status(201).json(organization);
});

app.get('/api/organizations/:organizationId/drivers', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
  const drivers = await prisma.driver.findMany({
    where: { organizationId: req.params.organizationId, ...(includeInactive ? {} : { active: true }) },
    include: { aliases: true },
    orderBy: [{ active: 'desc' }, { displayName: 'asc' }]
  });
  res.json({ drivers });
});

app.post('/api/organizations/:organizationId/drivers', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const parsed = z.object({
    displayName: z.string().min(1),
    phone: z.string().optional(),
    aliases: z.array(z.string().min(1)).default([])
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const driver = await prisma.driver.create({
    data: {
      organizationId: req.params.organizationId,
      displayName: parsed.data.displayName,
      phone: parsed.data.phone,
      aliases: {
        create: [...new Set(parsed.data.aliases.map(a => a.trim()).filter(Boolean))].map(alias => ({ alias }))
      }
    },
    include: { aliases: true }
  });
  res.status(201).json(driver);
});


app.patch('/api/drivers/:driverId', async (req, res) => {
  const existing = await prisma.driver.findUnique({ where: { id: req.params.driverId }, include: { aliases: true } });
  if (!existing) return res.status(404).json({ error: 'Driver not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;

  const parsed = z.object({
    displayName: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional().nullable(),
    aliases: z.array(z.string().trim().min(1)).optional(),
    active: z.boolean().optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.active === false) {
    const activeRoute = await prisma.route.findFirst({
      where: { driverId: existing.id, completedAt: null },
      select: { id: true }
    });
    if (activeRoute) return res.status(409).json({ error: 'Driver has an active/planned route. Complete or remove the route before deactivating this driver.' });
  }

  const aliases = parsed.data.aliases == null
    ? null
    : [...new Set(parsed.data.aliases.map(a => a.trim()).filter(Boolean))];

  const driver = await prisma.$transaction(async tx => {
    if (aliases) {
      await tx.driverAlias.deleteMany({ where: { driverId: existing.id } });
      if (aliases.length) {
        await tx.driverAlias.createMany({ data: aliases.map(alias => ({ driverId: existing.id, alias })) });
      }
    }
    const updated = await tx.driver.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {})
      },
      include: { aliases: true }
    });
    if (parsed.data.active === false) {
      await tx.driverDevice.updateMany({ where: { driverId: existing.id, active: true }, data: { active: false } });
      await tx.deviceEnrollmentCode.deleteMany({ where: { driverId: existing.id, usedAt: null } });
    }
    return updated;
  });

  res.json({ driver });
});

app.post('/api/drivers/:driverId/deactivate', async (req, res) => {
  const existing = await prisma.driver.findUnique({ where: { id: req.params.driverId } });
  if (!existing) return res.status(404).json({ error: 'Driver not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const activeRoute = await prisma.route.findFirst({ where: { driverId: existing.id, completedAt: null }, select: { id: true } });
  if (activeRoute) return res.status(409).json({ error: 'Driver has an active/planned route. Complete or remove the route first.' });
  await prisma.$transaction([
    prisma.driver.update({ where: { id: existing.id }, data: { active: false } }),
    prisma.driverDevice.updateMany({ where: { driverId: existing.id }, data: { active: false } }),
    prisma.deviceEnrollmentCode.deleteMany({ where: { driverId: existing.id, usedAt: null } })
  ]);
  res.json({ ok: true });
});

app.post('/api/drivers/:driverId/reactivate', async (req, res) => {
  const existing = await prisma.driver.findUnique({ where: { id: req.params.driverId } });
  if (!existing) return res.status(404).json({ error: 'Driver not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const driver = await prisma.driver.update({ where: { id: existing.id }, data: { active: true }, include: { aliases: true } });
  res.json({ driver });
});


function localDayRange(date = new Date()) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}

function addressKey(d: { address1: string; address2?: string | null; city: string; state: string; postalCode: string }) {
  const normalize = (v?: string | null) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Physical-stop grouping intentionally ignores address2/unit so multiple patients
  // in the same building are handled as one stop.
  return [normalize(d.address1), normalize(d.city), normalize(d.state), normalize(d.postalCode)].join('|');
}

function routeEta(route: any) {
  const stops = route.stops || [];
  const remaining = stops.filter((s: any) => !s.completedAt);
  const remainingDrivingMinutes = remaining.reduce((sum: number, s: any, index: number) => {
    if (index === 0 && s.arrivedAt) return sum;
    return sum + Number(s.driveMinutesFromPrevious || 0);
  }, 0);
  const remainingServiceMinutes = remaining.length * STOP_SERVICE_MINUTES;
  const remainingMinutes = remainingDrivingMinutes + remainingServiceMinutes;
  const estimatedFinishAt = new Date(Date.now() + remainingMinutes * 60_000);
  return { remainingStops: remaining.length, remainingDrivingMinutes, remainingServiceMinutes, remainingMinutes, estimatedFinishAt };
}

app.post('/api/drivers/:driverId/routes/optimize', async (req, res) => {
  try {
    const parsed = z.object({
      routeDate: z.string().datetime().optional(),
      origin: z.object({ latitude: z.number(), longitude: z.number() }),
      forceRebuild: z.boolean().default(false)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const driver = await prisma.driver.findUnique({ where: { id: req.params.driverId } });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const actor = await requireOrganizationUser(req, res, driver.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
    if (!actor) return;
    const routeDate = parsed.data.routeDate ? new Date(parsed.data.routeDate) : new Date();
    const { start, end } = localDayRange(routeDate);

    const existing = await prisma.route.findFirst({
      where: { driverId: driver.id, routeDate: { gte: start, lt: end } },
      include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } } }
    });
    if (existing && !parsed.data.forceRebuild) return res.status(409).json({ error: 'ROUTE_ALREADY_EXISTS', route: existing });
    if (existing?.startedAt) return res.status(409).json({ error: 'Cannot rebuild a route that has already started' });
    if (existing && parsed.data.forceRebuild) await prisma.route.delete({ where: { id: existing.id } });

    const deliveries = await prisma.delivery.findMany({
      where: {
        driverId: driver.id,
        status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PENDING] },
        routeStopId: null,
        createdAt: { gte: start, lt: end }
      },
      orderBy: { createdAt: 'asc' },
      include: { facility: true }
    });
    if (!deliveries.length) return res.status(400).json({ error: 'No un-routed deliveries assigned to this driver' });

    const groups = new Map<string, typeof deliveries>();
    for (const d of deliveries) {
      const key = addressKey(d);
      groups.set(key, [...(groups.get(key) || []), d]);
    }

    const stopDrafts: any[] = [];
    for (const ds of groups.values()) {
      const first = ds[0];
      let latitude = first.latitude, longitude = first.longitude;
      if (latitude == null || longitude == null) {
        const address = [first.address1, first.address2, first.city, first.state, first.postalCode].filter(Boolean).join(', ');
        const geocoded = await geocodeAddress(address);
        if (geocoded) {
          latitude = geocoded.latitude; longitude = geocoded.longitude;
          await prisma.delivery.updateMany({ where: { id: { in: ds.map(d => d.id) } }, data: { latitude, longitude } });
        }
      }
      stopDrafts.push({
        id: addressKey(first),
        deliveries: ds,
        facilityName: first.facility?.name || null,
        address1: first.address1, address2: first.address2, city: first.city, state: first.state, postalCode: first.postalCode,
        latitude, longitude
      });
    }

    const missingCoordinates = stopDrafts.filter(s => s.latitude == null || s.longitude == null);
    if (missingCoordinates.length) {
      return res.status(422).json({
        error: 'MISSING_COORDINATES',
        message: 'Some stops could not be geocoded. Configure GEOCODER_BASE_URL or add coordinates manually.',
        stops: missingCoordinates.map(s => ({ address1: s.address1, city: s.city, state: s.state, postalCode: s.postalCode }))
      });
    }

    const candidates = stopDrafts.map(s => ({ id: s.id, latitude: s.latitude as number, longitude: s.longitude as number }));
    let matrix: number[][] | null = null;
    try { matrix = await roadDurationMatrix([parsed.data.origin, ...candidates]); } catch (e) { console.warn('Road matrix unavailable, using local fallback', e); }
    const nearest = nearestNeighborOrder(candidates, parsed.data.origin, matrix);
    const ordered = improveRoadOrder(nearest, candidates, matrix);
    const byId = new Map(stopDrafts.map(s => [s.id, s]));
    const orderedDrafts = ordered.map(o => byId.get(o.id)!);

    let current = parsed.data.origin;
    let plannedDrivingMinutes = 0;
    const legs = orderedDrafts.map((s, idx) => {
      let minutes: number;
      if (matrix) {
        const candidateIndex = candidates.findIndex(c => c.id === s.id) + 1;
        const currentIndex = idx === 0 ? 0 : candidates.findIndex(c => c.id === orderedDrafts[idx - 1].id) + 1;
        minutes = matrix[currentIndex]?.[candidateIndex] ?? estimatedDriveMinutes(current, s);
      } else minutes = estimatedDriveMinutes(current, s);
      plannedDrivingMinutes += minutes;
      current = s;
      return Math.max(1, Math.round(minutes));
    });

    const route = await prisma.route.create({
      data: {
        organizationId: driver.organizationId,
        driverId: driver.id,
        routeDate,
        plannedDrivingMinutes,
        plannedStopMinutes: orderedDrafts.length * STOP_SERVICE_MINUTES,
        stops: {
          create: orderedDrafts.map((s, i) => ({
            sequence: i + 1,
            facilityName: s.facilityName,
            address1: s.address1, address2: s.address2, city: s.city, state: s.state, postalCode: s.postalCode,
            latitude: s.latitude, longitude: s.longitude,
            plannedMinutes: STOP_SERVICE_MINUTES,
            driveMinutesFromPrevious: legs[i],
            deliveries: { connect: s.deliveries.map((d: any) => ({ id: d.id })) }
          }))
        }
      },
      include: { driver: true, stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } } }
    });
    await prisma.delivery.updateMany({ where: { id: { in: deliveries.map(d => d.id) } }, data: { status: DeliveryStatus.ASSIGNED } });
    res.status(201).json({ route, eta: routeEta(route), routingMode: matrix ? 'ROAD_MATRIX_2OPT' : 'LOCAL_DISTANCE_FALLBACK' });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Failed to optimize route', detail: error?.message || String(error) });
  }
});

app.post('/api/routes/:id/start', async (req, res) => {
  if (!(await ensureRouteAccess(req, res, req.params.id))) return;
  const route = await prisma.route.update({ where: { id: req.params.id }, data: { startedAt: new Date() }, include: { stops: { orderBy: { sequence: 'asc' } } } });
  res.json({ route, eta: routeEta(route) });
});

app.get('/api/organizations/:organizationId/dispatcher/today', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const { start, end } = localDayRange();
  const routes = await prisma.route.findMany({
    where: { organizationId: req.params.organizationId, routeDate: { gte: start, lt: end } },
    include: { driver: true, stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } } },
    orderBy: { createdAt: 'asc' }
  });
  const routeCards = routes.map((route: any) => {
    const eta = routeEta(route);
    const deliveries = route.stops.flatMap((s: any) => s.deliveries);
    const completedDeliveries = deliveries.filter((d: any) => d.status === DeliveryStatus.DELIVERED).length;
    const exceptions = deliveries.filter((d: any) => [DeliveryStatus.EXCEPTION, DeliveryStatus.RETURN_REQUIRED].includes(d.status)).length;
    const currentStop = route.stops.find((s: any) => !s.completedAt) || null;
    const currentVerified = currentStop ? currentStop.deliveries.filter((d: any) => !!d.barcodeVerifiedAt).length : 0;
    return {
      id: route.id,
      driver: { id: route.driver.id, displayName: route.driver.displayName },
      startedAt: route.startedAt, completedAt: route.completedAt,
      stops: route.stops.length,
      remainingStops: eta.remainingStops,
      deliveries: deliveries.length,
      completedDeliveries,
      exceptions,
      plannedDrivingMinutes: route.plannedDrivingMinutes,
      plannedServiceMinutes: route.plannedStopMinutes,
      plannedTotalMinutes: route.plannedDrivingMinutes + route.plannedStopMinutes,
      estimatedFinishAt: eta.estimatedFinishAt,
      remainingMinutes: eta.remainingMinutes,
      currentStop: currentStop ? {
        id: currentStop.id,
        sequence: currentStop.sequence,
        facilityName: currentStop.facilityName,
        address1: currentStop.address1,
        city: currentStop.city,
        verified: currentVerified,
        expected: currentStop.deliveries.length,
        arrivedAt: currentStop.arrivedAt
      } : null
    };
  });
  const [activeDriverCount, todayDeliveries] = await Promise.all([
    prisma.driver.count({ where: { organizationId: req.params.organizationId, active: true } }),
    prisma.delivery.findMany({
      where: { organizationId: req.params.organizationId, createdAt: { gte: start, lt: end } },
      select: { status: true }
    })
  ]);
  const completedToday = todayDeliveries.filter(d => d.status === DeliveryStatus.DELIVERED).length;
  const exceptionsToday = todayDeliveries.filter(d => d.status === DeliveryStatus.EXCEPTION || d.status === DeliveryStatus.RETURN_REQUIRED).length;

  res.json({
    asOf: new Date(),
    totals: {
      drivers: activeDriverCount,
      deliveries: todayDeliveries.length,
      completed: completedToday,
      exceptions: exceptionsToday
    },
    routes: routeCards
  });
});

app.get('/api/routes/:id/summary', async (req, res) => {
  if (!(await ensureRouteAccess(req, res, req.params.id))) return;
  const route = await prisma.route.findUnique({
    where: { id: req.params.id },
    include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }, driver: true }
  });
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const remainingStops = route.stops.filter(s => !s.completedAt).length;
  const remainingServiceMinutes = remainingStops * STOP_SERVICE_MINUTES;
  const openStops = route.stops.filter(s => !s.completedAt);
  const remainingDrivingMinutes = openStops.reduce((n, s, index) => n + (index === 0 && s.arrivedAt ? 0 : s.driveMinutesFromPrevious), 0);
  const estimatedFinishAt = new Date(Date.now() + (remainingDrivingMinutes + remainingServiceMinutes) * 60000);
  const plannedTotalMinutes = route.plannedDrivingMinutes + route.stops.length * STOP_SERVICE_MINUTES;
  const completedDeliveries = route.stops.flatMap(s => s.deliveries).filter(d => d.status === DeliveryStatus.DELIVERED).length;
  const totalDeliveries = route.stops.reduce((n, s) => n + s.deliveries.length, 0);

  res.json({
    routeId: route.id,
    driver: route.driver.displayName,
    stops: route.stops.length,
    remainingStops,
    totalDeliveries,
    completedDeliveries,
    plannedDrivingMinutes: route.plannedDrivingMinutes,
    plannedServiceMinutes: route.stops.length * STOP_SERVICE_MINUTES,
    plannedTotalMinutes,
    remainingServiceMinutes,
    remainingDrivingMinutes,
    estimatedFinishAt,
    stopServiceRuleMinutes: STOP_SERVICE_MINUTES
  });
});

app.get('/api/drivers/:driverId/today', async (req, res) => {
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+1);
  const route = await prisma.route.findFirst({
    where: { driverId: req.params.driverId, routeDate: { gte: start, lt: end } },
    include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }, driver: true, organization: { select: { dispatcherPhone: true } } }
  });
  res.json({ route });
});

const scanSchema = z.object({
  scannedValue: z.string().min(1),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

app.post('/api/deliveries/:id/scan', async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, delivery.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const matched = !!delivery.barcodeValue && delivery.barcodeValue === parsed.data.scannedValue;
  const scan = await prisma.barcodeScan.create({ data: { deliveryId: delivery.id, matched, ...parsed.data } });
  if (matched) await prisma.delivery.update({ where: { id: delivery.id }, data: { barcodeVerifiedAt: new Date() } });
  res.json({ matched, scanId: scan.id, expected: delivery.barcodeValue });
});

const outcomeSchema = z.object({
  outcome: z.enum(['DELIVERED','RECIPIENT_NOT_AVAILABLE','REFUSED','PACKAGE_NOT_PROVIDED','UNABLE_TO_ACCESS','WRONG_PACKAGE','OTHER']),
  recipientName: z.string().optional(),
  relationship: z.enum(['SELF','CAREGIVER','PARENT','SIBLING','CHILD','FACILITY_STAFF','OTHER']).optional(),
  notes: z.string().optional()
});

app.post('/api/deliveries/:id/outcome', async (req, res) => {
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existingDelivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!existingDelivery) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existingDelivery.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const outcome = parsed.data.outcome as DeliveryOutcome;
  const isDelivered = outcome === DeliveryOutcome.DELIVERED;
  const needsReturn = ([
    DeliveryOutcome.RECIPIENT_NOT_AVAILABLE,
    DeliveryOutcome.REFUSED,
    DeliveryOutcome.UNABLE_TO_ACCESS,
    DeliveryOutcome.WRONG_PACKAGE
  ] as DeliveryOutcome[]).includes(outcome);

  const delivery = await prisma.delivery.update({
    where: { id: req.params.id },
    data: {
      outcome,
      status: isDelivered ? DeliveryStatus.DELIVERED : needsReturn ? DeliveryStatus.RETURN_REQUIRED : DeliveryStatus.EXCEPTION,
      recipientName: parsed.data.recipientName,
      relationship: parsed.data.relationship,
      exceptionNotes: parsed.data.notes,
      completedAt: new Date()
    }
  });
  await prisma.auditEvent.create({ data: { deliveryId: delivery.id, type: 'DELIVERY_OUTCOME', details: parsed.data } });
  if (!isDelivered) await createAlert(delivery.organizationId, 'DELIVERY_EXCEPTION', 'Delivery exception', `${delivery.patientName}: ${outcome.replaceAll('_',' ')}`, { severity: needsReturn ? 'WARNING' : 'INFO', deliveryId: delivery.id });
  res.json(delivery);
});

async function findDriverByParsedAlias(organizationId: string, raw?: string, normalized?: string) {
  const candidates = [...new Set([raw, normalized, raw?.split('/').at(-1)].filter(Boolean).map(v => String(v).trim()))];
  for (const candidate of candidates) {
    const alias = await prisma.driverAlias.findFirst({
      where: {
        driver: { organizationId, active: true },
        alias: { equals: candidate, mode: 'insensitive' }
      },
      include: { driver: true }
    });
    if (alias) return alias.driver;

    const driver = await prisma.driver.findFirst({
      where: {
        organizationId,
        active: true,
        displayName: { equals: candidate, mode: 'insensitive' }
      }
    });
    if (driver) return driver;
  }
  return null;
}

app.post('/api/ingest/pdf', upload.single('file'), async (req, res) => {
  try {
    const organizationId = String(req.body.organizationId || req.header('x-organization-id') || '').trim();
    const source = String(req.body.source || req.header('x-ingest-source') || 'MANUAL_UPLOAD').trim();
    if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
    const agent = await printAgentFromRequest(req);
    if (source === 'PRINT_AGENT') {
      if (!DEV_AUTH_BYPASS && (!agent || agent.organizationId !== organizationId)) return res.status(401).json({ error: 'Valid Print Agent credential required' });
    } else {
      const actor = await requireOrganizationUser(req, res, organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
      if (!actor) return;
    }
    if (!req.file) return res.status(400).json({ error: 'PDF file is required in multipart field "file"' });
    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(415).json({ error: 'Only PDF receipts are supported' });
    }

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) return res.status(404).json({ error: 'Organization not found' });

    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingHash = await prisma.receiptImport.findFirst({
      where: { organizationId, sha256 },
      include: { delivery: true },
      orderBy: { createdAt: 'desc' }
    });
    if (existingHash) {
      return res.status(200).json({
        duplicate: true,
        reason: 'SAME_PDF_ALREADY_IMPORTED',
        import: existingHash,
        delivery: existingHash.delivery
      });
    }

    const parsed = await parseReceiptPdf(req.file.buffer);
    const stored = await savePdf(req.file.buffer, organizationId, parsed.logNumber || req.file.originalname);
    const driver = await findDriverByParsedAlias(organizationId, parsed.driverRaw, parsed.driverNormalized);

    const sameLog = parsed.logNumber ? await prisma.delivery.findFirst({
      where: { organizationId, externalLogNumber: parsed.logNumber },
      orderBy: { createdAt: 'desc' }
    }) : null;

    // Reprints of an existing log are retained as import versions and never silently replace a completed/signed delivery.
    if (sameLog) {
      const receiptImport = await prisma.receiptImport.create({
        data: {
          organizationId,
          source,
          originalFilename: req.file.originalname,
          objectKey: stored.objectKey,
          sha256,
          template: parsed.template,
          pageCount: parsed.pageCount,
          logNumber: parsed.logNumber,
          parsedDriverRaw: parsed.driverRaw,
          parsedDriverAlias: parsed.driverNormalized,
          parsedAddress: [parsed.address1, parsed.city, parsed.state, parsed.postalCode].filter(Boolean).join(', '),
          parsedJson: parsed as any,
          status: sameLog.status === DeliveryStatus.DELIVERED ? 'REPRINT_AFTER_COMPLETION' : 'REPRINT',
          deliveryId: sameLog.id
        }
      });
      await prisma.auditEvent.create({
        data: {
          deliveryId: sameLog.id,
          type: 'RECEIPT_REPRINT_IMPORTED',
          details: { receiptImportId: receiptImport.id, originalFilename: req.file.originalname, source }
        }
      });
      return res.status(200).json({ duplicate: true, reason: 'LOG_ALREADY_EXISTS', import: receiptImport, delivery: sameLog, parsed });
    }

    const patientName = parsed.patientNames[0] || 'Needs Review';
    const hasAddress = !!(parsed.address1 && parsed.city && parsed.state && parsed.postalCode);
    const delivery = await prisma.delivery.create({
      data: {
        organizationId,
        externalLogNumber: parsed.logNumber,
        patientName,
        address1: parsed.address1 || 'Needs Review',
        city: parsed.city || 'Needs Review',
        state: parsed.state || 'NA',
        postalCode: parsed.postalCode || '00000',
        driverId: driver?.id,
        status: driver ? DeliveryStatus.ASSIGNED : DeliveryStatus.PENDING,
        barcodeValue: parsed.barcodeValue,
        originalPdfObjectKey: stored.objectKey
      }
    });

    const receiptImport = await prisma.receiptImport.create({
      data: {
        organizationId,
        source,
        originalFilename: req.file.originalname,
        objectKey: stored.objectKey,
        sha256,
        template: parsed.template,
        pageCount: parsed.pageCount,
        logNumber: parsed.logNumber,
        parsedDriverRaw: parsed.driverRaw,
        parsedDriverAlias: parsed.driverNormalized,
        parsedAddress: [parsed.address1, parsed.city, parsed.state, parsed.postalCode].filter(Boolean).join(', '),
        parsedJson: parsed as any,
        status: parsed.warnings.length || !hasAddress || !driver ? 'NEEDS_REVIEW' : 'READY',
        deliveryId: delivery.id
      }
    });

    await prisma.auditEvent.create({
      data: {
        deliveryId: delivery.id,
        type: 'RECEIPT_IMPORTED',
        details: {
          receiptImportId: receiptImport.id,
          source,
          template: parsed.template,
          driverAutoAssigned: !!driver,
          detectedDriver: parsed.driverRaw,
          warnings: parsed.warnings
        }
      }
    });

    res.status(201).json({
      duplicate: false,
      import: receiptImport,
      delivery,
      autoAssignedDriver: driver ? { id: driver.id, displayName: driver.displayName } : null,
      parsed
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Failed to ingest receipt PDF', detail: error?.message || String(error) });
  }
});

app.get('/api/organizations/:organizationId/imports', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const imports = await prisma.receiptImport.findMany({
    where: { organizationId: req.params.organizationId },
    include: { delivery: { include: { driver: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json({ imports });
});


app.get('/api/route-stops/:id', async (req, res) => {
  if (!(await ensureStopBelongsToDevice(req, res, req.params.id))) return;
  const stop = await prisma.routeStop.findUnique({
    where: { id: req.params.id },
    include: {
      route: { include: { driver: true } },
      deliveries: { orderBy: { patientName: 'asc' } }
    }
  });
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  const accounted = stop.deliveries.filter(d => d.outcome !== DeliveryOutcome.PENDING).length;
  const verified = stop.deliveries.filter(d => !!d.barcodeVerifiedAt).length;
  res.json({
    stop,
    progress: {
      expected: stop.deliveries.length,
      verified,
      accounted,
      unaccounted: stop.deliveries.length - accounted
    }
  });
});

app.post('/api/route-stops/:id/arrive', async (req, res) => {
  if (!(await ensureStopBelongsToDevice(req, res, req.params.id))) return;
  const parsed = z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const stop = await prisma.routeStop.update({
    where: { id: req.params.id },
    data: { arrivedAt: new Date() },
    include: { deliveries: true }
  });
  await Promise.all(stop.deliveries.map(delivery => prisma.auditEvent.create({
    data: { deliveryId: delivery.id, type: 'STOP_ARRIVED', details: parsed.data }
  })));
  res.json(stop);
});

app.post('/api/route-stops/:id/scan', async (req, res) => {
  if (!(await ensureStopBelongsToDevice(req, res, req.params.id))) return;
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const stop = await prisma.routeStop.findUnique({
    where: { id: req.params.id },
    include: { deliveries: true }
  });
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  const delivery = stop.deliveries.find(d => d.barcodeValue === parsed.data.scannedValue);
  if (!delivery) {
    const scan = await prisma.barcodeScan.create({
      data: { scannedValue: parsed.data.scannedValue, matched: false, latitude: parsed.data.latitude, longitude: parsed.data.longitude }
    });
    return res.status(409).json({
      matched: false,
      scanId: scan.id,
      error: 'WRONG_DELIVERY',
      message: 'This package does not belong to this stop.'
    });
  }

  const alreadyVerified = !!delivery.barcodeVerifiedAt;
  const scan = await prisma.barcodeScan.create({
    data: { deliveryId: delivery.id, scannedValue: parsed.data.scannedValue, matched: true, latitude: parsed.data.latitude, longitude: parsed.data.longitude }
  });
  if (!alreadyVerified) {
    await prisma.delivery.update({ where: { id: delivery.id }, data: { barcodeVerifiedAt: new Date() } });
    await prisma.auditEvent.create({ data: { deliveryId: delivery.id, type: 'PACKAGE_VERIFIED', details: { scanId: scan.id } } });
  }

  const verifiedCount = stop.deliveries.filter(d => d.id === delivery.id ? true : !!d.barcodeVerifiedAt).length;
  res.json({
    matched: true,
    duplicateScan: alreadyVerified,
    delivery: { id: delivery.id, patientName: delivery.patientName, logNumber: delivery.externalLogNumber },
    verifiedCount,
    expectedCount: stop.deliveries.length,
    allVerified: verifiedCount === stop.deliveries.length
  });
});

const stopCompletionSchema = z.object({
  recipientName: z.string().min(1).max(120).optional(),
  relationship: z.enum(['SELF','CAREGIVER','PARENT','SIBLING','CHILD','FACILITY_STAFF','OTHER']).optional(),
  signatureDataUrl: z.string().optional(),
  deliveredIds: z.array(z.string()).default([]),
  exceptions: z.array(z.object({
    deliveryId: z.string(),
    outcome: z.enum(['RECIPIENT_NOT_AVAILABLE','REFUSED','PACKAGE_NOT_PROVIDED','UNABLE_TO_ACCESS','WRONG_PACKAGE','OTHER']),
    notes: z.string().max(500).optional(),
    recipientName: z.string().max(120).optional(),
    relationship: z.enum(['SELF','CAREGIVER','PARENT','SIBLING','CHILD','FACILITY_STAFF','OTHER']).optional()
  })).default([]),
  notes: z.string().max(500).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

function decodePngDataUrl(value: string) {
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Signature must be a PNG data URL');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('Invalid signature image');
  return buffer;
}

app.post('/api/route-stops/:id/complete', async (req, res) => {
  if (!(await ensureStopBelongsToDevice(req, res, req.params.id))) return;
  try {
    const parsed = stopCompletionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const stop = await prisma.routeStop.findUnique({
      where: { id: req.params.id },
      include: { route: { include: { driver: true } }, deliveries: true }
    });
    if (!stop) return res.status(404).json({ error: 'Stop not found' });

    const expectedIds = new Set(stop.deliveries.map(d => d.id));
    const deliveredIds = new Set(parsed.data.deliveredIds);
    const exceptionMap = new Map(parsed.data.exceptions.map(e => [e.deliveryId, e]));
    const accountedIds = new Set([...deliveredIds, ...exceptionMap.keys()]);

    const unknown = [...accountedIds].filter(id => !expectedIds.has(id));
    if (unknown.length) return res.status(400).json({ error: 'Delivery does not belong to this stop', deliveryIds: unknown });
    const missing = [...expectedIds].filter(id => !accountedIds.has(id));
    if (missing.length) return res.status(409).json({ error: 'UNACCOUNTED_DELIVERIES', deliveryIds: missing });

    const delivered = stop.deliveries.filter(d => deliveredIds.has(d.id));
    const unverified = delivered.filter(d => !d.barcodeVerifiedAt);
    if (unverified.length) {
      return res.status(409).json({
        error: 'DELIVERED_PACKAGE_NOT_VERIFIED',
        deliveryIds: unverified.map(d => d.id)
      });
    }

    let signaturePng: Buffer | null = null;
    let sharedSignatureObjectKey: string | null = null;
    if (delivered.length) {
      if (!parsed.data.recipientName || !parsed.data.relationship || !parsed.data.signatureDataUrl) {
        return res.status(400).json({ error: 'Recipient name, relationship and signature are required for delivered packages.' });
      }
      signaturePng = decodePngDataUrl(parsed.data.signatureDataUrl);
      const signatureStored = await savePng(signaturePng, stop.route.organizationId, `stop-${stop.id}-signature`);
      sharedSignatureObjectKey = signatureStored.objectKey;
    }

    const deliveredAt = new Date();
    const results: any[] = [];

    for (const delivery of delivered) {
      let signedPdfObjectKey: string | null = null;
      if (delivery.originalPdfObjectKey && signaturePng) {
        const originalPdf = await readObject(delivery.originalPdfObjectKey);
        const receiptImport = await prisma.receiptImport.findFirst({
          where: { deliveryId: delivery.id }, orderBy: { createdAt: 'asc' }
        });
        if (receiptImport?.template === 'SAINT_MARY_RX_DELIVERY') {
          const signedPdf = await stampSaintMaryReceipt(originalPdf, {
            recipientName: parsed.data.recipientName!,
            relationship: parsed.data.relationship!,
            deliveredAt,
            driverName: stop.route.driver.displayName,
            notes: parsed.data.notes,
            signaturePng
          });
          const stored = await savePdf(signedPdf, delivery.organizationId, `signed-${delivery.externalLogNumber || delivery.id}.pdf`, 'signed');
          signedPdfObjectKey = stored.objectKey;
        }
      }

      const updated = await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          outcome: DeliveryOutcome.DELIVERED,
          status: DeliveryStatus.DELIVERED,
          recipientName: parsed.data.recipientName,
          relationship: parsed.data.relationship as any,
          signatureObjectKey: sharedSignatureObjectKey,
          signedPdfObjectKey,
          completedAt: deliveredAt,
          exceptionNotes: parsed.data.notes
        }
      });
      await prisma.auditEvent.create({
        data: {
          deliveryId: delivery.id,
          type: 'DELIVERED_AND_SIGNED',
          details: { stopId: stop.id, latitude: parsed.data.latitude, longitude: parsed.data.longitude, signedPdfCreated: !!signedPdfObjectKey }
        }
      });
      results.push(updated);
    }

    for (const delivery of stop.deliveries.filter(d => exceptionMap.has(d.id))) {
      const exception = exceptionMap.get(delivery.id)!;
      const outcome = exception.outcome as DeliveryOutcome;
      const needsReturn = ([
        DeliveryOutcome.RECIPIENT_NOT_AVAILABLE,
        DeliveryOutcome.REFUSED,
        DeliveryOutcome.UNABLE_TO_ACCESS,
        DeliveryOutcome.WRONG_PACKAGE
      ] as DeliveryOutcome[]).includes(outcome);
      const updated = await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          outcome,
          status: needsReturn ? DeliveryStatus.RETURN_REQUIRED : DeliveryStatus.EXCEPTION,
          recipientName: exception.recipientName,
          relationship: exception.relationship as any,
          exceptionNotes: exception.notes,
          completedAt: deliveredAt
        }
      });
      await prisma.auditEvent.create({
        data: {
          deliveryId: delivery.id,
          type: 'DELIVERY_EXCEPTION',
          details: { ...exception, stopId: stop.id, latitude: parsed.data.latitude, longitude: parsed.data.longitude }
        }
      });
      await createAlert(delivery.organizationId, 'DELIVERY_EXCEPTION', needsReturn ? 'Package must return to pharmacy' : 'Delivery exception', `${delivery.patientName}: ${outcome.replaceAll('_',' ')}`, { severity: needsReturn ? 'WARNING' : 'INFO', deliveryId: delivery.id, routeId: stop.routeId });
      results.push(updated);
    }

    const completedStop = await prisma.routeStop.update({
      where: { id: stop.id }, data: { completedAt: deliveredAt }
    });

    const remaining = await prisma.routeStop.count({ where: { routeId: stop.routeId, completedAt: null } });
    if (remaining === 0) {
      await prisma.route.update({ where: { id: stop.routeId }, data: { completedAt: deliveredAt } });
    }

    res.json({
      ok: true,
      stop: completedStop,
      summary: {
        expected: stop.deliveries.length,
        delivered: delivered.length,
        exceptions: exceptionMap.size,
        unaccounted: 0
      },
      deliveries: results
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Failed to complete stop', detail: error?.message || String(error) });
  }
});


app.get('/api/organizations/:organizationId/deliveries', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;

  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const takeRaw = Number(req.query.take || 100);
  const take = Math.max(1, Math.min(Number.isFinite(takeRaw) ? takeRaw : 100, 250));

  const deliveries = await prisma.delivery.findMany({
    where: {
      organizationId: req.params.organizationId,
      ...(status ? { status: status as DeliveryStatus } : {})
    },
    include: {
      driver: { select: { id: true, displayName: true } },
      routeStop: { select: { id: true, sequence: true, routeId: true, facilityName: true } },
      receiptImports: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, source: true, status: true, createdAt: true, template: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take
  });

  res.json({
    deliveries: deliveries.map(d => ({
      ...d,
      hasOriginalPdf: !!d.originalPdfObjectKey,
      hasSignedPdf: !!d.signedPdfObjectKey,
      hasSignature: !!d.signatureObjectKey,
      originalPdfObjectKey: undefined,
      signedPdfObjectKey: undefined,
      signatureObjectKey: undefined
    }))
  });
});

const deliveryEditSchema = z.object({
  patientName: z.string().trim().min(1).optional(),
  address1: z.string().trim().min(1).optional(),
  address2: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(2).optional(),
  postalCode: z.string().trim().min(3).optional(),
  driverId: z.string().trim().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable()
});

app.patch('/api/deliveries/:deliveryId', async (req, res) => {
  const existing = await prisma.delivery.findUnique({
    where: { id: req.params.deliveryId },
    include: { routeStop: { include: { route: true } } }
  });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;

  if (existing.status === DeliveryStatus.DELIVERED || existing.status === DeliveryStatus.RETURNED) {
    return res.status(409).json({ error: 'Completed deliveries are locked. Keep the audit record instead of editing it.' });
  }

  const parsed = deliveryEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const addressChanging = ['address1','address2','city','state','postalCode'].some(k => Object.prototype.hasOwnProperty.call(parsed.data, k));
  const driverChanging = Object.prototype.hasOwnProperty.call(parsed.data, 'driverId') && parsed.data.driverId !== existing.driverId;

  if (existing.routeStopId && (addressChanging || driverChanging)) {
    return res.status(409).json({ error: 'Remove this delivery from its route before changing its address or driver.' });
  }

  let nextDriverId = existing.driverId;
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'driverId')) {
    nextDriverId = parsed.data.driverId || null;
    if (nextDriverId) {
      const driver = await prisma.driver.findFirst({ where: { id: nextDriverId, organizationId: existing.organizationId, active: true } });
      if (!driver) return res.status(404).json({ error: 'Active driver not found for this organization' });
    }
  }

  const updateData: any = {
    ...(parsed.data.patientName !== undefined ? { patientName: parsed.data.patientName } : {}),
    ...(parsed.data.address1 !== undefined ? { address1: parsed.data.address1 } : {}),
    ...(parsed.data.address2 !== undefined ? { address2: parsed.data.address2 || null } : {}),
    ...(parsed.data.city !== undefined ? { city: parsed.data.city } : {}),
    ...(parsed.data.state !== undefined ? { state: parsed.data.state.toUpperCase() } : {}),
    ...(parsed.data.postalCode !== undefined ? { postalCode: parsed.data.postalCode } : {}),
    ...(Object.prototype.hasOwnProperty.call(parsed.data, 'driverId') ? { driverId: nextDriverId } : {})
  };

  if (parsed.data.latitude !== undefined) updateData.latitude = parsed.data.latitude;
  if (parsed.data.longitude !== undefined) updateData.longitude = parsed.data.longitude;
  if (addressChanging && parsed.data.latitude === undefined && parsed.data.longitude === undefined) {
    updateData.latitude = null;
    updateData.longitude = null;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, 'driverId')) {
    updateData.status = nextDriverId ? DeliveryStatus.ASSIGNED : DeliveryStatus.PENDING;
  }

  const updated = await prisma.delivery.update({ where: { id: existing.id }, data: updateData });
  await prisma.auditEvent.create({
    data: {
      deliveryId: existing.id,
      actorUserId: actor?.id,
      type: 'DELIVERY_EDITED',
      details: {
        changedFields: Object.keys(parsed.data),
        driverId: nextDriverId,
        addressChanged: addressChanging
      }
    }
  });

  res.json({ delivery: updated });
});

app.post('/api/deliveries/:deliveryId/geocode', async (req, res) => {
  const existing = await prisma.delivery.findUnique({ where: { id: req.params.deliveryId } });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  if (existing.routeStopId) return res.status(409).json({ error: 'Remove this delivery from its route before re-geocoding it.' });

  const address = [existing.address1, existing.address2, existing.city, existing.state, existing.postalCode].filter(Boolean).join(', ');
  const point = await geocodeAddress(address);
  if (!point) return res.status(422).json({ error: 'GEOCODE_NOT_FOUND', message: 'No coordinates were found for this address.' });

  const delivery = await prisma.delivery.update({
    where: { id: existing.id },
    data: { latitude: point.latitude, longitude: point.longitude }
  });
  await prisma.auditEvent.create({
    data: { deliveryId: existing.id, actorUserId: actor?.id, type: 'DELIVERY_GEOCODED', details: { address, ...point } }
  });
  res.json({ delivery, point });
});

app.post('/api/deliveries/:deliveryId/remove-from-route', async (req, res) => {
  const existing = await prisma.delivery.findUnique({
    where: { id: req.params.deliveryId },
    include: { routeStop: { include: { route: true, deliveries: true } } }
  });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  if (!existing.routeStopId || !existing.routeStop) return res.json({ ok: true, message: 'Delivery is not currently on a route.' });
  if (existing.routeStop.route.startedAt) return res.status(409).json({ error: 'Cannot remove a delivery after its route has started.' });

  const stopId = existing.routeStop.id;
  const routeId = existing.routeStop.route.id;
  await prisma.delivery.update({
    where: { id: existing.id },
    data: { routeStopId: null, status: existing.driverId ? DeliveryStatus.ASSIGNED : DeliveryStatus.PENDING }
  });

  const remainingAtStop = await prisma.delivery.count({ where: { routeStopId: stopId } });
  if (remainingAtStop === 0) await prisma.routeStop.delete({ where: { id: stopId } });

  const remainingStops = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: 'asc' } });
  await prisma.$transaction(remainingStops.map((stop, index) =>
    prisma.routeStop.update({ where: { id: stop.id }, data: { sequence: -(index + 1) } })
  ));
  const negativeStops = await prisma.routeStop.findMany({ where: { routeId }, orderBy: { sequence: 'desc' } });
  await prisma.$transaction(negativeStops.map((stop, index) =>
    prisma.routeStop.update({ where: { id: stop.id }, data: { sequence: index + 1 } })
  ));
  await prisma.route.update({
    where: { id: routeId },
    data: { plannedStopMinutes: remainingStops.length * STOP_SERVICE_MINUTES }
  });

  await prisma.auditEvent.create({
    data: { deliveryId: existing.id, actorUserId: actor?.id, type: 'REMOVED_FROM_ROUTE', details: { routeId, stopId } }
  });
  res.json({ ok: true });
});

app.delete('/api/deliveries/:deliveryId', async (req, res) => {
  const existing = await prisma.delivery.findUnique({
    where: { id: req.params.deliveryId },
    include: { scans: true, receiptImports: true }
  });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existing.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN']);
  if (!actor) return;

  if (existing.routeStopId) return res.status(409).json({ error: 'Remove the delivery from its route before deleting it.' });
  if (existing.status === DeliveryStatus.DELIVERED || existing.status === DeliveryStatus.OUT_FOR_DELIVERY || existing.status === DeliveryStatus.RETURN_REQUIRED || existing.status === DeliveryStatus.RETURNED) {
    return res.status(409).json({ error: 'This delivery has operational history and cannot be deleted.' });
  }
  if (existing.signatureObjectKey || existing.signedPdfObjectKey || existing.barcodeVerifiedAt || existing.scans.length) {
    return res.status(409).json({ error: 'This delivery contains proof/audit activity and cannot be deleted.' });
  }

  await prisma.$transaction(async tx => {
    await tx.receiptImport.deleteMany({ where: { deliveryId: existing.id } });
    await tx.auditEvent.deleteMany({ where: { deliveryId: existing.id } });
    await tx.delivery.delete({ where: { id: existing.id } });
  });
  res.json({ ok: true });
});

app.get('/api/deliveries/:deliveryId', async (req, res) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: req.params.deliveryId },
    include: {
      driver: { select: { id: true, displayName: true, phone: true } },
      routeStop: {
        include: {
          route: { select: { id: true, routeDate: true, startedAt: true, completedAt: true } }
        }
      },
      receiptImports: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, source: true, originalFilename: true, template: true, pageCount: true,
          logNumber: true, parsedDriverRaw: true, parsedDriverAlias: true, parsedAddress: true,
          status: true, createdAt: true
        }
      },
      scans: { orderBy: { scannedAt: 'asc' } },
      audits: { orderBy: { createdAt: 'asc' } }
    }
  });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

  const actor = await requireOrganizationUser(req, res, delivery.organizationId);
  if (!actor) return;

  res.json({
    delivery: {
      ...delivery,
      hasOriginalPdf: !!delivery.originalPdfObjectKey,
      hasSignedPdf: !!delivery.signedPdfObjectKey,
      hasSignature: !!delivery.signatureObjectKey,
      originalPdfObjectKey: undefined,
      signedPdfObjectKey: undefined,
      signatureObjectKey: undefined
    }
  });
});

app.get('/api/deliveries/:deliveryId/document/:kind', async (req, res) => {
  const delivery = await prisma.delivery.findUnique({ where: { id: req.params.deliveryId } });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

  const actor = await requireOrganizationUser(req, res, delivery.organizationId);
  if (!actor) return;

  const kind = String(req.params.kind || '').toLowerCase();
  let objectKey: string | null | undefined;
  let contentType = 'application/pdf';
  let filename = `delivery-${delivery.externalLogNumber || delivery.id}.pdf`;

  if (kind === 'original') {
    objectKey = delivery.originalPdfObjectKey;
    filename = `original-${delivery.externalLogNumber || delivery.id}.pdf`;
  } else if (kind === 'signed') {
    objectKey = delivery.signedPdfObjectKey;
    filename = `signed-${delivery.externalLogNumber || delivery.id}.pdf`;
  } else if (kind === 'signature') {
    objectKey = delivery.signatureObjectKey;
    contentType = 'image/png';
    filename = `signature-${delivery.externalLogNumber || delivery.id}.png`;
  } else {
    return res.status(400).json({ error: 'Document kind must be original, signed, or signature' });
  }

  if (!objectKey) return res.status(404).json({ error: 'Requested document is not available' });

  try {
    const bytes = await readObject(objectKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  } catch (error: any) {
    console.error(error);
    res.status(404).json({ error: 'Stored document could not be read' });
  }
});

app.get('/api/organizations/:organizationId/pilot-readiness', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;

  const organizationId = req.params.organizationId;
  const [total, unassigned, needsReview, delivered, signed, exceptions, activeAgents, activeDrivers] = await Promise.all([
    prisma.delivery.count({ where: { organizationId } }),
    prisma.delivery.count({ where: { organizationId, driverId: null } }),
    prisma.delivery.count({
      where: {
        organizationId,
        OR: [
          { patientName: 'Needs Review' },
          { address1: 'Needs Review' },
          { city: 'Needs Review' }
        ]
      }
    }),
    prisma.delivery.count({ where: { organizationId, status: DeliveryStatus.DELIVERED } }),
    prisma.delivery.count({ where: { organizationId, signedPdfObjectKey: { not: null } } }),
    prisma.delivery.count({
      where: {
        organizationId,
        status: { in: [DeliveryStatus.EXCEPTION, DeliveryStatus.RETURN_REQUIRED] }
      }
    }),
    prisma.printAgentCredential.count({ where: { organizationId, active: true } }),
    prisma.driver.count({ where: { organizationId, active: true } })
  ]);

  res.json({
    organizationId,
    counts: { total, unassigned, needsReview, delivered, signed, exceptions, activeAgents, activeDrivers },
    checks: {
      printAgentPaired: activeAgents > 0,
      driverConfigured: activeDrivers > 0,
      importedReceiptAvailable: total > 0,
      noUnassignedReceipts: total > 0 && unassigned === 0,
      noParserReviewItems: total > 0 && needsReview === 0,
      signedPdfFlowObserved: signed > 0
    }
  });
});


const orgSettingsSchema = z.object({
  routeOriginAddress: z.string().trim().optional().nullable(),
  routeOriginLatitude: z.number().optional().nullable(),
  routeOriginLongitude: z.number().optional().nullable(),
  routeEndAddress: z.string().trim().optional().nullable(),
  routeEndLatitude: z.number().optional().nullable(),
  routeEndLongitude: z.number().optional().nullable(),
  dispatcherPhone: z.string().trim().optional().nullable()
});

app.get('/api/organizations/:organizationId/settings', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  res.json({
    id: organization.id,
    name: organization.name,
    routeOriginAddress: organization.routeOriginAddress,
    routeOriginLatitude: organization.routeOriginLatitude,
    routeOriginLongitude: organization.routeOriginLongitude,
    routeEndAddress: organization.routeEndAddress,
    routeEndLatitude: organization.routeEndLatitude,
    routeEndLongitude: organization.routeEndLongitude,
    dispatcherPhone: organization.dispatcherPhone
  });
});

app.put('/api/organizations/:organizationId/settings', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const parsed = orgSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const organization = await prisma.organization.update({ where: { id: req.params.organizationId }, data: parsed.data });
    res.json(organization);
  } catch {
    res.status(404).json({ error: 'Organization not found' });
  }
});

app.get('/api/organizations/:organizationId/exceptions', async (req, res) => {
  const actor = await requireOrganizationUser(req, res, req.params.organizationId);
  if (!actor) return;
  const deliveries = await prisma.delivery.findMany({
    where: {
      organizationId: req.params.organizationId,
      status: { in: [DeliveryStatus.EXCEPTION, DeliveryStatus.RETURN_REQUIRED, DeliveryStatus.RETURNED] }
    },
    include: { driver: true, routeStop: { include: { route: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 250
  });
  res.json({ deliveries });
});

app.post('/api/deliveries/:id/mark-returned', async (req, res) => {
  const existingForAuth = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!existingForAuth) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existingForAuth.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const parsed = z.object({ notes: z.string().trim().optional() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  if (existing.status !== DeliveryStatus.RETURN_REQUIRED) return res.status(409).json({ error: 'Delivery is not awaiting return' });
  const returnedAt = new Date();
  const delivery = await prisma.delivery.update({
    where: { id: existing.id },
    data: { status: DeliveryStatus.RETURNED, returnedAt, returnNotes: parsed.data.notes }
  });
  await prisma.auditEvent.create({ data: { deliveryId: delivery.id, type: 'RETURNED_TO_PHARMACY', details: { notes: parsed.data.notes } } });
  res.json(delivery);
});

app.post('/api/deliveries/:id/reassign', async (req, res) => {
  const existingForAuth = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!existingForAuth) return res.status(404).json({ error: 'Delivery not found' });
  const actor = await requireOrganizationUser(req, res, existingForAuth.organizationId, ['SUPER_ADMIN','PHARMACY_ADMIN','DISPATCHER']);
  if (!actor) return;
  const parsed = z.object({ driverId: z.string().min(1), notes: z.string().trim().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Delivery not found' });
  if (existing.status === DeliveryStatus.RETURN_REQUIRED) return res.status(409).json({ error: 'Confirm the package returned to pharmacy before reassigning it' });
  const driver = await prisma.driver.findFirst({ where: { id: parsed.data.driverId, organizationId: existing.organizationId, active: true } });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const delivery = await prisma.delivery.update({
    where: { id: existing.id },
    data: {
      driverId: driver.id,
      routeStopId: null,
      status: DeliveryStatus.ASSIGNED,
      outcome: DeliveryOutcome.PENDING,
      barcodeVerifiedAt: null,
      completedAt: null,
      recipientName: null,
      relationship: null,
      signatureObjectKey: null,
      signedPdfObjectKey: null,
      returnedAt: null,
      returnNotes: null,
      exceptionNotes: parsed.data.notes || existing.exceptionNotes
    }
  });
  await prisma.auditEvent.create({ data: { deliveryId: delivery.id, type: 'DELIVERY_REASSIGNED', details: { driverId: driver.id, driverName: driver.displayName, notes: parsed.data.notes } } });
  res.json(delivery);
});

app.get('/api/drivers/:driverId/returns', async (req, res) => {
  const deliveries = await prisma.delivery.findMany({
    where: { driverId: req.params.driverId, status: DeliveryStatus.RETURN_REQUIRED },
    orderBy: { completedAt: 'desc' }
  });
  res.json({ deliveries });
});

app.post('/api/routes/:id/reorder', async (req, res) => {
  if (!(await ensureRouteAccess(req, res, req.params.id))) return;
  const parsed = z.object({ stopIds: z.array(z.string().min(1)).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: { organization: true, stops: { orderBy: { sequence: 'asc' } } } });
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const openStops = route.stops.filter(s => !s.completedAt);
  if (parsed.data.stopIds.length !== openStops.length || new Set(parsed.data.stopIds).size !== openStops.length || parsed.data.stopIds.some(id => !openStops.some(s => s.id === id))) {
    return res.status(400).json({ error: 'stopIds must contain every incomplete stop exactly once' });
  }
  if (openStops[0]?.arrivedAt && parsed.data.stopIds[0] !== openStops[0].id) {
    return res.status(409).json({ error: 'The stop the driver has already arrived at must remain first' });
  }
  const completed = route.stops.filter(s => s.completedAt).sort((a,b) => a.sequence-b.sequence);
  const byId = new Map(openStops.map(s => [s.id, s]));
  const orderedOpen = parsed.data.stopIds.map(id => byId.get(id)!);
  const legMinutes = new Map<string, number>();
  for (let i=0;i<orderedOpen.length;i++) {
    const stop = orderedOpen[i];
    if (i===0) {
      if (stop.arrivedAt) legMinutes.set(stop.id, stop.driveMinutesFromPrevious);
      else if (completed.length) {
        const prev=completed[completed.length-1];
        legMinutes.set(stop.id, prev.latitude!=null&&prev.longitude!=null&&stop.latitude!=null&&stop.longitude!=null ? estimatedDriveMinutes(prev as any, stop as any) : stop.driveMinutesFromPrevious);
      } else if (route.organization.routeOriginLatitude!=null&&route.organization.routeOriginLongitude!=null&&stop.latitude!=null&&stop.longitude!=null) {
        legMinutes.set(stop.id, estimatedDriveMinutes({latitude:route.organization.routeOriginLatitude,longitude:route.organization.routeOriginLongitude}, stop as any));
      } else legMinutes.set(stop.id, stop.driveMinutesFromPrevious);
    } else {
      const prev=orderedOpen[i-1];
      legMinutes.set(stop.id, prev.latitude!=null&&prev.longitude!=null&&stop.latitude!=null&&stop.longitude!=null ? estimatedDriveMinutes(prev as any, stop as any) : stop.driveMinutesFromPrevious);
    }
  }
  await prisma.$transaction(async tx => {
    for (const stop of openStops) await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: -10000 - stop.sequence } });
    for (let i=0; i<orderedOpen.length; i++) await tx.routeStop.update({ where: { id: orderedOpen[i].id }, data: { sequence: completed.length + i + 1, driveMinutesFromPrevious: legMinutes.get(orderedOpen[i].id) || 0 } });
  });
  const updated = await prisma.route.findUnique({ where: { id: route.id }, include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }, driver: true } });
  if (updated) await prisma.route.update({ where: { id: route.id }, data: { plannedDrivingMinutes: updated.stops.reduce((n,s)=>n+s.driveMinutesFromPrevious,0), plannedStopMinutes: updated.stops.length*STOP_SERVICE_MINUTES } });
  res.json({ route: updated, eta: routeEta(updated) });
});

app.post('/api/routes/:id/reoptimize-remaining', async (req, res) => {
  if (!(await ensureRouteAccess(req, res, req.params.id))) return;
  try {
    const parsed = z.object({ origin: z.object({ latitude: z.number(), longitude: z.number() }).optional() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: { organization: true, stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } } }
    });
    if (!route) return res.status(404).json({ error: 'Route not found' });
    const completed = route.stops.filter(s => s.completedAt);
    const remaining = route.stops.filter(s => !s.completedAt);
    if (remaining.length <= 1) return res.json({ route, eta: routeEta(route), message: 'Nothing to optimize' });

    const fixedCurrent = remaining[0]?.arrivedAt ? remaining[0] : null;
    const reorderable = fixedCurrent ? remaining.slice(1) : remaining;
    if (!reorderable.length) return res.json({ route, eta: routeEta(route), message: 'Nothing to optimize' });

    let origin = parsed.data.origin;
    if (!origin && fixedCurrent?.latitude != null && fixedCurrent?.longitude != null) origin = { latitude: fixedCurrent.latitude, longitude: fixedCurrent.longitude };
    if (!origin && completed.length) {
      const last = completed[completed.length - 1];
      if (last.latitude != null && last.longitude != null) origin = { latitude: last.latitude, longitude: last.longitude };
    }
    if (!origin && route.organization.routeOriginLatitude != null && route.organization.routeOriginLongitude != null) {
      origin = { latitude: route.organization.routeOriginLatitude, longitude: route.organization.routeOriginLongitude };
    }
    if (!origin) return res.status(422).json({ error: 'ROUTE_ORIGIN_REQUIRED' });
    if (reorderable.some(s => s.latitude == null || s.longitude == null)) return res.status(422).json({ error: 'MISSING_COORDINATES' });

    const candidates = reorderable.map(s => ({ id: s.id, latitude: s.latitude!, longitude: s.longitude! }));
    let matrix: number[][] | null = null;
    try { matrix = await roadDurationMatrix([origin, ...candidates]); } catch (e) { console.warn('Road matrix unavailable, using local fallback', e); }
    const ordered = nearestNeighborOrder(candidates, origin, matrix);
    const stopById = new Map(reorderable.map(s => [s.id, s]));
    const orderedStops = ordered.map(o => stopById.get(o.id)!);

    let current = origin;
    const legMinutes = new Map<string, number>();
    for (let idx=0; idx<orderedStops.length; idx++) {
      const stop = orderedStops[idx];
      let minutes: number;
      if (matrix) {
        const candidateIndex = candidates.findIndex(c => c.id === stop.id) + 1;
        const currentIndex = idx === 0 ? 0 : candidates.findIndex(c => c.id === orderedStops[idx-1].id) + 1;
        minutes = matrix[currentIndex]?.[candidateIndex] ?? estimatedDriveMinutes(current, stop as any);
      } else minutes = estimatedDriveMinutes(current, stop as any);
      legMinutes.set(stop.id, Math.max(1, Math.round(minutes)));
      current = { latitude: stop.latitude!, longitude: stop.longitude! };
    }

    const baseSequence = completed.length + (fixedCurrent ? 1 : 0);
    await prisma.$transaction(async tx => {
      for (const stop of reorderable) await tx.routeStop.update({ where: { id: stop.id }, data: { sequence: -20000-stop.sequence } });
      for (let i=0; i<orderedStops.length; i++) await tx.routeStop.update({ where: { id: orderedStops[i].id }, data: { sequence: baseSequence+i+1, driveMinutesFromPrevious: legMinutes.get(orderedStops[i].id) || 1 } });
    });
    let updated = await prisma.route.findUnique({ where: { id: route.id }, include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }, driver: true } });
    if (updated) {
      await prisma.route.update({ where: { id: route.id }, data: { plannedDrivingMinutes: updated.stops.reduce((n,s)=>n+s.driveMinutesFromPrevious,0), plannedStopMinutes: updated.stops.length*STOP_SERVICE_MINUTES } });
      updated = await prisma.route.findUnique({ where: { id: route.id }, include: { stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } }, driver: true } });
    }
    res.json({ route: updated, eta: routeEta(updated), routingMode: matrix ? 'ROAD_MATRIX' : 'LOCAL_DISTANCE_FALLBACK' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to re-optimize remaining stops', detail: error?.message || String(error) });
  }
});

app.get('/api/routes/:id/detail', async (req, res) => {
  if (!(await ensureRouteAccess(req, res, req.params.id))) return;
  const route = await prisma.route.findUnique({
    where: { id: req.params.id },
    include: { driver: true, stops: { include: { deliveries: true }, orderBy: { sequence: 'asc' } } }
  });
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json({ route, eta: routeEta(route) });
});

app.listen(port, () => console.log(`Delivery API listening on :${port}`));
