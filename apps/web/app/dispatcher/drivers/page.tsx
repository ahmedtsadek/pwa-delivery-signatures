'use client';

import { useEffect, useState } from 'react';
import { API, userAuthFetch, userToken } from '../../../lib/auth';

type Driver={id:string;displayName:string;phone?:string|null;aliases:{alias:string}[]};
type Device={id:string;name?:string|null;active:boolean;enrolledAt:string;expiresAt:string;lastSeenAt:string};

export default function DriverDevicesPage(){
  const [organizationId,setOrganizationId]=useState('');
  const [drivers,setDrivers]=useState<Driver[]>([]);
  const [selected,setSelected]=useState('');
  const [devices,setDevices]=useState<Device[]>([]);
  const [code,setCode]=useState<{code:string;expiresAt:string}|null>(null);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!userToken()){window.location.replace('/login');return;}
    const q=new URLSearchParams(window.location.search);
    const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';
    setOrganizationId(id);
    if(id) userAuthFetch(`${API}/api/organizations/${id}/drivers`).then(async r=>({ok:r.ok,j:await r.json()})).then(({ok,j})=>{if(ok){setDrivers(j.drivers||[]);if(j.drivers?.[0])setSelected(j.drivers[0].id);}else if(j.error)setMessage(j.error);}).catch(()=>setMessage('Could not load drivers.'));
  },[]);

  useEffect(()=>{
    if(!selected)return;
    userAuthFetch(`${API}/api/drivers/${selected}/devices`).then(r=>r.json()).then(j=>setDevices(j.devices||[])).catch(()=>{});
    setCode(null);
  },[selected]);

  const newCode=async()=>{
    setMessage('');
    const r=await userAuthFetch(`${API}/api/drivers/${selected}/enrollment-codes`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const j=await r.json();
    if(!r.ok){setMessage(j.error||'Could not create code');return;}
    setCode({code:j.code,expiresAt:j.expiresAt});
  };

  const revoke=async(id:string)=>{
    if(!confirm('Disconnect this phone?'))return;
    const r=await userAuthFetch(`${API}/api/devices/${id}/revoke`,{method:'POST'});
    if(r.ok)setDevices(v=>v.map(d=>d.id===id?{...d,active:false}:d));
  };

  return <main className="shell"><div className="card">
    <div className="eyebrow">DISPATCHER</div><div className="big">Driver Phones</div>
    <p className="muted">Choose a driver and give them the 6-digit code. They enter it once on their phone.</p>
    <label className="fieldLabel">Driver</label>
    <select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{drivers.map(d=><option key={d.id} value={d.id}>{d.displayName}</option>)}</select>
    <button className="btn" disabled={!selected} onClick={newCode}>CREATE 6-DIGIT PHONE CODE</button>
    {code&&<div className="enrollmentPanel"><div className="muted centered">Tell the driver this code</div><div className="enrollmentBigCode">{code.code}</div><div className="muted centered">Expires {new Date(code.expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div><div className="muted centered">Driver opens <b>/enroll</b> on the phone.</div></div>}
    {message&&<div className="warningBox">{message}</div>}
    <div className="fieldLabel" style={{marginTop:24}}>Connected phones</div>
    {devices.length===0?<div className="muted">No phones connected yet.</div>:devices.map(d=><div className="packageRow" key={d.id}><div><b>{d.name||'Driver phone'}</b><div className="muted">Last seen {new Date(d.lastSeenAt).toLocaleString()}</div></div><div>{d.active?<button className="smallButton" onClick={()=>revoke(d.id)}>DISCONNECT</button>:<span className="pill offline">Disconnected</span>}</div></div>)}
    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </div></main>;
}
