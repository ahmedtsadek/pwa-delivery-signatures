'use client';

import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function EnrollDevicePage() {
  const [code,setCode]=useState('');
  const [deviceName,setDeviceName]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const enroll=async()=>{
    setBusy(true); setMessage('');
    try {
      const response=await fetch(`${API}/api/device/enroll`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code.replace(/\D/g,''),deviceName:deviceName.trim()||undefined})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||'Could not enroll this phone');
      localStorage.setItem('deliveryDeviceToken',payload.token);
      localStorage.setItem('deliveryDriverId',payload.driver.id);
      localStorage.setItem('deliveryDriverName',payload.driver.displayName);
      window.location.href='/driver';
    } catch(e:any){ setMessage(e.message||'Could not enroll this phone'); }
    setBusy(false);
  };

  return <main className="shell driverShell"><div className="card focusCard">
    <div className="eyebrow">ONE-TIME SETUP</div>
    <div className="big">Connect this phone</div>
    <p className="muted centered">Ask the dispatcher for the 6-digit driver code. You only do this once.</p>
    <label className="fieldLabel">6-digit code</label>
    <input className="input enrollmentCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" />
    <label className="fieldLabel">Phone name (optional)</label>
    <input className="input" value={deviceName} onChange={e=>setDeviceName(e.target.value)} placeholder="Tee's phone" />
    <button className="btn" disabled={busy||code.length!==6} onClick={enroll}>{busy?'CONNECTING…':'CONNECT PHONE'}</button>
    {message&&<div className="errorBox card">{message}</div>}
  </div></main>;
}
