const DB_NAME = 'delivery-driver-v1';
const DB_VERSION = 1;
const KV = 'kv';
const QUEUE = 'queue';

export type QueuedRequest = {
  id?: number;
  path: string;
  method: string;
  body?: unknown;
  createdAt: string;
};

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
      if (!d.objectStoreNames.contains(QUEUE)) d.createObjectStore(QUEUE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setOfflineValue(key: string, value: unknown) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  d.close();
}

export async function getOfflineValue<T>(key: string): Promise<T | null> {
  const d = await db();
  const result = await new Promise<T | null>((resolve, reject) => {
    const tx = d.transaction(KV, 'readonly');
    const req = tx.objectStore(KV).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  d.close();
  return result;
}

export async function enqueueRequest(item: Omit<QueuedRequest, 'id'|'createdAt'>) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(QUEUE, 'readwrite');
    tx.objectStore(QUEUE).add({ ...item, createdAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  d.close();
}

export async function queuedRequestCount() {
  const d = await db();
  const count = await new Promise<number>((resolve, reject) => {
    const req = d.transaction(QUEUE, 'readonly').objectStore(QUEUE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  d.close();
  return count;
}

async function queuedRequests(): Promise<QueuedRequest[]> {
  const d = await db();
  const items = await new Promise<QueuedRequest[]>((resolve, reject) => {
    const req = d.transaction(QUEUE, 'readonly').objectStore(QUEUE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedRequest[]);
    req.onerror = () => reject(req.error);
  });
  d.close();
  return items.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
}

async function removeQueued(id: number) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(QUEUE, 'readwrite');
    tx.objectStore(QUEUE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  d.close();
}

export async function flushQueue(apiBase: string, token: string) {
  if (!navigator.onLine || !token) return { sent: 0, remaining: await queuedRequestCount(), conflict: null as null | { status:number; error:string; path:string } };
  let sent = 0;
  for (const item of await queuedRequests()) {
    const response = await fetch(`${apiBase}${item.path}`, {
      method: item.method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: item.body === undefined ? undefined : JSON.stringify(item.body)
    }).catch(() => null);
    if (!response) break;
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as any));
      // Never silently discard an offline action. A reassignment or dispatcher change
      // can make the driver's cached stop stale; keep the queue intact for review.
      return {
        sent,
        remaining: await queuedRequestCount(),
        conflict: { status: response.status, error: String(payload?.error || payload?.message || 'SYNC_CONFLICT'), path: item.path }
      };
    }
    if (item.id != null) await removeQueued(item.id);
    sent++;
  }
  return { sent, remaining: await queuedRequestCount(), conflict: null as null | { status:number; error:string; path:string } };
}
