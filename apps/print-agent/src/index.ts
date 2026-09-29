import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';

const watchDir = path.resolve(process.env.PRINT_WATCH_DIR || './inbox');
const archiveDir = path.resolve(process.env.PRINT_ARCHIVE_DIR || './archive');
const failedDir = path.resolve(process.env.PRINT_FAILED_DIR || './failed');
const apiBase = process.env.DELIVERY_API_BASE || 'http://localhost:8787';
const organizationId = process.env.DELIVERY_ORGANIZATION_ID || '';
const agentToken = process.env.DELIVERY_PRINT_AGENT_TOKEN || '';
const stableDelayMs = Number(process.env.PRINT_STABLE_DELAY_MS || 1500);

if (!organizationId || !agentToken) {
  console.error('DELIVERY_ORGANIZATION_ID and DELIVERY_PRINT_AGENT_TOKEN are required.');
  process.exit(1);
}

await Promise.all([watchDir, archiveDir, failedDir].map(dir => fs.mkdir(dir, { recursive: true })));

async function waitForStableFile(filePath: string) {
  let previous = -1;
  for (let i = 0; i < 10; i++) {
    const stat = await fs.stat(filePath);
    if (stat.size > 0 && stat.size === previous) return;
    previous = stat.size;
    await new Promise(resolve => setTimeout(resolve, stableDelayMs));
  }
}

async function uniqueDestination(folder: string, original: string) {
  const ext = path.extname(original);
  const stem = path.basename(original, ext);
  let candidate = path.join(folder, original);
  let i = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(folder, `${stem}-${i++}${ext}`);
    } catch {
      return candidate;
    }
  }
}

async function uploadPdf(filePath: string) {
  await waitForStableFile(filePath);
  const filename = path.basename(filePath);
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('organizationId', organizationId);
  form.append('source', 'PRINT_AGENT');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);

  const response = await fetch(`${apiBase}/api/ingest/pdf`, { method: 'POST', headers: { authorization: `Bearer ${agentToken}` }, body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function handle(filePath: string) {
  if (!filePath.toLowerCase().endsWith('.pdf')) return;
  try {
    const result = await uploadPdf(filePath);
    const destination = await uniqueDestination(archiveDir, path.basename(filePath));
    await fs.rename(filePath, destination);
    const log = result?.parsed?.logNumber || result?.delivery?.externalLogNumber || 'unknown';
    const driver = result?.autoAssignedDriver?.displayName || 'needs assignment';
    console.log(`✓ Imported ${path.basename(filePath)} | Log ${log} | Driver ${driver}${result?.duplicate ? ' | duplicate/reprint' : ''}`);
  } catch (error: any) {
    console.error(`✗ Failed ${path.basename(filePath)}: ${error?.message || error}`);
    try {
      const destination = await uniqueDestination(failedDir, path.basename(filePath));
      await fs.rename(filePath, destination);
    } catch {}
  }
}

console.log('Delivery Print Agent v0.7');
console.log(`Watching: ${watchDir}`);
console.log(`API: ${apiBase}`);
console.log('Drop/print-generated PDFs into this folder. Successful jobs are archived automatically.');

chokidar.watch(watchDir, { ignoreInitial: false, awaitWriteFinish: false }).on('add', handle);
