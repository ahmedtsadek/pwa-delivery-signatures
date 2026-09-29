'use client';

import { useEffect, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';
type Driver = { id: string; displayName: string; aliases: { alias: string }[] };
type Settings = { routeOriginAddress?: string|null; routeOriginLatitude?: number|null; routeOriginLongitude?: number|null };

export default function RoutePlanner() {
  const [organizationId, setOrganizationId] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [settings, setSettings] = useState<Settings>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if(!userToken()){window.location.replace('/login');return;}
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('organizationId') || localStorage.getItem('deliveryOrganizationId') || '';
    setOrganizationId(id);
    if (!id) return;
    Promise.all([
      userAuthFetch(`${API}/api/organizations/${id}/drivers`).then(r => r.json()),
      userAuthFetch(`${API}/api/organizations/${id}/settings`).then(r => r.json())
    ]).then(([d,s]) => {
      setDrivers(d.drivers || []);
      if (d.drivers?.length) setDriverId(d.drivers[0].id);
      setSettings(s || {});
    });
  }, []);

  const deviceLocation = () => new Promise<{latitude:number;longitude:number}>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(p => resolve({ latitude:p.coords.latitude, longitude:p.coords.longitude }), reject, { enableHighAccuracy:true, timeout:10000 });
  });

  const optimize = async () => {
    if (!driverId) return;
    setBusy(true); setMessage('Preparing route…');
    try {
      let origin: {latitude:number;longitude:number};
      if (settings.routeOriginLatitude != null && settings.routeOriginLongitude != null) {
        origin = { latitude: settings.routeOriginLatitude, longitude: settings.routeOriginLongitude };
      } else {
        setMessage('No saved pharmacy location — using this device location…');
        origin = await deviceLocation();
      }
      setMessage('Optimizing route…');
      const response = await userAuthFetch(`${API}/api/drivers/${driverId}/routes/optimize`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || 'Could not optimize route');
      setMessage(`✓ Route created: ${payload.route.stops.length} stops • ${payload.route.plannedDrivingMinutes} min driving • estimated finish ${new Date(payload.eta.estimatedFinishAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`);
    } catch (e:any) { setMessage(`⚠ ${e.message || 'Could not optimize route'}`); }
    setBusy(false);
  };

  return <main className="shell"><div className="card">
    <div className="eyebrow">DISPATCHER</div><div className="big">Build Route</div>
    <p className="muted">Same-address deliveries become one stop. Each physical stop adds 5 minutes.</p>
    <div className="currentStopBox"><b>Route start</b><div>{settings.routeOriginAddress || 'Not saved — device location will be used'}</div></div>
    <label className="fieldLabel">Driver</label>
    <select className="input" value={driverId} onChange={e => setDriverId(e.target.value)}>{drivers.map(d => <option value={d.id} key={d.id}>{d.displayName}</option>)}</select>
    <button className="btn" onClick={optimize} disabled={busy || !driverId}>{busy ? 'WORKING…' : 'BUILD OPTIMIZED ROUTE'}</button>
    {message && <div className="warningBox">{message}</div>}
    <a className="btn secondary" href={`/dispatcher/settings?organizationId=${encodeURIComponent(organizationId)}`}>PHARMACY / ROUTE SETTINGS</a>
    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </div></main>;
}
