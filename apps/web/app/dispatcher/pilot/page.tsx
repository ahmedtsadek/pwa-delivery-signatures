'use client';

import { useEffect, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function PilotReadinessPage() {
  const [organizationId,setOrganizationId]=useState('');
  const [data,setData]=useState<any>(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!userToken()){window.location.replace('/login');return;}
    const qs=new URLSearchParams(window.location.search);
    const id=qs.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';
    setOrganizationId(id);
    if(!id)return;
    const load=async()=>{
      try{
        const r=await userAuthFetch(`${API}/api/organizations/${id}/pilot-readiness`,{cache:'no-store'});
        const j=await r.json();
        if(!r.ok) throw new Error(j.error||'Could not load pilot readiness');
        setData(j);setError('');
      }catch(e:any){setError(e.message);}
    };
    load();
    const t=window.setInterval(load,15000);
    return()=>window.clearInterval(t);
  },[]);

  return <main className="shell dispatcherShell">
    <div className="top"><div><div className="big">Pilot Readiness</div><div className="muted">End-to-end checklist for the first live test</div></div><a className="smallButton" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>Dashboard</a></div>
    {error&&<div className="card errorBox">{error}</div>}
    {data&&<>
      <div className="grid dashboardGrid">
        <div className="metric"><span className="muted">Imported</span><b>{data.counts.total}</b></div>
        <div className="metric"><span className="muted">Unassigned</span><b>{data.counts.unassigned}</b></div>
        <div className="metric"><span className="muted">Needs review</span><b>{data.counts.needsReview}</b></div>
        <div className="metric"><span className="muted">Signed PDFs</span><b>{data.counts.signed}</b></div>
      </div>
      <div className="card">
        {Object.entries(data.checks).map(([key,value])=><div className="packageRow" key={key}>
          <div><b>{key.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase())}</b></div>
          <div className={value?'goodLabel':'warnMark'}>{value?'READY ✓':'NOT YET'}</div>
        </div>)}
      </div>
      <div className="card">
        <div className="big" style={{fontSize:22}}>First live pilot</div>
        <div className="muted">1. Print one real receipt to the virtual printer.</div>
        <div className="muted">2. Confirm it appears in Deliveries with the correct driver and address.</div>
        <div className="muted">3. Build the route and open it on the enrolled driver phone.</div>
        <div className="muted">4. Scan the receipt barcode at the stop.</div>
        <div className="muted">5. Collect the signature and complete the stop.</div>
        <div className="muted">6. Open the delivery and verify the signed PDF.</div>
      </div>
    </>}
  </main>;
}
