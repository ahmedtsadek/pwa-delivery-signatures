'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { userAuthFetch, userToken } from '../../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

type DeliveryDetail = {
  id: string;
  externalLogNumber?: string | null;
  patientName: string;
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  status: string;
  outcome: string;
  recipientName?: string | null;
  relationship?: string | null;
  completedAt?: string | null;
  exceptionNotes?: string | null;
  barcodeValue?: string | null;
  barcodeVerifiedAt?: string | null;
  hasOriginalPdf: boolean;
  hasSignedPdf: boolean;
  hasSignature: boolean;
  driver?: { id:string; displayName:string; phone?:string|null } | null;
  routeStop?: { sequence:number; facilityName?:string|null; route?:{id:string;routeDate:string;startedAt?:string|null;completedAt?:string|null} } | null;
  receiptImports: any[];
  scans: any[];
  audits: any[];
};

async function openProtectedDocument(deliveryId: string, kind: 'original'|'signed'|'signature') {
  const response = await userAuthFetch(`${API}/api/deliveries/${deliveryId}/document/${kind}`, { cache:'no-store' });
  if (!response.ok) {
    let message = 'Document could not be opened';
    try { const body = await response.json(); message = body.error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const deliveryId = Array.isArray(params?.id) ? deliveryId[0] : params?.id;
  const [organizationId, setOrganizationId] = useState('');
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!deliveryId) return;
    if (!userToken()) { window.location.replace('/login'); return; }
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('organizationId') || localStorage.getItem('deliveryOrganizationId') || '';
    setOrganizationId(id);

    const load = async () => {
      try {
        const response = await userAuthFetch(`${API}/api/deliveries/${deliveryId}`, { cache:'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load delivery');
        setDelivery(payload.delivery);
      } catch (e:any) {
        setError(e.message || 'Could not load delivery');
      }
    };
    load();
  }, [deliveryId]);

  if (error) return <main className="shell"><div className="card errorBox">{error}</div></main>;
  if (!delivery) return <main className="shell"><div className="card"><div className="big">Loading…</div></div></main>;

  const openDoc = async (kind:'original'|'signed'|'signature') => {
    try { await openProtectedDocument(delivery.id, kind); }
    catch (e:any) { setError(e.message); }
  };

  return <main className="shell dispatcherShell">
    <div className="top">
      <div>
        <div className="eyebrow">LOG #{delivery.externalLogNumber || '—'}</div>
        <div className="big">{delivery.patientName}</div>
        <div className="muted">{delivery.address1}{delivery.address2 ? `, ${delivery.address2}` : ''}, {delivery.city}, {delivery.state} {delivery.postalCode}</div>
      </div>
      <a className="smallButton" href={`/dispatcher/deliveries?organizationId=${encodeURIComponent(organizationId)}`}>Back</a>
    </div>

    <div className="grid dashboardGrid">
      <div className="metric"><span className="muted">Status</span><b>{delivery.status.replaceAll('_',' ')}</b></div>
      <div className="metric"><span className="muted">Outcome</span><b>{delivery.outcome.replaceAll('_',' ')}</b></div>
      <div className="metric"><span className="muted">Driver</span><b>{delivery.driver?.displayName || 'Unassigned'}</b></div>
      <div className="metric"><span className="muted">Barcode</span><b>{delivery.barcodeVerifiedAt ? 'Verified ✓' : 'Not verified'}</b></div>
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Documents</div>
      <button className="btn secondary" disabled={!delivery.hasOriginalPdf} onClick={() => openDoc('original')}>VIEW ORIGINAL RECEIPT</button>
      <button className="btn" disabled={!delivery.hasSignedPdf} onClick={() => openDoc('signed')}>VIEW SIGNED RECEIPT</button>
      <button className="btn secondary" disabled={!delivery.hasSignature} onClick={() => openDoc('signature')}>VIEW SIGNATURE</button>
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Delivery proof</div>
      <div className="listrow"><span>Recipient</span><b>{delivery.recipientName || '—'}</b></div>
      <div className="listrow"><span>Relationship</span><b>{delivery.relationship?.replaceAll('_',' ') || '—'}</b></div>
      <div className="listrow"><span>Completed</span><b>{delivery.completedAt ? new Date(delivery.completedAt).toLocaleString() : '—'}</b></div>
      <div className="listrow"><span>Barcode value</span><b>{delivery.barcodeValue || '—'}</b></div>
      {delivery.exceptionNotes && <div className="warningBox">{delivery.exceptionNotes}</div>}
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Receipt imports</div>
      {delivery.receiptImports.map((r:any) => <div className="packageRow" key={r.id}>
        <div><b>{r.originalFilename || 'Receipt PDF'}</b><div className="muted">{r.source} • {r.template || 'Unknown template'}</div></div>
        <div style={{textAlign:'right'}}><b>{r.status}</b><div className="muted">{new Date(r.createdAt).toLocaleString()}</div></div>
      </div>)}
      {!delivery.receiptImports.length && <div className="muted">No receipt import history.</div>}
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Audit timeline</div>
      {delivery.audits.map((a:any) => <div className="packageRow" key={a.id}>
        <div><b>{a.type.replaceAll('_',' ')}</b><div className="muted">{a.details ? JSON.stringify(a.details) : ''}</div></div>
        <div className="muted">{new Date(a.createdAt).toLocaleString()}</div>
      </div>)}
      {!delivery.audits.length && <div className="muted">No audit events yet.</div>}
    </div>
  </main>;
}
