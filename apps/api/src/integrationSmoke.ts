import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const API = process.env.INTEGRATION_API_BASE || 'http://127.0.0.1:8787';
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY || 'test-bootstrap';

async function jsonFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, init);
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${text}`);
  return body;
}

async function makeReceipt() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const draw = (text: string, x: number, y: number, size = 10) => page.drawText(text, { x, y, size, font });

  draw('Saint Mary Pharmacy', 35, 752, 13);
  draw('Delivered To: 100 TEST AVE', 260, 752, 10);
  draw('TESTVILLE CA 90000', 400, 735, 10);
  draw('TEST CARE CENTER', 400, 718, 10);
  draw('Rx Delivery Receipt', 230, 690, 16);
  draw('1: 9991001 DOE,JANE 09/28/2026 TESTDRUG 10 MG TABLET 1 $0.00', 30, 610, 9);
  draw('Driver: NHdriver/TEE x____', 35, 232, 8);
  draw('*9990001*', 500, 65, 9);
  draw('Log #: 9990001', 470, 45, 11);
  return Buffer.from(await pdf.save());
}

async function main() {
  const health = await jsonFetch('/health');
  assert.equal(health.ok, true);

  const bootstrap = await jsonFetch('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationName: 'Synthetic Pharmacy',
      name: 'Test Admin',
      email: 'admin@example.test',
      password: 'IntegrationPass123!',
      bootstrapKey: BOOTSTRAP_KEY
    })
  });
  const organizationId = bootstrap.organization.id;
  assert.ok(organizationId);

  const login = await jsonFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'IntegrationPass123!' })
  });
  assert.ok(login.token);
  const auth = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };

  const driver = await jsonFetch(`/api/organizations/${organizationId}/drivers`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ displayName: 'TEE', aliases: ['NHdriver/TEE', 'TEE'] })
  });
  assert.equal(driver.displayName, 'TEE');

  const agent = await jsonFetch(`/api/organizations/${organizationId}/print-agents`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'CI Windows Printer' })
  });
  assert.ok(agent.token);

  const receipt = await makeReceipt();
  const form = new FormData();
  form.append('organizationId', organizationId);
  form.append('source', 'PRINT_AGENT');
  form.append('file', new Blob([receipt], { type: 'application/pdf' }), 'synthetic-receipt.pdf');

  const ingestResponse = await fetch(API + '/api/ingest/pdf', {
    method: 'POST',
    headers: { authorization: `Bearer ${agent.token}` },
    body: form
  });
  const ingestText = await ingestResponse.text();
  assert.equal(ingestResponse.ok, true, ingestText);
  const ingest = JSON.parse(ingestText);
  assert.equal(ingest.parsed.logNumber, '9990001');
  assert.equal(ingest.parsed.driverNormalized, 'TEE');
  assert.equal(ingest.delivery.driverId, driver.id);
  assert.equal(ingest.delivery.externalLogNumber, '9990001');

  const deliveries = await jsonFetch(`/api/organizations/${organizationId}/deliveries`, {
    headers: { authorization: `Bearer ${login.token}` }
  });
  assert.equal(deliveries.deliveries.length, 1);
  assert.equal(deliveries.deliveries[0].externalLogNumber, '9990001');
  assert.equal(deliveries.deliveries[0].driver.displayName, 'TEE');
  assert.equal(deliveries.deliveries[0].hasOriginalPdf, true);

  const duplicate = await fetch(API + '/api/ingest/pdf', {
    method: 'POST',
    headers: { authorization: `Bearer ${agent.token}` },
    body: form
  });
  const duplicateBody = await duplicate.json();
  assert.equal(duplicate.ok, true);
  assert.equal(duplicateBody.duplicate, true);
  assert.equal(duplicateBody.reason, 'SAME_PDF_ALREADY_IMPORTED');

  const readiness = await jsonFetch(`/api/organizations/${organizationId}/pilot-readiness`, {
    headers: { authorization: `Bearer ${login.token}` }
  });
  assert.equal(readiness.checks.printAgentPaired, true);
  assert.equal(readiness.checks.driverConfigured, true);
  assert.equal(readiness.checks.importedReceiptAvailable, true);
  assert.equal(readiness.checks.noUnassignedReceipts, true);

  console.log(JSON.stringify({
    ok: true,
    organizationId,
    driverId: driver.id,
    deliveryId: ingest.delivery.id,
    logNumber: ingest.delivery.externalLogNumber,
    duplicateProtection: duplicateBody.reason,
    readiness: readiness.checks
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
