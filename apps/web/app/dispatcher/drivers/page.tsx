'use client';

import { useEffect, useMemo, useState } from 'react';
import { API, userAuthFetch, userToken } from '../../../lib/auth';

type Driver={id:string;displayName:string;phone?:string|null;active:boolean;aliases:{alias:string}[]};
type Device={id:string;name?:string|null;active:boolean;enrolledAt:string;expiresAt:string;lastSeenAt:string};

export default function DriverManagementPage(){
  const [organizationId,setOrganizationId]=useState('');
  const [drivers,setDrivers]=useState<Driver[]>([]);
  const [selected,setSelected]=useState('');
  const [devices,setDevices]=useState<Device[]>([]);
  const [code,setCode]=useState<{code:string;expiresAt:string}|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [showNew,setShowNew]=useState(false);
  const [newName,setNewName]=useState('');
  const [newPhone,setNewPhone]=useState('');
  const [newAliases,setNewAliases]=useState('');
  const [editName,setEditName]=useState('');
  const [editPhone,setEditPhone]=useState('');
  const [editAliases,setEditAliases]=useState('');

  const selectedDriver=useMemo(()=>drivers.find(d=>d.id===selected)||null,[drivers,selected]);

  const loadDrivers=async(id=organizationId)=>{
    if(!id)return;
    const r=await userAuthFetch(`${API}/api/organizations/${id}/drivers?includeInactive=true`,{cache:'no-store'});
    const j=await r.json();
    if(!r.ok){setMessage(j.error||'Could not load drivers.');return;}
    setDrivers(j.drivers||[]);
    if(!selected&&j.drivers?.[0])setSelected(j.drivers[0].id);
  };

  useEffect(()=>{
    if(!userToken()){window.location.replace('/login');return;}
    const q=new URLSearchParams(window.location.search);
    const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';
    setOrganizationId(id);
    if(id)loadDrivers(id).catch(()=>setMessage('Could not load drivers.'));
  },[]);

  useEffect(()=>{
    const d=drivers.find(x=>x.id===selected);
    if(d){
      setEditName(d.displayName);
      setEditPhone(d.phone||'');
      setEditAliases(d.aliases.map(a=>a.alias).join(', '));
    }
    if(!selected)return;
    userAuthFetch(`${API}/api/drivers/${selected}/devices`).then(async r=>{
      if(!r.ok){setDevices([]);return;}
      const j=await r.json();setDevices(j.devices||[]);
    }).catch(()=>setDevices([]));
    setCode(null);
  },[selected,drivers]);

  const parseAliases=(value:string)=>[...new Set(value.split(',').map(v=>v.trim()).filter(Boolean))];

  const createDriver=async()=>{
    if(!newName.trim())return setMessage('Driver name is required.');
    setBusy(true);setMessage('');
    const r=await userAuthFetch(`${API}/api/organizations/${organizationId}/drivers`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({displayName:newName.trim(),phone:newPhone.trim()||undefined,aliases:parseAliases(newAliases)})
    });
    const j=await r.json();
    if(!r.ok){setMessage(j.error||'Could not create driver.');setBusy(false);return;}
    setNewName('');setNewPhone('');setNewAliases('');setShowNew(false);
    await loadDrivers();setSelected(j.id);setMessage('✓ Driver created.');
    setBusy(false);
  };

  const saveDriver=async()=>{
    if(!selectedDriver)return;
    setBusy(true);setMessage('');
    const r=await userAuthFetch(`${API}/api/drivers/${selectedDriver.id}`,{
      method:'PATCH',headers:{'content-type':'application/json'},
      body:JSON.stringify({displayName:editName.trim(),phone:editPhone.trim()||null,aliases:parseAliases(editAliases)})
    });
    const j=await r.json();
    setMessage(r.ok?'✓ Driver updated.':`⚠ ${j.error||'Could not update driver.'}`);
    if(r.ok)await loadDrivers();
    setBusy(false);
  };

  const toggleDriver=async()=>{
    if(!selectedDriver)return;
    const action=selectedDriver.active?'deactivate':'reactivate';
    if(selectedDriver.active&&!confirm(`Deactivate ${selectedDriver.displayName}? Their enrolled phones will be disconnected.`))return;
    setBusy(true);setMessage('');
    const r=await userAuthFetch(`${API}/api/drivers/${selectedDriver.id}/${action}`,{method:'POST'});
    const j=await r.json().catch(()=>({}));
    setMessage(r.ok?`✓ Driver ${selectedDriver.active?'deactivated':'reactivated'}.`:`⚠ ${j.error||'Could not update driver.'}`);
    if(r.ok)await loadDrivers();
    setBusy(false);
  };

  const newCode=async()=>{
    if(!selectedDriver?.active)return setMessage('Reactivate this driver before enrolling a phone.');
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

  return <main className="shell dispatcherShell">
    <div className="top">
      <div><div className="eyebrow">DISPATCHER</div><div className="big">Drivers</div><div className="muted">Create drivers, manage aliases and enroll phones.</div></div>
      <button className="smallButton" onClick={()=>setShowNew(v=>!v)}>{showNew?'CANCEL':'ADD DRIVER'}</button>
    </div>

    {message&&<div className="card warningBox">{message}</div>}

    {showNew&&<div className="card">
      <div className="big" style={{fontSize:22}}>Add driver</div>
      <label className="fieldLabel">Driver name</label>
      <input className="input" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="TEE" />
      <label className="fieldLabel">Phone (optional)</label>
      <input className="input" value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="(714) 555-1234" />
      <label className="fieldLabel">Receipt aliases</label>
      <input className="input" value={newAliases} onChange={e=>setNewAliases(e.target.value)} placeholder="TEE, MHN/TEE" />
      <div className="muted">Comma-separated names exactly as they may appear on pharmacy receipts.</div>
      <button className="btn" onClick={createDriver} disabled={busy}>CREATE DRIVER</button>
    </div>}

    <div className="card">
      <label className="fieldLabel">Driver</label>
      <select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>
        {drivers.map(d=><option key={d.id} value={d.id}>{d.displayName}{d.active?'':' (inactive)'}</option>)}
      </select>

      {selectedDriver&&<>
        <div className="top" style={{marginTop:18}}>
          <div><b style={{fontSize:22}}>{selectedDriver.displayName}</b><div className="muted">{selectedDriver.active?'Active':'Inactive'}</div></div>
          <span className={selectedDriver.active?'pill online':'pill offline'}>{selectedDriver.active?'ACTIVE':'INACTIVE'}</span>
        </div>

        <label className="fieldLabel">Name</label>
        <input className="input" value={editName} onChange={e=>setEditName(e.target.value)} />
        <label className="fieldLabel">Phone</label>
        <input className="input" value={editPhone} onChange={e=>setEditPhone(e.target.value)} />
        <label className="fieldLabel">Aliases</label>
        <input className="input" value={editAliases} onChange={e=>setEditAliases(e.target.value)} placeholder="TEE, MHN/TEE" />

        <button className="btn" onClick={saveDriver} disabled={busy}>SAVE DRIVER</button>
        <button className="btn secondary" onClick={toggleDriver} disabled={busy}>{selectedDriver.active?'DEACTIVATE DRIVER':'REACTIVATE DRIVER'}</button>
      </>}
    </div>

    {selectedDriver?.active&&<div className="card">
      <div className="big" style={{fontSize:22}}>Driver phone</div>
      <p className="muted">Create a 6-digit code and have the driver enter it once at <b>/enroll</b> on their phone.</p>
      <button className="btn" disabled={!selected} onClick={newCode}>CREATE 6-DIGIT PHONE CODE</button>
      {code&&<div className="enrollmentPanel"><div className="muted centered">Tell the driver this code</div><div className="enrollmentBigCode">{code.code}</div><div className="muted centered">Expires {new Date(code.expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div></div>}

      <div className="fieldLabel" style={{marginTop:24}}>Connected phones</div>
      {devices.length===0?<div className="muted">No phones connected yet.</div>:devices.map(d=><div className="packageRow" key={d.id}><div><b>{d.name||'Driver phone'}</b><div className="muted">Last seen {new Date(d.lastSeenAt).toLocaleString()}</div></div><div>{d.active?<button className="smallButton" onClick={()=>revoke(d.id)}>DISCONNECT</button>:<span className="pill offline">Disconnected</span>}</div></div>)}
    </div>}

    <a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a>
  </main>;
}
