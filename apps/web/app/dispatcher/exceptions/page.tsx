'use client';

import { useEffect, useMemo, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';
const API = process.env.NEXT_PUBLIC_API_URL || '';

type Driver={id:string;displayName:string};
type Delivery={id:string;externalLogNumber?:string|null;patientName:string;address1:string;city:string;status:string;outcome:string;exceptionNotes?:string|null;completedAt?:string|null;returnedAt?:string|null;driver?:Driver|null};

const labels:Record<string,string>={RECIPIENT_NOT_AVAILABLE:'Recipient not available',REFUSED:'Refused',PACKAGE_NOT_PROVIDED:'Package not provided',UNABLE_TO_ACCESS:'Unable to access',WRONG_PACKAGE:'Wrong package',OTHER:'Other'};

export default function ExceptionsPage(){
  const [organizationId,setOrganizationId]=useState('');
  const [deliveries,setDeliveries]=useState<Delivery[]>([]);
  const [drivers,setDrivers]=useState<Driver[]>([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');

  const load=async(id=organizationId)=>{
    if(!id)return;
    const [e,d]=await Promise.all([
      userAuthFetch(`${API}/api/organizations/${id}/exceptions`,{cache:'no-store'}).then(r=>r.json()),
      userAuthFetch(`${API}/api/organizations/${id}/drivers`).then(r=>r.json())
    ]);
    setDeliveries(e.deliveries||[]);setDrivers(d.drivers||[]);
  };
  useEffect(()=>{if(!userToken()){window.location.replace('/login');return;}const q=new URLSearchParams(window.location.search);const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';setOrganizationId(id);load(id);},[]);

  const open=useMemo(()=>deliveries.filter(d=>d.status!=='RETURNED'),[deliveries]);
  const returned=useMemo(()=>deliveries.filter(d=>d.status==='RETURNED'),[deliveries]);

  const markReturned=async(id:string)=>{setBusy(id);const r=await userAuthFetch(`${API}/api/deliveries/${id}/mark-returned`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const j=await r.json();setMessage(r.ok?'✓ Return confirmed.':`⚠ ${j.error||'Could not confirm return'}`);await load();setBusy('');};
  const reassign=async(id:string,driverId:string)=>{if(!driverId)return;setBusy(id);const r=await userAuthFetch(`${API}/api/deliveries/${id}/reassign`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({driverId,notes:'Reassigned by dispatcher from exception queue'})});const j=await r.json();setMessage(r.ok?'✓ Delivery reassigned and ready for a new route.':`⚠ ${j.error||'Could not reassign'}`);await load();setBusy('');};

  const card=(d:Delivery)=><div className="card exceptionCard" key={d.id}>
    <div className="top"><div><b style={{fontSize:22}}>{d.patientName}</b><div className="muted">Log #{d.externalLogNumber||'—'} • {d.address1}, {d.city}</div></div><span className="pill">{d.status.replaceAll('_',' ')}</span></div>
    <div className="warningBox"><b>{labels[d.outcome]||d.outcome}</b>{d.exceptionNotes&&<div>{d.exceptionNotes}</div>}<div className="muted">Driver: {d.driver?.displayName||'Unassigned'}</div></div>
    {d.status==='RETURN_REQUIRED'&&<button className="btn" disabled={busy===d.id} onClick={()=>markReturned(d.id)}>CONFIRM RETURNED TO PHARMACY</button>}
    <label className="fieldLabel">Reassign for another attempt</label>
    <select className="input" defaultValue="" onChange={e=>{const v=e.target.value;if(v)reassign(d.id,v)}} disabled={busy===d.id}>
      <option value="">Choose driver…</option>{drivers.map(x=><option key={x.id} value={x.id}>{x.displayName}</option>)}
    </select>
  </div>;

  return <main className="shell dispatcherShell">
    <div className="top"><div><div className="big">Delivery Exceptions</div><div className="muted">Return, review, or reassign without losing the audit history.</div></div><span className="pill">{open.length} open</span></div>
    {message&&<div className="warningBox">{message}</div>}
    {open.length===0?<div className="card"><b>No open exceptions.</b></div>:open.map(card)}
    {returned.length>0&&<div className="card"><div className="eyebrow">RECENTLY RETURNED</div>{returned.slice(0,10).map(d=><div className="listrow" key={d.id}><span>{d.patientName}<div className="muted">Log #{d.externalLogNumber||'—'}</div></span><b>Returned ✓</b></div>)}</div>}
    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </main>;
}
