'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { userAuthFetch } from '../../../../lib/auth';
const API = process.env.NEXT_PUBLIC_API_URL || '';

type Stop={id:string;sequence:number;facilityName?:string|null;address1:string;city:string;state:string;postalCode:string;completedAt?:string|null;arrivedAt?:string|null;driveMinutesFromPrevious:number;deliveries:any[]};
type Route={id:string;driver:{displayName:string};stops:Stop[];startedAt?:string|null};

export default function ManageRoute(){
  const params=useParams<{id:string}>();
  const [organizationId,setOrganizationId]=useState('');
  const [route,setRoute]=useState<Route|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const load=async()=>{const r=await userAuthFetch(`${API}/api/routes/${params.id}/detail`,{cache:'no-store'});const j=await r.json();if(r.ok)setRoute(j.route);else setMessage(`⚠ ${j.error||'Could not load route'}`);};
  useEffect(()=>{ const q=new URLSearchParams(window.location.search); setOrganizationId(q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||''); load(); },[params.id]);

  const saveOrder=async(stops:Stop[])=>{
    setBusy(true);
    const open=stops.filter(s=>!s.completedAt);
    const r=await userAuthFetch(`${API}/api/routes/${params.id}/reorder`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stopIds:open.map(s=>s.id)})});
    const j=await r.json();
    if(r.ok){setRoute(j.route);setMessage('✓ Route order saved.');}else setMessage(`⚠ ${j.error||'Could not save order'}`);
    setBusy(false);
  };

  const move=(id:string,dir:-1|1)=>{
    if(!route)return;
    const completed=route.stops.filter(s=>s.completedAt);
    const open=route.stops.filter(s=>!s.completedAt);
    const i=open.findIndex(s=>s.id===id);const j=i+dir;
    if(i<0||j<0||j>=open.length)return;
    [open[i],open[j]]=[open[j],open[i]];
    const next=[...completed,...open].map((s,idx)=>({...s,sequence:idx+1}));
    setRoute({...route,stops:next});
  };

  const reoptimize=async()=>{
    setBusy(true);setMessage('Re-optimizing remaining stops…');
    const r=await userAuthFetch(`${API}/api/routes/${params.id}/reoptimize-remaining`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const j=await r.json();
    if(r.ok){setRoute(j.route);setMessage('✓ Remaining stops optimized.');}else setMessage(`⚠ ${j.error||'Could not re-optimize'}`);
    setBusy(false);
  };

  if(!route)return <main className="shell"><div className="card"><div className="big">Route</div><div className="muted">{message||'Loading…'}</div></div></main>;
  const open=route.stops.filter(s=>!s.completedAt);
  return <main className="shell dispatcherShell">
    <div className="top"><div><div className="eyebrow">ROUTE MANAGEMENT</div><div className="big">{route.driver.displayName}</div></div><span className="pill">{open.length} remaining</span></div>
    <div className="card"><p className="muted">Keep this simple: move a stop up/down, save the order, or let the system re-optimize all remaining stops.</p>
      <button className="btn" onClick={reoptimize} disabled={busy}>RE-OPTIMIZE REMAINING STOPS</button>
      <button className="btn secondary" onClick={()=>saveOrder(route.stops)} disabled={busy}>SAVE MANUAL ORDER</button>
      {message&&<div className="warningBox">{message}</div>}
    </div>
    <div className="card routeManageList">
      {route.stops.map((s,idx)=> <div className={`routeManageRow ${s.completedAt?'completedRow':''}`} key={s.id}>
        <div className="stopNumber">{s.sequence}</div>
        <div className="stopInfo"><b>{s.facilityName||s.address1}</b><div className="muted">{s.address1}, {s.city} • {s.deliveries.length} package(s)</div><div className="muted">Drive leg: {s.driveMinutesFromPrevious} min{s.completedAt?' • completed':''}</div></div>
        {!s.completedAt&&<div className="moveButtons"><button onClick={()=>move(s.id,-1)} disabled={busy||!!s.arrivedAt||idx===route.stops.findIndex(x=>!x.completedAt)}>↑</button><button onClick={()=>move(s.id,1)} disabled={busy||!!s.arrivedAt||s===route.stops[route.stops.length-1]}>↓</button></div>}
      </div>)}
    </div>
    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </main>;
}
