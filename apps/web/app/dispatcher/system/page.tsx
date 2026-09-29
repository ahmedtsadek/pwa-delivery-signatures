'use client';

import { useEffect, useState } from 'react';
import { API, userAuthFetch, userToken } from '../../../lib/auth';

type User={id:string;name:string;email:string;role:string;active:boolean};
type Agent={id:string;name:string;active:boolean;lastSeenAt?:string|null;createdAt:string};

export default function SystemPage(){
  const [organizationId,setOrganizationId]=useState('');
  const [users,setUsers]=useState<User[]>([]);
  const [agents,setAgents]=useState<Agent[]>([]);
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [role,setRole]=useState('DISPATCHER');
  const [agentName,setAgentName]=useState('Pharmacy Front Desk'); const [newToken,setNewToken]=useState(''); const [message,setMessage]=useState('');

  const load=async(id:string)=>{
    const [ur,ar]=await Promise.all([userAuthFetch(`${API}/api/organizations/${id}/users`),userAuthFetch(`${API}/api/organizations/${id}/print-agents`)]);
    if(ur.ok)setUsers((await ur.json()).users||[]); else setMessage((await ur.json()).error||'Could not load users');
    if(ar.ok)setAgents((await ar.json()).agents||[]);
  };
  useEffect(()=>{if(!userToken()){window.location.replace('/login');return;} const q=new URLSearchParams(window.location.search);const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||'';setOrganizationId(id);if(id)load(id);},[]);

  const addUser=async()=>{setMessage('');const r=await userAuthFetch(`${API}/api/organizations/${organizationId}/users`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,email,password,role})});const j=await r.json();if(!r.ok){setMessage(j.error||'Could not create user');return;}setName('');setEmail('');setPassword('');await load(organizationId);};
  const toggleUser=async(u:User)=>{const r=await userAuthFetch(`${API}/api/users/${u.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({active:!u.active})});if(r.ok)await load(organizationId);};
  const createAgent=async()=>{setMessage('');setNewToken('');const r=await userAuthFetch(`${API}/api/organizations/${organizationId}/print-agents`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:agentName})});const j=await r.json();if(!r.ok){setMessage(j.error||'Could not create print agent');return;}setNewToken(j.token);await load(organizationId);};
  const revoke=async(a:Agent)=>{if(!confirm(`Revoke ${a.name}?`))return;const r=await userAuthFetch(`${API}/api/print-agents/${a.id}/revoke`,{method:'POST'});if(r.ok)await load(organizationId);};

  return <main className="shell"><div className="card"><div className="eyebrow">ADMIN</div><div className="big">Users & Print Agents</div><p className="muted">Keep driver phones separate. This page controls dispatcher/admin access and pharmacy-PC upload credentials.</p>{message&&<div className="warningBox">{message}</div>}
    <div className="fieldLabel" style={{marginTop:20}}>Add staff user</div><input className="input" placeholder="Name" value={name} onChange={e=>setName(e.target.value)}/><input className="input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input className="input" type="password" placeholder="Temporary password (8+ characters)" value={password} onChange={e=>setPassword(e.target.value)}/><select className="input" value={role} onChange={e=>setRole(e.target.value)}><option value="DISPATCHER">Dispatcher</option><option value="PHARMACY_ADMIN">Pharmacy Admin</option><option value="AUDITOR">Auditor / Read only</option></select><button className="btn" onClick={addUser} disabled={!name||!email||password.length<8}>ADD USER</button>
    {users.map(u=><div className="packageRow" key={u.id}><div><b>{u.name}</b><div className="muted">{u.email} • {u.role.replaceAll('_',' ')}</div></div><button className="smallButton" onClick={()=>toggleUser(u)}>{u.active?'DISABLE':'ENABLE'}</button></div>)}
  </div>
  <div className="card"><div className="big" style={{fontSize:24}}>Print Agent</div><p className="muted">Create one credential per pharmacy PC. The token is shown once.</p><input className="input" value={agentName} onChange={e=>setAgentName(e.target.value)} placeholder="Front Desk PC"/><button className="btn" onClick={createAgent}>CREATE PRINT AGENT TOKEN</button>{newToken&&<div className="warningBox"><b>Copy this token now:</b><div style={{wordBreak:'break-all',marginTop:8,fontFamily:'monospace'}}>{newToken}</div><div className="muted" style={{marginTop:8}}>Set it as DELIVERY_PRINT_AGENT_TOKEN on that PC. It will not be displayed again.</div></div>}{agents.map(a=><div className="packageRow" key={a.id}><div><b>{a.name}</b><div className="muted">{a.active?'Active':'Revoked'} • Last seen {a.lastSeenAt?new Date(a.lastSeenAt).toLocaleString():'Never'}</div></div>{a.active&&<button className="smallButton" onClick={()=>revoke(a)}>REVOKE</button>}</div>)}<a className="btn secondary" href={`/dispatcher?organizationId=${encodeURIComponent(organizationId)}`}>BACK TO DASHBOARD</a></div></main>;
}
