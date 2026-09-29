'use client';

import { useEffect, useMemo, useState } from 'react';
import { userAuthFetch, userToken } from '../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

type RouteCard = {
  id: string;
  driver: { id: string; displayName: string };
  startedAt?: string | null;
  completedAt?: string | null;
  stops: number;
  remainingStops: number;
  deliveries: number;
  completedDeliveries: number;
  exceptions: number;
  plannedDrivingMinutes: number;
  plannedServiceMinutes: number;
  plannedTotalMinutes: number;
  remainingMinutes: number;
  estimatedFinishAt: string;
  currentStop?: {
    sequence: number;
    facilityName?: string | null;
    address1: string;
    city: string;
    verified: number;
    expected: number;
    arrivedAt?: string | null;
  } | null;
};

type Alert = { id:string; severity:string; title:string; message:string; createdAt:string };

type Dashboard = {
  asOf: string;
  totals: { drivers: number; deliveries: number; completed: number; exceptions: number };
  routes: RouteCard[];
};

function mins(value: number) {
  const h = Math.floor(value / 60), m = value % 60;
  return h ? `${h} hr ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

function time(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function Dispatcher() {
  const [organizationId, setOrganizationId] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('organizationId') || localStorage.getItem('deliveryOrganizationId') || '';
    if (id) { setOrganizationId(id); localStorage.setItem('deliveryOrganizationId', id); }
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    if (!userToken()) { window.location.replace('/login'); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await userAuthFetch(`${API}/api/organizations/${organizationId}/dispatcher/today`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load dashboard');
        if (!cancelled) { setDashboard(payload); setError(''); }
        const ar = await userAuthFetch(`${API}/api/organizations/${organizationId}/alerts`, { cache: 'no-store' });
        if (ar.ok) { const aj = await ar.json(); if (!cancelled) setAlerts(aj.alerts || []); }
      } catch (e: any) { if (!cancelled) setError(e.message || 'Could not load dashboard'); }
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [organizationId]);

  const active = useMemo(() => dashboard?.routes.filter(r => !r.completedAt) || [], [dashboard]);

  if (!organizationId) return <main className="shell">
    <div className="card"><div className="big">Dispatcher</div><p className="muted">Open this page with your organization ID once during setup.</p>
      <input className="input" placeholder="Organization ID" onChange={e => setOrganizationId(e.target.value.trim())} />
    </div>
  </main>;

  return <main className="shell dispatcherShell">
    <div className="top"><div><div className="big">Dispatcher</div><div className="muted">Live route status • refreshes automatically</div></div><span className="pill online">Live</span></div>
    {error && <div className="card errorBox">{error}</div>}

    {alerts.length > 0 && <div className="card"><div className="top"><div><div className="big" style={{fontSize:22}}>Needs Attention</div><div className="muted">Unacknowledged delivery exceptions</div></div><span className="pill offline">{alerts.length}</span></div>{alerts.slice(0,5).map(a=><div className="packageRow" key={a.id}><div><b>{a.title}</b><div className="muted">{a.message}</div></div><button className="smallButton" onClick={async()=>{const r=await userAuthFetch(`${API}/api/alerts/${a.id}/acknowledge`,{method:'POST'});if(r.ok)setAlerts(v=>v.filter(x=>x.id!==a.id));}}>OK</button></div>)}{alerts.length>5&&<div className="muted">+ {alerts.length-5} more</div>}</div>}

    <div className="grid dashboardGrid">
      <div className="metric"><span className="muted">Drivers</span><b>{dashboard?.totals.drivers ?? '—'}</b></div>
      <div className="metric"><span className="muted">Deliveries</span><b>{dashboard?.totals.deliveries ?? '—'}</b></div>
      <div className="metric"><span className="muted">Exceptions</span><b>{dashboard?.totals.exceptions ?? '—'}</b></div>
      <div className="metric"><span className="muted">Completed</span><b>{dashboard?.totals.completed ?? '—'}</b></div>
    </div>

    {dashboard && dashboard.routes.length === 0 && <div className="card"><b>No routes yet today.</b><p className="muted">Import receipts, assign drivers, then build optimized routes.</p></div>}

    {active.map(route => <div className="card routeCard" key={route.id}>
      <div className="top"><div><b style={{fontSize:26}}>{route.driver.displayName}</b><div className="muted">{route.completedDeliveries}/{route.deliveries} deliveries completed</div></div><span className="pill">{route.startedAt ? 'On route' : 'Planned'}</span></div>
      <div className="routeProgress"><div style={{width:`${route.stops ? ((route.stops-route.remainingStops)/route.stops)*100 : 0}%`}} /></div>
      <div className="listrow"><span>Stops</span><b>{route.stops} total / {route.remainingStops} remaining</b></div>
      <div className="listrow"><span>Planned driving</span><b>{mins(route.plannedDrivingMinutes)}</b></div>
      <div className="listrow"><span>Stop service time</span><b>{mins(route.plannedServiceMinutes)}</b></div>
      <div className="listrow"><span>Planned route</span><b>{mins(route.plannedTotalMinutes)}</b></div>
      <div className="listrow emphasized"><span>Current ETA to finish</span><b>{time(route.estimatedFinishAt)}</b></div>
      <div className="listrow"><span>Time remaining</span><b>{mins(route.remainingMinutes)}</b></div>
      {route.currentStop && <div className="currentStopBox">
        <div className="eyebrow">CURRENT / NEXT STOP #{route.currentStop.sequence}</div>
        <b>{route.currentStop.facilityName || route.currentStop.address1}</b>
        <div className="muted">{route.currentStop.address1}, {route.currentStop.city}</div>
        <div className="verificationLine">Barcode verification: <b>{route.currentStop.verified}/{route.currentStop.expected}</b></div>
      </div>}
      {route.exceptions > 0 && <div className="warningBox">⚠ {route.exceptions} delivery exception(s) on this route</div>}
      <a className="btn secondary" href={`/dispatcher/routes/${route.id}?organizationId=${encodeURIComponent(organizationId)}`}>MANAGE ROUTE</a>
    </div>)}

    <div className="card actionCard"><b style={{fontSize:22}}>Route Tools</b><a className="btn" href={`/dispatcher/routes?organizationId=${encodeURIComponent(organizationId)}`}>BUILD / OPTIMIZE ROUTES</a><a className="btn secondary" href={`/dispatcher/exceptions?organizationId=${encodeURIComponent(organizationId)}`}>EXCEPTIONS / RETURNS</a><a className="btn secondary" href={`/dispatcher/import?organizationId=${encodeURIComponent(organizationId)}`}>IMPORT RECEIPT PDF</a><a className="btn secondary" href={`/dispatcher/drivers?organizationId=${encodeURIComponent(organizationId)}`}>DRIVER PHONES</a><a className="btn secondary" href={`/dispatcher/settings?organizationId=${encodeURIComponent(organizationId)}`}>SETTINGS</a><a className="btn secondary" href={`/dispatcher/system?organizationId=${encodeURIComponent(organizationId)}`}>USERS / PRINT AGENTS</a></div>
  </main>;
}
