'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { userAuthFetch, userToken } from '../../../../lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL || '';

type Driver={id:string;displayName:string;active:boolean};
type DeliveryDetail = {
  id: string;
  externalLogNumber?: string | null;
  patientName: string;
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude?: number|null;
  longitude?: number|null;
  status: string;
  outcome: string;
  recipientName?: string | null;
  relationship?: string | null;
  completedAt?: string | null;
  exceptionNotes?: string | null;
  barcodeValue?: string | null;
  barcodeVerifiedAt?: string | null;
  hasOriginalPdf: boolean;
  hasSignedPdf: boolean;
  hasSignature: boolean;
  driver?: { id:string; displayName:string; phone?:string|null } | null;
  routeStop?: { id?:string; sequence:number; facilityName?:string|null; route?:{id:string;routeDate:string;startedAt?:string|null;completedAt?:string|null} } | null;
  receiptImports: any[];
  scans: any[];
  audits: any[];
};

async function openProtectedDocument(deliveryId: string, kind: 'original'|'signed'|'signature') {
  const response = await userAuthFetch(`${API}/api/deliveries/${deliveryId}/document/${kind}`, { cache:'no-store' });
  if (!response.ok) {
    let message = 'Document could not be opened';
    try { const body = await response.json(); message = body.error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const deliveryId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [organizationId, setOrganizationId] = useState('');
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [drivers,setDrivers]=useState<Driver[]>([]);
  const [error, setError] = useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);
  const [form,setForm]=useState<any>({});

  const load=async(id=deliveryId,org=organizationId)=>{
    if(!id)return;
    const response = await userAuthFetch(`${API}/api/deliveries/${id}`, { cache:'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load delivery');
    setDelivery(payload.delivery);
    setForm({
      patientName:payload.delivery.patientName,
      address1:payload.delivery.address1,
      address2:payload.delivery.address2||'',
      city:payload.delivery.city,
      state:payload.delivery.state,
      postalCode:payload.delivery.postalCode,
      driverId:payload.delivery.driver?.id||'',
      latitude:payload.delivery.latitude ?? '',
      longitude:payload.delivery.longitude ?? ''
    });
    if(org){
      const dr=await userAuthFetch(`${API}/api/organizations/${org}/drivers`,{cache:'no-store'});
      if(dr.ok){const j=await dr.json();setDrivers(j.drivers||[]);}
    }
  };

  useEffect(() => {
    if (!deliveryId) return;
    if (!userToken()) { window.location.replace('/login'); return; }
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get('organizationId') || localStorage.getItem('deliveryOrganizationId') || '';
    setOrganizationId(id);
    load(deliveryId,id).catch((e:any)=>setError(e.message||'Could not load delivery'));
  }, [deliveryId]);

  if (error) return <main className="shell"><div className="card errorBox">{error}</div></main>;
  if (!delivery) return <main className="shell"><div className="card"><div className="big">Loading…</div></div></main>;

  const openDoc = async (kind:'original'|'signed'|'signature') => {
    try { await openProtectedDocument(delivery.id, kind); }
    catch (e:any) { setMessage(e.message); }
  };

  const save=async()=>{
    setBusy(true);setMessage('');
    const body:any={
      patientName:String(form.patientName||'').trim(),
      address1:String(form.address1||'').trim(),
      address2:String(form.address2||'').trim()||null,
      city:String(form.city||'').trim(),
      state:String(form.state||'').trim(),
      postalCode:String(form.postalCode||'').trim(),
      driverId:form.driverId||null
    };
    if(form.latitude!==''&&form.latitude!=null)body.latitude=Number(form.latitude);
    if(form.longitude!==''&&form.longitude!=null)body.longitude=Number(form.longitude);
    const r=await userAuthFetch(`${API}/api/deliveries/${delivery.id}`,{
      method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)
    });
    const j=await r.json();
    if(!r.ok){setMessage(`⚠ ${j.error||'Could not update delivery.'}`);setBusy(false);return;}
    setMessage('✓ Delivery updated.');setEditing(false);await load(delivery.id,organizationId);setBusy(false);
  };

  const geocode=async()=>{
    setBusy(true);setMessage('Geocoding address…');
    const r=await userAuthFetch(`${API}/api/deliveries/${delivery.id}/geocode`,{method:'POST'});
    const j=await r.json();
    if(!r.ok){setMessage(`⚠ ${j.message||j.error||'Could not geocode address.'}`);setBusy(false);return;}
    setMessage(`✓ Coordinates found: ${j.point.latitude.toFixed(6)}, ${j.point.longitude.toFixed(6)}`);
    await load(delivery.id,organizationId);setBusy(false);
  };

  const removeFromRoute=async()=>{
    if(!confirm('Remove this delivery from its current route?'))return;
    setBusy(true);setMessage('');
    const r=await userAuthFetch(`${API}/api/deliveries/${delivery.id}/remove-from-route`,{method:'POST'});
    const j=await r.json();
    setMessage(r.ok?'✓ Delivery removed from route.':`⚠ ${j.error||'Could not remove delivery from route.'}`);
    if(r.ok)await load(delivery.id,organizationId);
    setBusy(false);
  };

  const deleteDelivery=async()=>{
    if(!confirm(`Delete Log #${delivery.externalLogNumber||delivery.id}? This is only allowed for unused, undelivered imports and cannot be undone.`))return;
    setBusy(true);setMessage('');
    const r=await userAuthFetch(`${API}/api/deliveries/${delivery.id}`,{method:'DELETE'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){setMessage(`⚠ ${j.error||'Could not delete delivery.'}`);setBusy(false);return;}
    window.location.href=`/dispatcher/deliveries?organizationId=${encodeURIComponent(organizationId)}`;
  };

  const locked=['DELIVERED','RETURNED'].includes(delivery.status);

  return <main className="shell dispatcherShell">
    <div className="top">
      <div>
        <div className="eyebrow">LOG #{delivery.externalLogNumber || '—'}</div>
        <div className="big">{delivery.patientName}</div>
        <div className="muted">{delivery.address1}{delivery.address2 ? `, ${delivery.address2}` : ''}, {delivery.city}, {delivery.state} {delivery.postalCode}</div>
      </div>
      <a className="smallButton" href={`/dispatcher/deliveries?organizationId=${encodeURIComponent(organizationId)}`}>Back</a>
    </div>

    {message&&<div className="card warningBox">{message}</div>}

    <div className="grid dashboardGrid">
      <div className="metric"><span className="muted">Status</span><b>{delivery.status.replaceAll('_',' ')}</b></div>
      <div className="metric"><span className="muted">Outcome</span><b>{delivery.outcome.replaceAll('_',' ')}</b></div>
      <div className="metric"><span className="muted">Driver</span><b>{delivery.driver?.displayName || 'Unassigned'}</b></div>
      <div className="metric"><span className="muted">Barcode</span><b>{delivery.barcodeVerifiedAt ? 'Verified ✓' : 'Not verified'}</b></div>
    </div>

    <div className="card">
      <div className="top"><div><div className="big" style={{fontSize:22}}>Manage delivery</div><div className="muted">Correct imported data, assign a driver, or geocode the address.</div></div>
      {!editing&&<button className="smallButton" onClick={()=>setEditing(true)} disabled={locked}>EDIT</button>}</div>

      {delivery.routeStop&&<div className="warningBox">This delivery is currently on Stop {delivery.routeStop.sequence}. Remove it from the route before changing its address or driver.</div>}

      {editing?<>
        <label className="fieldLabel">Patient</label><input className="input" value={form.patientName||''} onChange={e=>setForm({...form,patientName:e.target.value})}/>
        <label className="fieldLabel">Address</label><input className="input" value={form.address1||''} onChange={e=>setForm({...form,address1:e.target.value})}/>
        <input className="input" value={form.address2||''} onChange={e=>setForm({...form,address2:e.target.value})} placeholder="Unit / apartment (optional)" />
        <div className="grid">
          <input className="input" value={form.city||''} onChange={e=>setForm({...form,city:e.target.value})} placeholder="City"/>
          <input className="input" value={form.state||''} onChange={e=>setForm({...form,state:e.target.value})} placeholder="State"/>
        </div>
        <input className="input" value={form.postalCode||''} onChange={e=>setForm({...form,postalCode:e.target.value})} placeholder="ZIP"/>
        <label className="fieldLabel">Driver</label>
        <select className="input" value={form.driverId||''} onChange={e=>setForm({...form,driverId:e.target.value})}>
          <option value="">Unassigned</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.displayName}</option>)}
        </select>
        <label className="fieldLabel">Manual coordinates (optional)</label>
        <div className="grid">
          <input className="input" value={form.latitude??''} onChange={e=>setForm({...form,latitude:e.target.value})} placeholder="Latitude"/>
          <input className="input" value={form.longitude??''} onChange={e=>setForm({...form,longitude:e.target.value})} placeholder="Longitude"/>
        </div>
        <button className="btn" onClick={save} disabled={busy}>SAVE DELIVERY</button>
        <button className="btn secondary" onClick={()=>{setEditing(false);setMessage('')}} disabled={busy}>CANCEL</button>
      </>:<>
        <div className="listrow"><span>Coordinates</span><b>{delivery.latitude!=null&&delivery.longitude!=null?`${delivery.latitude.toFixed(6)}, ${delivery.longitude.toFixed(6)}`:'Missing'}</b></div>
        <button className="btn secondary" onClick={geocode} disabled={busy||!!delivery.routeStop}>GEOCODE / REFRESH COORDINATES</button>
        {delivery.routeStop&&<button className="btn secondary" onClick={removeFromRoute} disabled={busy||!!delivery.routeStop.route?.startedAt}>REMOVE FROM ROUTE</button>}
        {!locked&&<button className="btn secondary" onClick={deleteDelivery} disabled={busy} style={{borderColor:'#b91c1c',color:'#b91c1c'}}>DELETE UNUSED DELIVERY</button>}
      </>}
      {locked&&<div className="muted">Completed deliveries are locked to preserve proof and audit history.</div>}
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Documents</div>
      <button className="btn secondary" disabled={!delivery.hasOriginalPdf} onClick={() => openDoc('original')}>VIEW ORIGINAL RECEIPT</button>
      <button className="btn" disabled={!delivery.hasSignedPdf} onClick={() => openDoc('signed')}>VIEW SIGNED RECEIPT</button>
      <button className="btn secondary" disabled={!delivery.hasSignature} onClick={() => openDoc('signature')}>VIEW SIGNATURE</button>
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Delivery proof</div>
      <div className="listrow"><span>Recipient</span><b>{delivery.recipientName || '—'}</b></div>
      <div className="listrow"><span>Relationship</span><b>{delivery.relationship?.replaceAll('_',' ') || '—'}</b></div>
      <div className="listrow"><span>Completed</span><b>{delivery.completedAt ? new Date(delivery.completedAt).toLocaleString() : '—'}</b></div>
      <div className="listrow"><span>Barcode value</span><b>{delivery.barcodeValue || '—'}</b></div>
      {delivery.exceptionNotes && <div className="warningBox">{delivery.exceptionNotes}</div>}
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Receipt imports</div>
      {delivery.receiptImports.map((r:any) => <div className="packageRow" key={r.id}>
        <div><b>{r.originalFilename || 'Receipt PDF'}</b><div className="muted">{r.source} • {r.template || 'Unknown template'}</div></div>
        <div style={{textAlign:'right'}}><b>{r.status}</b><div className="muted">{new Date(r.createdAt).toLocaleString()}</div></div>
      </div>)}
      {!delivery.receiptImports.length && <div className="muted">No receipt import history.</div>}
    </div>

    <div className="card">
      <div className="big" style={{fontSize:22}}>Audit timeline</div>
      {delivery.audits.map((a:any) => <div className="packageRow" key={a.id}>
        <div><b>{a.type.replaceAll('_',' ')}</b><div className="muted">{a.details ? JSON.stringify(a.details) : ''}</div></div>
        <div className="muted">{new Date(a.createdAt).toLocaleString()}</div>
      </div>)}
      {!delivery.audits.length && <div className="muted">No audit events yet.</div>}
    </div>
  </main>;
}
