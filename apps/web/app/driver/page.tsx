'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { enqueueRequest, flushQueue, getOfflineValue, queuedRequestCount, setOfflineValue } from '../../lib/offline';

const API = process.env.NEXT_PUBLIC_API_URL || '';

function getDeviceToken() { return typeof window !== 'undefined' ? (localStorage.getItem('deliveryDeviceToken') || '') : ''; }
function authFetch(url: string, init: RequestInit = {}) {
  const token = getDeviceToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
const ROUTE_CACHE_KEY = 'today-route';

type Relationship = 'SELF'|'CAREGIVER'|'PARENT'|'SIBLING'|'CHILD'|'FACILITY_STAFF'|'OTHER';
type Delivery = {
  id: string;
  externalLogNumber?: string | null;
  patientName: string;
  barcodeValue?: string | null;
  barcodeVerifiedAt?: string | null;
  outcome: string;
};
type Stop = {
  id: string;
  sequence: number;
  facilityName?: string | null;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  driveMinutesFromPrevious?: number;
  arrivedAt?: string | null;
  completedAt?: string | null;
  deliveries: Delivery[];
};
type Route = { id: string; plannedDrivingMinutes: number; startedAt?: string | null; stops: Stop[]; driver: { id: string; displayName: string }; organization?: { dispatcherPhone?: string | null } };
type Step = 'route'|'verify'|'result'|'signature'|'confirm'|'done';

type ExceptionChoice = {
  outcome: 'RECIPIENT_NOT_AVAILABLE'|'REFUSED'|'PACKAGE_NOT_PROVIDED'|'UNABLE_TO_ACCESS'|'WRONG_PACKAGE'|'OTHER';
  notes?: string;
};

function minsToText(value: number) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? `${h} hr ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    };
    fit();
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const p = point(event);
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = point(event);
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inkRef.current = true;
    setHasInk(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current!;
    onChange(inkRef.current ? canvas.toDataURL('image/png') : '');
  };
  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    inkRef.current = false;
    setHasInk(false);
    onChange('');
  };

  return <>
    <canvas
      ref={canvasRef}
      className="signaturePad"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Signature pad"
    />
    <button type="button" className="smallButton" onClick={clear}>CLEAR SIGNATURE</button>
  </>;
}

function Scanner({ stopId, deliveries, onVerified, onOfflineVerified }: { stopId: string; deliveries: Delivery[]; onVerified: (payload: any) => void; onOfflineVerified: (deliveryId: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const running = useRef(false);
  const [message, setMessage] = useState('Point the camera at the delivery barcode.');
  const [manual, setManual] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  const submit = async (value: string) => {
    const clean = value.trim().replace(/^\*|\*$/g, '');
    if (!clean) return;
    const body: any = { scannedValue: clean };
    if (!navigator.onLine) {
      const match = deliveries.find(d => String(d.barcodeValue || d.externalLogNumber || '').replace(/^\*|\*$/g, '') === clean);
      if (!match) { navigator.vibrate?.([250,120,250]); setMessage('WRONG PACKAGE — do not deliver.'); return; }
      if (match.barcodeVerifiedAt) { setMessage('Already scanned ✓'); return; }
      await enqueueRequest({ path: `/api/route-stops/${stopId}/scan`, method: 'POST', body });
      navigator.vibrate?.(100);
      setMessage(`Verified offline ✓ ${match.patientName}`);
      onOfflineVerified(match.id);
      return;
    }
    try {
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition(
          pos => { body.latitude = pos.coords.latitude; body.longitude = pos.coords.longitude; resolve(); },
          () => resolve(), { enableHighAccuracy: false, timeout: 2500 }
        ));
      }
      const response = await authFetch(`${API}/api/route-stops/${stopId}/scan`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        navigator.vibrate?.([250, 120, 250]);
        setMessage(payload.message || 'WRONG PACKAGE — do not deliver.');
        return;
      }
      navigator.vibrate?.(100);
      setMessage(payload.duplicateScan ? 'Already scanned ✓' : `Verified ✓ ${payload.delivery.patientName}`);
      onVerified(payload);
    } catch {
      setMessage('Could not verify. Check connection and try again.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (!Detector || !navigator.mediaDevices?.getUserMedia) return;
        const detector = new Detector({ formats: ['code_128','code_39','ean_13','qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);
        running.current = true;
        let last = '';
        let lastAt = 0;
        const loop = async () => {
          if (!running.current) return;
          try {
            const found = await detector.detect(video);
            if (found?.length) {
              const value = String(found[0].rawValue || '').trim();
              const now = Date.now();
              if (value && (value !== last || now - lastAt > 2500)) {
                last = value; lastAt = now;
                await submit(value);
              }
            }
          } catch {}
          window.setTimeout(loop, 350);
        };
        loop();
      } catch {
        setMessage('Camera unavailable. Use the barcode number box below.');
      }
    };
    start();
    return () => {
      cancelled = true;
      running.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [stopId]);

  return <div>
    <div className="scannerFrame">
      <video ref={videoRef} playsInline muted className="scannerVideo" />
      {!cameraReady && <div className="scannerFallback">CAMERA SCANNER</div>}
    </div>
    <div className="scanMessage">{message}</div>
    <label className="fieldLabel">Barcode number (backup)</label>
    <div className="inlineControls">
      <input className="input" inputMode="numeric" value={manual} onChange={e => setManual(e.target.value)} placeholder="Scan or type number" />
      <button className="smallButton primarySmall" onClick={() => { submit(manual); setManual(''); }}>VERIFY</button>
    </div>
  </div>;
}

function ReturnReminder({ driverId }: { driverId: string }) {
  const [items,setItems]=useState<Delivery[]>([]);
  useEffect(()=>{
    if (!driverId) return;
    const token=getDeviceToken();
    authFetch(token ? `${API}/api/driver/returns` : `${API}/api/drivers/${driverId}/returns`).then(r=>r.json()).then(p=>setItems(p.deliveries||[])).catch(()=>{});
  },[driverId]);
  if(!items.length) return <div className="muted centered">No packages need to return.</div>;
  return <div className="returnBox"><div className="eyebrow">RETURN TO PHARMACY</div><div className="big">{items.length} package{items.length===1?'':'s'} to return</div>{items.map(i=><div className="packageRow" key={i.id}><div><b>{i.patientName}</b><div className="muted">Log #{i.externalLogNumber||'—'}</div></div><div className="warnMark">↩</div></div>)}<div className="warningBox">Bring these package(s) back to the pharmacy. Dispatcher will confirm the return.</div></div>;
}

export default function Driver() {
  const [route, setRoute] = useState<Route | null>(null);
  const [stopIndex, setStopIndex] = useState(0);
  const [step, setStep] = useState<Step>('route');
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exceptions, setExceptions] = useState<Record<string, ExceptionChoice>>({});
  const [recipientName, setRecipientName] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('FACILITY_STAFF');
  const [signature, setSignature] = useState('');
  const [notes, setNotes] = useState('');
  const [eta, setEta] = useState<{ remainingStops: number; remainingMinutes: number; estimatedFinishAt: string } | null>(null);
  const [queued, setQueued] = useState(0);
  const [syncConflict, setSyncConflict] = useState('');

  const stop = route?.stops[stopIndex];
  const verifiedCount = stop?.deliveries.filter(d => !!d.barcodeVerifiedAt).length || 0;
  const expectedCount = stop?.deliveries.length || 0;
  const unaccounted = stop?.deliveries.filter(d => !d.barcodeVerifiedAt && !exceptions[d.id]) || [];
  const deliveredIds = stop?.deliveries.filter(d => !!d.barcodeVerifiedAt && !exceptions[d.id]).map(d => d.id) || [];

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    setOnline(navigator.onLine);
    const syncNow = async () => {
      setOnline(true);
      const token=getDeviceToken();
      if(token){
        const sync=await flushQueue(API,token).catch(()=>null);
        if(sync?.conflict) setSyncConflict('Route changed while this phone was offline. Please call the dispatcher before continuing.');
        else setSyncConflict('');
      }
      setQueued(await queuedRequestCount().catch(()=>0));
      try {
        const response=await authFetch(token ? `${API}/api/driver/today` : `${API}/api/drivers/${localStorage.getItem('deliveryDriverId')}/today`,{cache:'no-store'});
        const payload=await response.json();
        if(response.ok && payload.route){
          const firstOpen=Math.max(0,payload.route.stops.findIndex((s:any)=>!s.completedAt));
          setRoute(payload.route); setStopIndex(firstOpen<0?0:firstOpen); await setOfflineValue(ROUTE_CACHE_KEY,payload.route);
        }
      } catch {}
    };
    const on=()=>{ syncNow(); };
    const off=()=>setOnline(false);
    window.addEventListener('online',on); window.addEventListener('offline',off);
    const load=async()=>{
      const qs=new URLSearchParams(window.location.search);
      const token=getDeviceToken();
      const driverId=qs.get('driverId')||localStorage.getItem('deliveryDriverId');
      if(!token && !driverId){ window.location.replace('/enroll'); return; }
      if(driverId) localStorage.setItem('deliveryDriverId',driverId);
      try {
        const response=await authFetch(token ? `${API}/api/driver/today` : `${API}/api/drivers/${driverId}/today`,{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok) throw new Error(payload.error||'Could not load route');
        if(!payload.route) setError('No route assigned today.');
        else {
          const firstOpen=Math.max(0,payload.route.stops.findIndex((s:any)=>!s.completedAt));
          setRoute(payload.route); setStopIndex(firstOpen<0?0:firstOpen); await setOfflineValue(ROUTE_CACHE_KEY,payload.route);
        }
      } catch {
        const cached=await getOfflineValue<Route>(ROUTE_CACHE_KEY).catch(()=>null);
        if(cached){
          const firstOpen=Math.max(0,cached.stops.findIndex(s=>!s.completedAt));
          setRoute(cached); setStopIndex(firstOpen<0?0:firstOpen); setError('Offline — using the saved route.');
        } else setError('Could not load today\'s route. Connect to the internet once before leaving the pharmacy.');
      }
      setQueued(await queuedRequestCount().catch(()=>0));
      setLoading(false);
    };
    load();
    return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};
  }, []);

  const remainingStops = eta?.remainingStops ?? (route ? route.stops.filter(s => !s.completedAt).length : 0);
  const remainingMinutes = eta?.remainingMinutes ?? 0;
  const finishText = useMemo(() => eta?.estimatedFinishAt ? new Date(eta.estimatedFinishAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—', [eta]);

  const refreshEta = async (routeId = route?.id) => {
    if (!routeId) return;
    if (!navigator.onLine && route) {
      const remaining=route.stops.filter(s=>!s.completedAt);
      const mins=remaining.reduce((sum,s,i)=>sum+(i===0&&s.arrivedAt?0:Number(s.driveMinutesFromPrevious||0))+5,0);
      setEta({remainingStops:remaining.length,remainingMinutes:mins,estimatedFinishAt:new Date(Date.now()+mins*60000).toISOString()});
      return;
    }
    try {
      const response = await authFetch(`${API}/api/routes/${routeId}/summary`, { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok) setEta({ remainingStops: payload.remainingStops, remainingMinutes: payload.remainingDrivingMinutes + payload.remainingServiceMinutes, estimatedFinishAt: payload.estimatedFinishAt });
    } catch {}
  };

  useEffect(() => {
    if (!route?.id) return;
    refreshEta(route.id);
    const timer = window.setInterval(() => refreshEta(route.id), 15000);
    return () => window.clearInterval(timer);
  }, [route?.id]);

  const refreshStop = async () => {
    if (!stop || !route || !navigator.onLine) return;
    const response = await authFetch(`${API}/api/route-stops/${stop.id}`);
    const payload = await response.json();
    setRoute({ ...route, stops: route.stops.map(s => s.id === stop.id ? payload.stop : s) });
  };

  const arrive = async () => {
    if (!stop || !route) return;
    if (!navigator.onLine) {
      if (!route.startedAt) await enqueueRequest({path:`/api/routes/${route.id}/start`,method:'POST'});
      await enqueueRequest({path:`/api/route-stops/${stop.id}/arrive`,method:'POST',body:{}});
      const updated={...route,startedAt:route.startedAt||new Date().toISOString(),stops:route.stops.map(s=>s.id===stop.id?{...s,arrivedAt:new Date().toISOString()}:s)};
      setRoute(updated); await setOfflineValue(ROUTE_CACHE_KEY,updated); setQueued(await queuedRequestCount()); setStep('verify'); refreshEta(route.id); return;
    }
    if (!route.startedAt) {
      const started = await authFetch(`${API}/api/routes/${route.id}/start`, { method: 'POST' });
      if (started.ok) setRoute({ ...route, startedAt: new Date().toISOString() });
    }
    await authFetch(`${API}/api/route-stops/${stop.id}/arrive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await refreshEta(route.id);
    setStep('verify');
  };

  const setException = (deliveryId: string, outcome: ExceptionChoice['outcome']) => {
    setExceptions(prev => ({ ...prev, [deliveryId]: { outcome } }));
  };

  const complete = async () => {
    if (!stop) return;
    setLoading(true); setError('');
    const body: any = {
      deliveredIds,
      exceptions: Object.entries(exceptions).map(([deliveryId, value]) => ({ deliveryId, ...value })),
      recipientName: deliveredIds.length ? recipientName : undefined,
      relationship: deliveredIds.length ? relationship : undefined,
      signatureDataUrl: deliveredIds.length ? signature : undefined,
      notes
    };
    if (navigator.geolocation) {
      await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition(
        p => { body.latitude = p.coords.latitude; body.longitude = p.coords.longitude; resolve(); },
        () => resolve(), { timeout: 2500 }
      ));
    }
    if (!navigator.onLine) {
      await enqueueRequest({ path: `/api/route-stops/${stop.id}/complete`, method: 'POST', body });
      if (route) {
        const updated={...route,stops:route.stops.map(s=>s.id===stop.id?{...s,completedAt:new Date().toISOString()}:s)};
        setRoute(updated); await setOfflineValue(ROUTE_CACHE_KEY,updated); await refreshEta(route.id);
      }
      setQueued(await queuedRequestCount()); setStep('done'); setLoading(false); return;
    }
    try {
      const response = await authFetch(`${API}/api/route-stops/${stop.id}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not complete stop');
      if (route) {
        const updated={ ...route, stops: route.stops.map(s => s.id === stop.id ? { ...s, completedAt: new Date().toISOString() } : s) };
        setRoute(updated); await setOfflineValue(ROUTE_CACHE_KEY,updated);
        await refreshEta(route.id);
      }
      setStep('done');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const nextStop = () => {
    if (!route) return;
    const next = stopIndex + 1;
    if (next >= route.stops.length) return;
    setStopIndex(next); setStep('route'); setExceptions({}); setRecipientName(''); setSignature(''); setNotes('');
    refreshEta(route.id);
  };

  if (loading && !route) return <main className="shell"><div className="card"><div className="big">Loading route…</div></div></main>;
  if (error && !route) return <main className="shell"><div className="card"><div className="big">Driver</div><div className="errorBox card">{error}</div></div></main>;
  if (!route || !stop) return null;

  const destination = encodeURIComponent(`${stop.address1}, ${stop.city}, ${stop.state} ${stop.postalCode}`);

  return <main className="shell driverShell">
    {syncConflict && <div className="warningBox"><b>SYNC NEEDS ATTENTION</b><div>{syncConflict}</div></div>}
    <div className="top compactTop">
      <div><b className="driverName">{route.driver.displayName}</b><div className="muted">{remainingStops} stops remaining</div></div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>{queued>0&&<span className="pill">{queued} waiting</span>}<span className={`pill ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span></div>
    </div>

    {error && <div className="errorBox card">{error}</div>}

    {step === 'route' && <div className="card focusCard">
      <div className="eyebrow">NEXT STOP • {stop.sequence}</div>
      <div className="big">{stop.facilityName || stop.address1}</div>
      <p className="addressText">{stop.address1}<br />{stop.city}, {stop.state} {stop.postalCode}</p>
      <div className="grid routeMetrics">
        <div className="metric"><span className="muted">Packages</span><b>{expectedCount}</b></div>
        <div className="metric"><span className="muted">Est. finish</span><b>{finishText}</b></div>
      </div>
      <div className="muted centered">About {minsToText(remainingMinutes)} remaining • includes 5 min per stop</div>
      <a className="btn navButton" href={`https://www.google.com/maps/dir/?api=1&destination=${destination}`} target="_blank">NAVIGATE</a>
      <button className="btn" onClick={arrive}>I ARRIVED</button>
    </div>}

    {step === 'verify' && <div className="card focusCard">
      <div className="eyebrow">SCAN PACKAGES</div>
      <div className="scanCount">{verifiedCount} / {expectedCount}</div>
      <div className="muted centered">Scan every package before delivery.</div>
      <Scanner stopId={stop.id} deliveries={stop.deliveries} onVerified={refreshStop} onOfflineVerified={async deliveryId=>{ if(!route||!stop)return; const updated={...route,stops:route.stops.map(s=>s.id===stop.id?{...s,deliveries:s.deliveries.map(d=>d.id===deliveryId?{...d,barcodeVerifiedAt:new Date().toISOString()}:d)}:s)}; setRoute(updated); await setOfflineValue(ROUTE_CACHE_KEY,updated); setQueued(await queuedRequestCount()); }} />
      <div className="packageList">
        {stop.deliveries.map(d => <div className="packageRow" key={d.id}>
          <div><b>{d.patientName}</b><div className="muted">Log #{d.externalLogNumber || '—'}</div></div>
          <div className={d.barcodeVerifiedAt ? 'goodMark' : exceptions[d.id] ? 'warnMark' : 'pendingMark'}>
            {d.barcodeVerifiedAt ? '✓' : exceptions[d.id] ? '!' : '○'}
          </div>
        </div>)}
      </div>
      {unaccounted.length > 0 && <button className="btn secondary" onClick={() => setStep('result')}>PACKAGE MISSING / DELIVERY PROBLEM</button>}
      {(verifiedCount + Object.keys(exceptions).length) === expectedCount && <button className="btn" onClick={() => setStep('result')}>CONTINUE</button>}
    </div>}

    {step === 'result' && <div className="card focusCard">
      <div className="eyebrow">ACCOUNT FOR EVERY PACKAGE</div>
      <div className="big">Delivery result</div>
      {stop.deliveries.map(d => <div className="resultItem" key={d.id}>
        <div><b>{d.patientName}</b><div className="muted">Log #{d.externalLogNumber || '—'}</div></div>
        {d.barcodeVerifiedAt && !exceptions[d.id] ? <div className="goodLabel">SCANNED ✓</div> : <div className="choiceStack">
          <button className={`choiceButton ${exceptions[d.id]?.outcome === 'PACKAGE_NOT_PROVIDED' ? 'selected' : ''}`} onClick={() => setException(d.id, 'PACKAGE_NOT_PROVIDED')}>NOT GIVEN TO ME</button>
          <button className={`choiceButton ${exceptions[d.id]?.outcome === 'RECIPIENT_NOT_AVAILABLE' ? 'selected' : ''}`} onClick={() => setException(d.id, 'RECIPIENT_NOT_AVAILABLE')}>PERSON NOT AVAILABLE</button>
          <button className={`choiceButton ${exceptions[d.id]?.outcome === 'REFUSED' ? 'selected' : ''}`} onClick={() => setException(d.id, 'REFUSED')}>REFUSED</button>
        </div>}
      </div>)}
      <button className="btn" disabled={unaccounted.length > 0} onClick={() => deliveredIds.length ? setStep('signature') : setStep('confirm')}>CONTINUE</button>
      {unaccounted.length > 0 && <div className="warningBox">{unaccounted.length} package(s) still need a result.</div>}
    </div>}

    {step === 'signature' && <div className="card focusCard">
      <div className="eyebrow">DELIVERY SIGNATURE</div>
      <div className="big">Who received it?</div>
      <label className="fieldLabel">Name</label>
      <input className="input" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Recipient name" autoComplete="off" />
      <div className="relationshipGrid">
        {([
          ['SELF','SELF'], ['CAREGIVER','CAREGIVER'], ['FACILITY_STAFF','STAFF'], ['PARENT','PARENT'], ['CHILD','CHILD'], ['OTHER','OTHER']
        ] as [Relationship,string][]).map(([value,label]) => <button key={value} className={`relationButton ${relationship === value ? 'selected' : ''}`} onClick={() => setRelationship(value)}>{label}</button>)}
      </div>
      <div className="fieldLabel signatureLabel">SIGN BELOW</div>
      <SignaturePad onChange={setSignature} />
      <button className="btn" disabled={!recipientName.trim() || !signature} onClick={() => setStep('confirm')}>CONTINUE</button>
    </div>}

    {step === 'confirm' && <div className="card focusCard">
      <div className="eyebrow">FINAL CHECK</div>
      <div className="big">Everything accounted for?</div>
      <div className="summaryBlock">
        <div><span>Expected</span><b>{expectedCount}</b></div>
        <div><span>Delivering</span><b>{deliveredIds.length}</b></div>
        <div><span>Exceptions</span><b>{Object.keys(exceptions).length}</b></div>
        <div><span>Missing result</span><b>{unaccounted.length}</b></div>
      </div>
      <label className="fieldLabel">Notes (optional)</label>
      <textarea className="input notesArea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Only if needed" />
      <button className="btn" disabled={loading || unaccounted.length > 0} onClick={complete}>{loading ? 'SAVING…' : 'COMPLETE STOP'}</button>
      <button className="btn secondary" onClick={() => setStep(deliveredIds.length ? 'signature' : 'result')}>BACK</button>
    </div>}

    {step === 'done' && <div className="card focusCard doneCard">
      <div className="doneCheck">✓</div>
      <div className="big">Stop complete</div>
      <p>{deliveredIds.length} delivered • {Object.keys(exceptions).length} exception(s)</p>
      {stopIndex + 1 < route.stops.length ? <button className="btn" onClick={nextStop}>NEXT STOP</button> : <><div className="goodLabel largeGood">ROUTE COMPLETE</div><ReturnReminder driverId={route.driver.id} /></>}
    </div>}

    <a className="btn secondary helpButton" href={`tel:${route.organization?.dispatcherPhone || ''}`}>NEED HELP</a>
  </main>;
}
