import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const EVENT_CENTER = [51.5771791, 4.7351289];
const QUEUE_KEY    = 'smet_public_queue';

function getQueue()   { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function enqueue(item){ const q = getQueue(); q.push(item); localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

async function drainQueue() {
  const q = getQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      const res = await fetch('/api/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
      if (!res.ok) remaining.push(item);
    } catch { remaining.push(item); }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
}

// ─── Draggable map marker ─────────────────────────────────────────────────────

const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#3b82f6;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5);transform:rotate(-45deg)"></div>`,
  iconSize:   [28, 28],
  iconAnchor: [14, 28],
});

function MapPicker({ position, onChange }) {
  useMapEvents({
    click(e) { onChange([e.latlng.lat, e.latlng.lng]); },
  });
  return position
    ? <Marker position={position} icon={PIN_ICON} draggable eventHandlers={{ dragend: e => onChange([e.target.getLatLng().lat, e.target.getLatLng().lng]) }} />
    : null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PublicReportView() {
  const [name,         setName]         = useState('');
  const [description,  setDescription]  = useState('');
  const [urgent,       setUrgent]       = useState(false);
  const [gps,          setGps]          = useState(null);
  const [gpsStatus,    setGpsStatus]    = useState('idle');
  const [showMap,      setShowMap]      = useState(false);
  const [mapPos,       setMapPos]       = useState(null);
  const [submitted,    setSubmitted]    = useState(false);
  const [sending,      setSending]      = useState(false);
  const [activeEvent,  setActiveEvent]  = useState(null);
  const didGps = useRef(false);

  // Drain offline queue on reconnect
  useEffect(() => {
    window.addEventListener('online', drainQueue);
    drainQueue();
    return () => window.removeEventListener('online', drainQueue);
  }, []);

  // Load active event + teams
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        setActiveEvent(s.active_event ?? null);
      })
      .catch(() => {});
  }, []);

  // Auto-GPS on mount
  useEffect(() => {
    if (didGps.current) return;
    didGps.current = true;
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    setGpsStatus('loading');
    navigator.geolocation.getCurrentPosition(
      pos => { setGps([pos.coords.latitude, pos.coords.longitude]); setGpsStatus('ok'); },
      ()  => { setGpsStatus('error'); setShowMap(true); },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, []);

  const location = mapPos ?? gps; // prefer manual map pin over auto GPS

  async function submit() {
    if (sending) return;
    setSending(true);
    const payload = {
      reporter:   name.trim() || 'Omstander',
      priority:   urgent ? 'high' : 'medium',
      complaint:     description.trim() || undefined,
      lat:           location?.[0] ?? undefined,
      lng:           location?.[1] ?? undefined,
      event_id:      activeEvent?.id   ?? undefined,
      event_name:    activeEvent?.name ?? undefined,
    };
    try {
      const res = await fetch('/api/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
    } catch {
      enqueue(payload);
    }
    setSubmitted(true);
    setSending(false);
  }

  // ── Success screen ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6 text-center page-enter">
        <div className="text-6xl mb-6">✅</div>
        <h1 className="text-white text-2xl font-bold mb-2">Melding ontvangen</h1>
        <p className="text-slate-400 text-sm mb-8">De hulpverleners zijn op de hoogte gebracht. Bedankt voor je melding.</p>
        <button
          onClick={() => { setSubmitted(false); setDescription(''); setName(''); setUrgent(false); setMapPos(null); setGps(null); setGpsStatus('idle'); didGps.current = false; }}
          className="text-sm text-slate-400 hover:text-white underline transition-colors"
        >
          Nieuwe melding maken
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col page-enter">

      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-5 py-4">
        <h1 className="text-white font-bold text-xl">Incident melden</h1>
        <p className="text-slate-500 text-xs mt-0.5">Voor omstanders — vul in wat je ziet</p>
        {activeEvent && (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <span className="text-green-400 text-xs font-semibold">{activeEvent.name}</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-5 py-5 flex flex-col gap-5 max-w-lg mx-auto w-full">

        {/* Is it urgent? */}
        <div>
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Hoe dringend?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setUrgent(false)}
              className={`py-3 rounded-2xl font-bold text-sm border-2 transition-all
                ${!urgent ? 'bg-yellow-400/20 border-yellow-400 text-yellow-300' : 'bg-slate-800 border-transparent text-slate-500'}`}
            >
              Normaal
            </button>
            <button
              onClick={() => setUrgent(true)}
              className={`py-3 rounded-2xl font-bold text-sm border-2 transition-all
                ${urgent ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-800 border-transparent text-slate-500'}`}
            >
              🚨 Urgent
            </button>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 block">
            Wat is er aan de hand? <span className="text-slate-600 normal-case font-normal">(verplicht)</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Beschrijf kort wat je ziet of hebt meegemaakt…"
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl text-white text-sm px-4 py-3 focus:outline-none focus:border-blue-500 resize-none placeholder-slate-600"
          />
        </div>

        {/* Location */}
        <div>
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Locatie</p>

          {gpsStatus === 'loading' && (
            <div className="bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-slate-400 text-sm animate-pulse">📍 GPS ophalen…</span>
            </div>
          )}

          {gpsStatus === 'ok' && !mapPos && (
            <div className="bg-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-sm">📍</span>
                <span className="text-green-400 text-sm font-semibold">Locatie gevonden</span>
              </div>
              <button onClick={() => setShowMap(v => !v)} className="text-xs text-slate-400 hover:text-white underline">
                {showMap ? 'Verberg kaart' : 'Aanpassen'}
              </button>
            </div>
          )}

          {(gpsStatus === 'error' || mapPos) && !showMap && (
            <div className="bg-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {mapPos
                  ? <><span className="text-blue-400 text-sm">📍</span><span className="text-blue-400 text-sm font-semibold">Locatie op kaart geplaatst</span></>
                  : <><span className="text-orange-400 text-sm">⚠</span><span className="text-orange-400 text-sm">GPS niet beschikbaar</span></>
                }
              </div>
              <button onClick={() => setShowMap(v => !v)} className="text-xs text-slate-400 hover:text-white underline">
                {showMap ? 'Verberg kaart' : 'Kies op kaart'}
              </button>
            </div>
          )}

          {gpsStatus === 'idle' && (
            <button
              onClick={() => setShowMap(v => !v)}
              className="w-full bg-slate-800 hover:bg-slate-700 rounded-2xl px-4 py-3 text-slate-400 text-sm text-left transition-colors"
            >
              📍 Kies locatie op kaart (optioneel)
            </button>
          )}

          {/* Map */}
          {showMap && (
            <div className="mt-2 rounded-2xl overflow-hidden border border-slate-700" style={{ height: 240 }}>
              <MapContainer
                center={gps ?? EVENT_CENTER}
                zoom={15}
                style={{ width: '100%', height: '100%' }}
                zoomControl={false}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
                <MapPicker position={mapPos ?? gps} onChange={setMapPos} />
              </MapContainer>
            </div>
          )}
          {showMap && (
            <p className="text-slate-600 text-xs mt-1.5 text-center">Tik op de kaart of sleep de pin naar de juiste plek</p>
          )}
        </div>

        {/* Optional name */}
        <div>
          <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 block">
            Jouw naam <span className="text-slate-600 normal-case font-normal">(optioneel)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Omstander"
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl text-white text-sm px-4 py-3 focus:outline-none focus:border-blue-500 placeholder-slate-600"
          />
        </div>

        {/* Submit */}
        <button
          onClick={submit}
          disabled={sending || !description.trim()}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all
            ${urgent
              ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-900/40'
              : 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/40'}
            text-white disabled:cursor-not-allowed disabled:text-white/40`}
        >
          {sending ? 'Verzenden…' : '🚨 Melding versturen'}
        </button>

        <p className="text-slate-700 text-xs text-center pb-4">
          Werkt offline — de melding wordt verstuurd zodra je weer verbinding hebt.
        </p>
      </div>
    </div>
  );
}
