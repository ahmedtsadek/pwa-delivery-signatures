'use client';

import { useState } from 'react';
import { API } from '../../lib/auth';

export default function LoginPage(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const login=async()=>{
    setBusy(true);setMessage('');
    try{
      const r=await fetch(`${API}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Login failed');
      localStorage.setItem('deliveryUserToken',j.token);
      localStorage.setItem('deliveryOrganizationId',j.user.organizationId);
      localStorage.setItem('deliveryUserName',j.user.name);
      window.location.href=`/dispatcher?organizationId=${encodeURIComponent(j.user.organizationId)}`;
    }catch(e:any){setMessage(e.message||'Login failed');}
    setBusy(false);
  };
  return <main className="shell"><div className="card focusCard">
    <div className="eyebrow">DISPATCHER</div><div className="big">Sign in</div>
    <label className="fieldLabel">Email</label><input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" />
    <label className="fieldLabel">Password</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" onKeyDown={e=>{if(e.key==='Enter')login();}} />
    <button className="btn" disabled={busy||!email||!password} onClick={login}>{busy?'SIGNING IN…':'SIGN IN'}</button>
    {message&&<div className="errorBox card">{message}</div>}
  </div></main>;
}
