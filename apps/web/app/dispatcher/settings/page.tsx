'use client';

import { useEffect, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';
const API = process.env.NEXT_PUBLIC_API_URL || '';

type Settings = {
  name?: string;
  routeOriginAddress?: string|null;
  routeOriginLatitude?: number|null;
  routeOriginLongitude?: number|null;
  routeEndAddress?: string|null;
  routeEndLatitude?: number|null;
  routeEndLongitude?: number|null;
  dispatcherPhone?: string|null;
};

export default function SettingsPage() {
  const [organizationId,setOrganizationId]=useState('');
  const [form,setForm]=useState<Settings>({});
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    if(!userToken()){window.location.replace('/login');return;}
    const q=new URLSearchParams(window.location.search);
    const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';
    setOrganizationId(id);
    if(id) userAuthFetch(`${API}/api/organizations/${id}/settings`).then(r=>r.json()).then(setForm);
  },[]);

  const useCurrent = () => {
    setMessage('Getting current location…');
    navigator.geolocation?.getCurrentPosition(p=>{
      setForm(v=>({...v,routeOriginLatitude:p.coords.latitude,routeOriginLongitude:p.coords.longitude}));
      setMessage('✓ Start coordinates captured. Enter the pharmacy address if needed, then save.');
    },()=>setMessage('⚠ Could not get current location.'),{enableHighAccuracy:true,timeout:10000});
  };

  const save=async()=>{
    setBusy(true);setMessage('Saving…');
    const body={
      routeOriginAddress:form.routeOriginAddress||null,
      routeOriginLatitude:form.routeOriginLatitude ?? null,
      routeOriginLongitude:form.routeOriginLongitude ?? null,
      routeEndAddress:form.routeEndAddress||null,
      routeEndLatitude:form.routeEndLatitude ?? null,
      routeEndLongitude:form.routeEndLongitude ?? null,
      dispatcherPhone:form.dispatcherPhone||null
    };
    const r=await userAuthFetch(`${API}/api/organizations/${organizationId}/settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    setMessage(r.ok?'✓ Settings saved.':`⚠ ${j.error||'Could not save settings'}`);
    setBusy(false);
  };

  return <main className="shell"><div className="card">
    <div className="eyebrow">DISPATCHER</div><div className="big">Pharmacy & Route Settings</div>
    <label className="fieldLabel">Pharmacy / route start address</label>
    <input className="input" value={form.routeOriginAddress||''} onChange={e=>setForm({...form,routeOriginAddress:e.target.value})} placeholder="1842 N Tustin St, Orange, CA 92865" />
    <div className="grid">
      <input className="input" value={form.routeOriginLatitude ?? ''} onChange={e=>setForm({...form,routeOriginLatitude:e.target.value?Number(e.target.value):null})} placeholder="Latitude" />
      <input className="input" value={form.routeOriginLongitude ?? ''} onChange={e=>setForm({...form,routeOriginLongitude:e.target.value?Number(e.target.value):null})} placeholder="Longitude" />
    </div>
    <button className="btn secondary" onClick={useCurrent}>USE THIS DEVICE LOCATION AS START</button>

    <label className="fieldLabel">Route end address (optional)</label>
    <input className="input" value={form.routeEndAddress||''} onChange={e=>setForm({...form,routeEndAddress:e.target.value})} placeholder="Leave blank if not used yet" />
    <div className="grid">
      <input className="input" value={form.routeEndLatitude ?? ''} onChange={e=>setForm({...form,routeEndLatitude:e.target.value?Number(e.target.value):null})} placeholder="End latitude" />
      <input className="input" value={form.routeEndLongitude ?? ''} onChange={e=>setForm({...form,routeEndLongitude:e.target.value?Number(e.target.value):null})} placeholder="End longitude" />
    </div>

    <label className="fieldLabel">Dispatcher help phone</label>
    <input className="input" value={form.dispatcherPhone||''} onChange={e=>setForm({...form,dispatcherPhone:e.target.value})} placeholder="(714) 555-1234" />
    <button className="btn" onClick={save} disabled={busy}>{busy?'SAVING…':'SAVE SETTINGS'}</button>
    {message&&<div className="warningBox">{message}</div>}
    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </div></main>;
}
