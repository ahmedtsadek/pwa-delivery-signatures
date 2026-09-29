'use client';

import { useState } from 'react';
import { API } from '../../lib/auth';

export default function SetupPage(){
  const [organizationName,setOrganizationName]=useState('');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const setup=async()=>{
    setBusy(true);setMessage('');
    try{
      const r=await fetch(`${API}/api/auth/bootstrap`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({organizationName,name,email,password})
      });
      const text=await r.text();
      let j:any={};
      try{ j=text?JSON.parse(text):{}; }catch{ j={ error: text || `Setup failed (HTTP ${r.status})` }; }
      if(!r.ok) throw new Error(typeof j.error==='string'?j.error:(j.detail||`Setup failed (HTTP ${r.status})`));
      setMessage('✓ Admin created. Sign in to continue.');
      setTimeout(()=>window.location.href='/login',700);
    }catch(e:any){setMessage(e.message||'Setup failed');}
    setBusy(false);
  };

  return <main className="shell"><div className="card focusCard">
    <div className="eyebrow">FIRST-TIME SETUP</div><div className="big">Create pharmacy admin</div>
    <p className="muted">PWA Pharmacy Delivery generated its database credentials automatically. Just create your first administrator.</p>
    <label className="fieldLabel">Pharmacy / organization</label><input className="input" value={organizationName} onChange={e=>setOrganizationName(e.target.value)} />
    <label className="fieldLabel">Your name</label><input className="input" value={name} onChange={e=>setName(e.target.value)} />
    <label className="fieldLabel">Email</label><input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
    <label className="fieldLabel">Password</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" />
    <button className="btn" disabled={busy||organizationName.length<2||name.length<2||!email||password.length<8} onClick={setup}>{busy?'CREATING…':'CREATE ADMIN'}</button>
    {message&&<div className="warningBox">{message}</div>}
  </div></main>;
}
