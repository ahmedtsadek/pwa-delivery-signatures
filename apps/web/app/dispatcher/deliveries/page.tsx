'use client';

import { useEffect, useMemo, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

type Delivery = {
  id: string;
  externalLogNumber?: string | null;
  patientName: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  status: string;
  outcome: string;
  completedAt?: string | null;
  createdAt: string;
  hasOriginalPdf: boolean;
  hasSignedPdf: boolean;
  driver?: { id: string; displayName: string } | null;
  routeStop?: { id: string; sequence: number; routeId: string; facilityName?: string | null } | null;
};

export default function DeliveriesPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('organizationId') || localStorage.getItem('deliveryOrganizationId') || '';
    if (!userToken()) { window.location.replace('/login'); return; }
    if (id) {
      setOrganizationId(id);
      localStorage.setItem('deliveryOrganizationId', id);
    }
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    const load = async () => {
      try {
        const response = await userAuthFetch(`${API}/api/organizations/${organizationId}/deliveries?take=250`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load deliveries');
        setDeliveries(payload.deliveries || []);
        setError('');
      } catch (e: any) {
        setError(e.message || 'Could not load deliveries');
      }
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [organizationId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deliveries.filter(d => {
      if (filter !== 'ALL' && d.status !== filter) return false;
      if (!q) return true;
      return [
        d.externalLogNumber,
        d.patientName,
        d.address1,
        d.city,
        d.driver?.displayName
      ].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [deliveries, filter, query]);

  return <main className="shell dispatcherShell">
    <div className="top">
      <div><div className="big">Deliveries</div><div className="muted">Recent receipt imports and delivery status</div></div>
      <a className="smallButton" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>Dashboard</a>
    </div>

    {error && <div className="card errorBox">{error}</div>}

    <div className="card">
      <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search patient, Log #, address or driver" />
      <div className="relationshipGrid" style={{marginTop:12}}>
        {['ALL','PENDING','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURN_REQUIRED','RETURNED'].map(v =>
          <button key={v} className={`relationButton ${filter === v ? 'selected' : ''}`} onClick={() => setFilter(v)}>{v.replaceAll('_',' ')}</button>
        )}
      </div>
    </div>

    <div className="card">
      <div className="listrow emphasized"><span>Showing</span><b>{shown.length}</b></div>
      {shown.map(d => <a key={d.id} className="packageRow" style={{textDecoration:'none',color:'inherit'}} href={`/dispatcher/deliveries/${d.id}?organizationId=${encodeURIComponent(organizationId)}`}>
        <div>
          <b>{d.patientName}</b>
          <div className="muted">Log #{d.externalLogNumber || '—'} • {d.address1}, {d.city}</div>
          <div className="muted">{d.driver?.displayName || 'Unassigned'}{d.routeStop ? ` • Stop ${d.routeStop.sequence}` : ''}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className={d.status === 'DELIVERED' ? 'goodLabel' : d.status.includes('EXCEPTION') || d.status === 'RETURN_REQUIRED' ? 'warnMark' : 'pill'}>{d.status.replaceAll('_',' ')}</div>
          <div className="muted">{d.hasSignedPdf ? 'Signed PDF ✓' : d.hasOriginalPdf ? 'Original PDF' : 'No PDF'}</div>
        </div>
      </a>)}
      {shown.length === 0 && <div className="muted">No matching deliveries.</div>}
    </div>
  </main>;
}
