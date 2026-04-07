import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { playAlert } from '../lib/alert';

// ─── Offline queue ────────────────────────────────────────────────────────────

const QUEUE_KEY = 'smet_offline_queue';
function getQueue()    { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function enqueue(item) { const q = getQueue(); q.push(item); localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRole(role) {
  return role
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

function suppliesToText(supplies, materials) {
  return materials
    .filter(({ key }) => supplies[key] > 0)
    .map(({ key, label }) => `${supplies[key]}x ${label}`)
    .join(', ');
}

function emptySupplies(list) {
  return Object.fromEntries(list.map(s => [s.key, 0]));
}

const PRIORITY_COLOR = { high: '#ef4444', medium: '#eab308', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'HOOG', medium: 'MID', low: 'LAAG' };
const PRIORITIES = [
  { value: 'low',    label: 'LAAG',  color: '#22c55e' },
  { value: 'medium', label: 'MID',   color: '#eab308' },
  { value: 'high',   label: 'HOOG',  color: '#ef4444' },
];

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

const FALLBACK_MATERIALS = [
  { key: 'pleisters',         label: 'Pleisters',    icon: '🩹' },
  { key: 'zwachtel',          label: 'Zwachtel',     icon: '🫧' },
  { key: 'desinfectiemiddel', label: 'Desinfectie',  icon: '🧴' },
  { key: 'noodfolie',         label: 'Noodfolie',    icon: '🪙' },
  { key: 'coldpack',          label: 'Coldpack',     icon: '🧊' },
  { key: 'pijnstillers',      label: 'Pijnstillers', icon: '💊' },
];

// ─── Map picker ───────────────────────────────────────────────────────────────

const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#3b82f6;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
  iconSize: [28, 28], iconAnchor: [14, 28],
});

function MapPicker({ position, onChange }) {
  useMapEvents({ click: e => onChange([e.latlng.lat, e.latlng.lng]) });
  return position
    ? <Marker position={position} icon={PIN_ICON} draggable eventHandlers={{ dragend: e => onChange([e.target.getLatLng().lat, e.target.getLatLng().lng]) }} />
    : null;
}

// ─── Incident card (with materials + close) ───────────────────────────────────

function IncidentCard({ inc, materials, onClose, onReject }) {
  const [supplies, setSupplies]         = useState(() => emptySupplies(materials));
  const [notes, setNotes]               = useState('');
  const [closing, setClosing]           = useState(false);
  const [showReject, setShowReject]     = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]       = useState(false);
  const color = PRIORITY_COLOR[inc.priority] || '#94a3b8';

  const handleClose = async () => {
    setClosing(true);
    const supplyText  = suppliesToText(supplies, materials);
    const fullNotes   = [supplyText, notes.trim()].filter(Boolean).join('\n');
    await fetch(`/api/incidents/${inc.id}/close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: fullNotes || undefined }),
    });
    onClose(inc.id);
    setClosing(false);
  };

  const handleReject = async () => {
    setRejecting(true);
    await fetch(`/api/incidents/${inc.id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: inc.assigned_team, reason: rejectReason }),
    });
    onReject(inc.id);
    setRejecting(false);
  };

  return (
    <div className="w-full max-w-lg rounded-2xl overflow-hidden bg-slate-800" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <span className="text-white font-bold text-sm">{inc.reporter}</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs">{fmtTime(inc.created_at)}</span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: color + '33', color }}>
              {PRIORITY_LABEL[inc.priority]}
            </span>
          </div>
        </div>
        {inc.complaint && <p className="text-slate-400 text-sm mt-1">{inc.complaint}</p>}
        {inc.event_name && <p className="text-slate-600 text-xs mt-0.5">📅 {inc.event_name}</p>}
        {inc.lat && inc.lng
          ? <a href={`https://maps.google.com/?q=${inc.lat},${inc.lng}`} target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-400 text-xs underline">📍 Open locatie in Maps</a>
          : <p className="text-slate-600 text-xs mt-1 italic">Geen GPS locatie</p>
        }
      </div>

      {/* Materials */}
      <div className="px-4 pt-3">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Gebruikt materiaal</p>
        <div className="grid grid-cols-3 gap-2">
          {materials.map(({ key, label, icon }) => {
            const count = supplies[key];
            return (
              <button
                key={key}
                onClick={() => setSupplies(s => ({ ...s, [key]: s[key] + 1 }))}
                className={`relative flex flex-col items-center justify-center gap-1 h-14 rounded-xl transition-all active:scale-95
                  ${count > 0 ? 'bg-blue-600 ring-2 ring-blue-400 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                <span className="text-lg leading-none">{icon}</span>
                <span className="text-xs font-semibold leading-none">{label}</span>
                {count > 0 && <span className="absolute top-1 right-1.5 text-xs font-black">{count}x</span>}
              </button>
            );
          })}
        </div>
        {Object.values(supplies).some(v => v > 0) && (
          <button onClick={() => setSupplies(emptySupplies(materials))} className="mt-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors">
            Reset materiaal
          </button>
        )}
      </div>

      {/* Notes */}
      <div className="px-4 pt-3">
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Extra notities (optioneel)…"
          className="w-full bg-slate-700 border border-slate-600 rounded-xl text-white text-sm px-3 py-2 focus:outline-none focus:border-blue-500 resize-none placeholder-slate-500"
        />
      </div>

      {/* Close + reject buttons */}
      <div className="px-4 py-3 flex flex-col gap-2">
        <button
          onClick={handleClose}
          disabled={closing}
          className="w-full py-3 rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-bold text-sm transition-colors"
        >
          {closing ? 'Afmelden…' : '✓ Melding afmelden'}
        </button>

        {!showReject ? (
          <button
            onClick={() => setShowReject(true)}
            className="w-full py-2 rounded-xl bg-slate-700 hover:bg-orange-800 text-slate-400 hover:text-white text-sm font-semibold transition-colors"
          >
            Afwijzen
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={2}
              placeholder="Reden (bijv. al onderweg naar andere melding)…"
              className="w-full bg-slate-700 border border-orange-600 rounded-xl text-white text-sm px-3 py-2 focus:outline-none resize-none placeholder-slate-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                disabled={rejecting}
                className="flex-1 py-2.5 rounded-xl bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm transition-colors"
              >
                {rejecting ? 'Afwijzen…' : 'Bevestig afwijzing'}
              </button>
              <button
                onClick={() => { setShowReject(false); setRejectReason(''); }}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
              >
                Annuleer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New incident form ────────────────────────────────────────────────────────

const EVENT_CENTER = [51.5771791, 4.7351289];

function NewIncidentForm({ myTeamLabel, activeEvent, materials, onCreated, onCancel }) {
  const [priority, setPriority]   = useState('medium');
  const [complaint, setComplaint] = useState('');
  const [supplies, setSupplies]   = useState(() => emptySupplies(materials));
  const [gpsState, setGpsState]   = useState('idle');
  const [coords, setCoords]       = useState(null);
  const [showMap, setShowMap]     = useState(false);
  const [sending, setSending]     = useState(false);

  const fetchGPS = () => {
    if (!navigator.geolocation) { setGpsState('error'); setShowMap(true); return; }
    setGpsState('fetching');
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords([pos.coords.latitude, pos.coords.longitude]); setGpsState('ok'); setShowMap(false); },
      ()  => { setGpsState('error'); setShowMap(true); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const submit = async () => {
    setSending(true);
    const supplyText = suppliesToText(supplies, materials);
    const fullComplaint = [supplyText, complaint.trim()].filter(Boolean).join('\n');
    const payload = {
      reporter:      myTeamLabel || 'Team',
      priority,
      complaint:     fullComplaint || null,
      lat:           coords?.[0] ?? null,
      lng:           coords?.[1] ?? null,
      assigned_team: myTeamLabel || undefined,
      event_id:      activeEvent?.id   ?? null,
      event_name:    activeEvent?.name ?? null,
    };
    try {
      const res = await fetch('/api/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      onCreated();
    } catch {
      enqueue(payload);
      onCreated();
    }
    setSending(false);
  };

  return (
    <div className="w-full max-w-lg bg-slate-800 rounded-2xl p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold text-base">Nieuwe melding</h2>
        <button onClick={onCancel} className="text-slate-500 hover:text-white text-lg">✕</button>
      </div>

      {/* Priority */}
      <div>
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Prioriteit</p>
        <div className="grid grid-cols-3 gap-2">
          {PRIORITIES.map(({ value, label, color }) => (
            <button
              key={value}
              onClick={() => setPriority(value)}
              className="py-2.5 rounded-xl font-bold text-sm border-2 transition-all"
              style={{
                borderColor: priority === value ? color : 'transparent',
                background:  priority === value ? color + '22' : '#334155',
                color:       priority === value ? color : '#64748b',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Materials */}
      <div>
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Gebruikt materiaal</p>
        <div className="grid grid-cols-3 gap-2">
          {materials.map(({ key, label, icon }) => {
            const count = supplies[key];
            return (
              <button
                key={key}
                onClick={() => setSupplies(s => ({ ...s, [key]: s[key] + 1 }))}
                className={`relative flex flex-col items-center justify-center gap-1 h-14 rounded-xl transition-all active:scale-95
                  ${count > 0 ? 'bg-blue-600 ring-2 ring-blue-400 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                <span className="text-lg leading-none">{icon}</span>
                <span className="text-xs font-semibold leading-none">{label}</span>
                {count > 0 && <span className="absolute top-1 right-1.5 text-xs font-black">{count}x</span>}
              </button>
            );
          })}
        </div>
        {Object.values(supplies).some(v => v > 0) && (
          <button onClick={() => setSupplies(emptySupplies(materials))} className="mt-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors">
            Reset materiaal
          </button>
        )}
      </div>

      {/* Complaint — optional */}
      <div>
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
          Beschrijving <span className="normal-case font-normal text-slate-600">(optioneel)</span>
        </p>
        <textarea
          value={complaint}
          onChange={e => setComplaint(e.target.value)}
          rows={2}
          placeholder="Extra toelichting…"
          className="w-full bg-slate-700 border border-slate-600 rounded-xl text-white text-sm px-3 py-2 focus:outline-none focus:border-blue-500 resize-none placeholder-slate-500"
        />
      </div>

      {/* GPS */}
      <div>
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Locatie</p>
        <div className="flex gap-2">
          <button
            onClick={fetchGPS}
            disabled={gpsState === 'fetching'}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors
              ${gpsState === 'ok'      ? 'bg-green-600 text-white' :
                gpsState === 'error'   ? 'bg-orange-600 text-white' :
                gpsState === 'fetching'? 'bg-slate-600 text-slate-400 cursor-wait' :
                                         'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
          >
            {gpsState === 'ok' ? '📍 GPS OK' : gpsState === 'fetching' ? 'Localiseren…' : gpsState === 'error' ? '⚠ Opnieuw' : '📍 GPS ophalen'}
          </button>
          <button
            onClick={() => setShowMap(v => !v)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${showMap ? 'bg-blue-700 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
          >
            Kaart
          </button>
        </div>
        {showMap && (
          <div className="mt-2 rounded-xl overflow-hidden border border-slate-600" style={{ height: 200 }}>
            <MapContainer center={coords ?? EVENT_CENTER} zoom={15} style={{ width: '100%', height: '100%' }} zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
              <MapPicker position={coords} onChange={setCoords} />
            </MapContainer>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={sending}
        className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold text-sm transition-colors"
      >
        {sending ? 'Verzenden…' : 'Melding aanmaken'}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportView() {
  const [role, setRole]               = useState('');
  const [myTeamLabel, setMyTeamLabel] = useState('');
  const [materials, setMaterials]     = useState(FALLBACK_MATERIALS);
  const [activeEvent, setActiveEvent] = useState(null);
  const [incidents, setIncidents]     = useState([]); // assigned to this team
  const [alertIncident, setAlertIncident] = useState(null); // incoming assignment overlay
  const [alertRejectReason, setAlertRejectReason] = useState('');
  const [alertShowReject, setAlertShowReject]     = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [queueCount, setQueueCount]   = useState(0);
  const soundUrlRef = useRef(null);

  // ── Role init ──
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    if (urlRole) { localStorage.setItem('smet_role', urlRole); setRole(urlRole); }
    else { setRole(localStorage.getItem('smet_role') || ''); }
    setQueueCount(getQueue().length);
  }, []);

  useEffect(() => {
    if (role) document.title = `SMET – ${formatRole(role)}`;
  }, [role]);

  // ── Load settings ──
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        if (s.materials?.length) setMaterials(s.materials);
        if (s.active_event) setActiveEvent(s.active_event);
        if (s.sound?.type === 'custom') soundUrlRef.current = `/api/settings/uploads/${s.sound.filename}`;
        const urlRole = new URLSearchParams(window.location.search).get('role') || localStorage.getItem('smet_role') || '';
        const match   = (s.teams ?? []).find(t => t.role === urlRole);
        if (match) setMyTeamLabel(match.label);
      })
      .catch(() => {});
  }, []);

  // ── Load existing assigned incidents + socket ──
  useEffect(() => {
    if (!myTeamLabel) return;

    fetch('/api/incidents')
      .then(r => r.json())
      .then(all => setIncidents(all.filter(i => i.assigned_team === myTeamLabel && i.status === 'open')))
      .catch(() => {});

    const socket = io({ transports: ['websocket', 'polling'] });

    const handleUpdated = (inc) => {
      if (inc.assigned_team === myTeamLabel && inc.status === 'open') {
        setIncidents(prev => {
          const exists = prev.find(i => i.id === inc.id);
          if (exists) return prev.map(i => i.id === inc.id ? inc : i);
          // Newly assigned — skip alert if we reported it ourselves
          if (inc.reporter === myTeamLabel) return [inc, ...prev];
          playAlert(soundUrlRef.current);
          setAlertIncident(inc);
          return prev;
        });
      } else {
        setIncidents(prev => prev.filter(i => i.id !== inc.id));
      }
    };

    const handleNew = (inc) => {
      if (inc.assigned_team === myTeamLabel && inc.status === 'open') {
        if (inc.reporter === myTeamLabel) {
          // Self-created — add directly without alert
          setIncidents(prev => [inc, ...prev]);
        } else {
          playAlert(soundUrlRef.current);
          setAlertIncident(inc);
        }
      }
    };

    socket.on('new_incident',      handleNew);
    socket.on('incident_updated',  handleUpdated);
    socket.on('incident_deleted',  ({ id }) => setIncidents(prev => prev.filter(i => i.id !== id)));
    socket.on('incidents_reset',   () => setIncidents([]));
    socket.on('incidents_bulk_deleted', ({ ids }) => setIncidents(prev => prev.filter(i => !ids.includes(i.id))));
    socket.on('settings_updated',  ({ key, value }) => {
      if (key === 'active_event') setActiveEvent(value);
      if (key === 'materials' && value?.length) setMaterials(value);
    });

    window.addEventListener('online', drainQueue);
    drainQueue();

    return () => { socket.disconnect(); window.removeEventListener('online', drainQueue); };
  }, [myTeamLabel]);

  const handleClosed   = useCallback((id) => setIncidents(prev => prev.filter(i => i.id !== id)), []);
  const handleRejected = useCallback((id) => setIncidents(prev => prev.filter(i => i.id !== id)), []);

  return (
    <div className="page-enter min-h-screen bg-slate-900 flex flex-col items-center px-4 py-6 gap-4">

      {/* ── Incoming assignment alert ── */}
      {alertIncident && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-6 px-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl page-enter"
            style={{ borderTop: `4px solid ${PRIORITY_COLOR[alertIncident.priority]}` }}>
            <div className="bg-slate-900 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-bold text-base">🚨 Nieuwe inzet</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: PRIORITY_COLOR[alertIncident.priority] + '33', color: PRIORITY_COLOR[alertIncident.priority] }}>
                  {PRIORITY_LABEL[alertIncident.priority]}
                </span>
              </div>
              <p className="text-slate-300 text-sm font-semibold">{alertIncident.reporter}</p>
              {alertIncident.event_name && (
                <p className="text-slate-500 text-xs mt-0.5">📅 {alertIncident.event_name}</p>
              )}
              {alertIncident.complaint && (
                <p className="text-slate-400 text-sm mt-2">{alertIncident.complaint}</p>
              )}
              {alertIncident.lat && alertIncident.lng ? (
                <a href={`https://maps.google.com/?q=${alertIncident.lat},${alertIncident.lng}`}
                  target="_blank" rel="noreferrer"
                  className="inline-block mt-2 text-blue-400 text-sm underline">
                  📍 Open locatie in Maps
                </a>
              ) : (
                <p className="text-slate-600 text-xs mt-2 italic">Geen GPS locatie</p>
              )}
              <button
                onClick={() => {
                  setIncidents(prev => [alertIncident, ...prev]);
                  setAlertIncident(null);
                  setAlertShowReject(false);
                  setAlertRejectReason('');
                }}
                className="mt-4 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors"
              >
                Begrepen — melding oppakken
              </button>

              {!alertShowReject ? (
                <button
                  onClick={() => setAlertShowReject(true)}
                  className="mt-1 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-orange-900 text-slate-400 hover:text-white text-sm font-semibold transition-colors"
                >
                  Afwijzen
                </button>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  <textarea
                    value={alertRejectReason}
                    onChange={e => setAlertRejectReason(e.target.value)}
                    rows={2}
                    placeholder="Reden (bijv. al onderweg naar andere melding)…"
                    className="w-full bg-slate-800 border border-orange-600 rounded-xl text-white text-sm px-3 py-2 focus:outline-none resize-none placeholder-slate-500"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await fetch(`/api/incidents/${alertIncident.id}/reject`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ team: myTeamLabel, reason: alertRejectReason }),
                        });
                        setAlertIncident(null);
                        setAlertShowReject(false);
                        setAlertRejectReason('');
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-orange-700 hover:bg-orange-600 text-white font-bold text-sm transition-colors"
                    >
                      Bevestig afwijzing
                    </button>
                    <button
                      onClick={() => { setAlertShowReject(false); setAlertRejectReason(''); }}
                      className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
                    >
                      Terug
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="w-full max-w-lg">
        <h1 className="text-white text-2xl font-bold tracking-wide">SMET</h1>
        {myTeamLabel ? (
          <p className="text-slate-400 text-sm mt-0.5">
            Ingelogd als <span className="text-white font-semibold">{myTeamLabel}</span>
          </p>
        ) : role ? (
          <p className="text-slate-400 text-sm mt-0.5">
            Ingelogd als <span className="text-white font-semibold">{formatRole(role)}</span>
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-orange-400 text-xs mb-1">Geen rol — voer je teamnaam in:</p>
            <input
              type="text"
              placeholder="bijv. Team 10km"
              onChange={e => setRole(e.target.value)}
              className="w-full rounded-xl bg-slate-800 text-white placeholder-slate-500 border border-orange-500 focus:outline-none px-4 py-2 text-sm"
            />
          </div>
        )}
        {activeEvent ? (
          <p className="text-green-400 text-xs mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            {activeEvent.name}
          </p>
        ) : (
          <p className="text-orange-400 text-xs mt-1">Geen actief evenement</p>
        )}
        {queueCount > 0 && (
          <p className="text-yellow-400 text-xs mt-1">{queueCount} melding(en) in wachtrij (offline)</p>
        )}
      </div>

      {/* Active incidents */}
      {incidents.length === 0 && !showNew && (
        <div className="w-full max-w-lg bg-slate-800 rounded-2xl px-5 py-8 text-center">
          <p className="text-slate-400 text-sm font-semibold">Geen actieve meldingen</p>
          <p className="text-slate-600 text-xs mt-1">Wacht op toewijzing van de coördinator, of maak zelf een melding aan.</p>
        </div>
      )}

      {incidents.map(inc => (
        <IncidentCard
          key={inc.id}
          inc={inc}
          materials={materials}
          onClose={handleClosed}
          onReject={handleRejected}
        />
      ))}

      {/* New incident form */}
      {showNew && (
        <NewIncidentForm
          myTeamLabel={myTeamLabel || formatRole(role)}
          activeEvent={activeEvent}
          materials={materials}
          onCreated={() => setShowNew(false)}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* New incident button */}
      {!showNew && (
        <button
          onClick={() => setShowNew(true)}
          className="w-full max-w-lg py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 font-semibold text-sm transition-all"
        >
          + Zelf een melding aanmaken
        </button>
      )}
    </div>
  );
}
