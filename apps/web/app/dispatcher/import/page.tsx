'use client';
import { FormEvent, useEffect, useState } from 'react';
import { userAuthFetch, userToken } from '../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

export default function ImportReceiptPage(){
  const [organizationId,setOrganizationId]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState('');
  useEffect(()=>{if(!userToken()){window.location.replace('/login');return;} const q=new URLSearchParams(window.location.search); const id=q.get('organizationId')||localStorage.getItem('deliveryOrganizationId')||''; if(id)setOrganizationId(id);},[]);

  async function submit(e:FormEvent){
    e.preventDefault();
    if(!file || !organizationId.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try{
      const body=new FormData();
      body.append('organizationId',organizationId.trim());
      body.append('source','MANUAL_UPLOAD');
      body.append('file',file);
      const r=await userAuthFetch(`${API}/api/ingest/pdf`,{method:'POST',body});
      const json=await r.json();
      if(!r.ok) throw new Error(json?.detail||json?.error||'Upload failed');
      setResult(json);
    }catch(err:any){ setError(err?.message||String(err)); }
    finally{ setLoading(false); }
  }

  return <main className="shell">
    <div className="top"><div><div className="big">Import Delivery Receipt</div><div className="muted">PDF parser + automatic driver assignment</div></div><a className="pill" href="/dispatcher">Back</a></div>
    <form className="card" onSubmit={submit}>
      <label className="fieldLabel">Organization ID</label>
      <input className="input" value={organizationId} onChange={e=>setOrganizationId(e.target.value)} placeholder="Paste organization ID" />
      <label className="fieldLabel">Delivery receipt PDF</label>
      <input className="input" type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]||null)} />
      <button className="btn" disabled={loading || !file || !organizationId.trim()}>{loading?'IMPORTING…':'IMPORT RECEIPT'}</button>
    </form>

    {error && <div className="card errorBox"><b>Import failed</b><div>{error}</div></div>}
    {result && <div className="card">
      <div className="top"><div className="big">{result.duplicate?'Receipt recognized':'Delivery created ✓'}</div><span className="pill">{result.import?.status||'PARSED'}</span></div>
      <div className="listrow"><span>Log #</span><b>{result.parsed?.logNumber||result.delivery?.externalLogNumber||'Needs review'}</b></div>
      <div className="listrow"><span>Patient</span><b>{result.delivery?.patientName||'Needs review'}</b></div>
      <div className="listrow"><span>Address</span><b>{[result.parsed?.address1,result.parsed?.city,result.parsed?.state,result.parsed?.postalCode].filter(Boolean).join(', ')||'Needs review'}</b></div>
      <div className="listrow"><span>Driver printed on receipt</span><b>{result.parsed?.driverRaw||'Not detected'}</b></div>
      <div className="listrow"><span>Auto assigned</span><b>{result.autoAssignedDriver?.displayName||result.delivery?.driver?.displayName||'Needs assignment'}</b></div>
      <div className="listrow"><span>Pages</span><b>{result.parsed?.pageCount||result.import?.pageCount||'-'}</b></div>
      <div className="listrow"><span>Rx detected</span><b>{result.parsed?.rxNumbers?.length??'-'}</b></div>
      {!!result.parsed?.warnings?.length && <div className="warningBox"><b>Needs review</b>{result.parsed.warnings.map((w:string)=><div key={w}>• {w}</div>)}</div>}
    </div>}
  </main>
}
