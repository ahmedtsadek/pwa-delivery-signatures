import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const storageRoot = process.env.STORAGE_ROOT || path.resolve(process.cwd(), '../../storage');

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

async function datedFolder(organizationId: string, bucket = '') {
  const date = new Date();
  const folder = path.join(
    storageRoot,
    organizationId,
    bucket,
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0')
  );
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

export async function savePdf(buffer: Buffer, organizationId: string, basename?: string, bucket = 'receipts') {
  const folder = await datedFolder(organizationId, bucket);
  const safeBase = safeName(basename || 'receipt');
  const name = `${Date.now()}-${crypto.randomUUID()}-${safeBase.endsWith('.pdf') ? safeBase : `${safeBase}.pdf`}`;
  const fullPath = path.join(folder, name);
  await fs.writeFile(fullPath, buffer);
  return {
    objectKey: path.relative(storageRoot, fullPath).replaceAll(path.sep, '/'),
    fullPath
  };
}

export async function savePng(buffer: Buffer, organizationId: string, basename?: string) {
  const folder = await datedFolder(organizationId, 'signatures');
  const safeBase = safeName(basename || 'signature').replace(/\.png$/i, '');
  const name = `${Date.now()}-${crypto.randomUUID()}-${safeBase}.png`;
  const fullPath = path.join(folder, name);
  await fs.writeFile(fullPath, buffer);
  return {
    objectKey: path.relative(storageRoot, fullPath).replaceAll(path.sep, '/'),
    fullPath
  };
}

export async function readObject(objectKey: string) {
  const fullPath = path.resolve(storageRoot, objectKey);
  const root = path.resolve(storageRoot) + path.sep;
  if (!fullPath.startsWith(root)) throw new Error('Invalid object key');
  return fs.readFile(fullPath);
}
