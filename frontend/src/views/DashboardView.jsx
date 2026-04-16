import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import { playAlert, playAlertSoft } from '../lib/alert';

// ─── Leaflet marker fix ──────────────────────────────────────────────────────
// Vite doesn't bundle Leaflet's default PNGs; we use custom divIcons instead.

const PRIORITY_COLOR = {
  high:   '#ef4444',
  medium: '#eab308',
  low:    '#22c55e',
};

const PRIORITY_LABEL = {
  high:   'HOOG',
  medium: 'MID',
  low:    'LAAG',
};

function makeRouteEndIcon(type) {
  const isStart  = type === 'start';
  const bg       = isStart ? '#22c55e' : '#ef4444';
  const label    = isStart ? 'S' : 'F';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:18px;height:18px;
      border-radius:50%;
      background:${bg};
      border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,.5);
      display:flex;align-items:center;justify-content:center;
      font-size:9px;font-weight:900;color:white;font-family:sans-serif;
      line-height:1;
    ">${label}</div>`,
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
    popupAnchor:[0, -12],
  });
}

const START_ICON  = makeRouteEndIcon('start');
const FINISH_ICON = makeRouteEndIcon('finish');

function makeWaypointIcon(name) {
  const letter = name ? name.charAt(0).toUpperCase() : '★';
  return L.divIcon({
    className: '',
    html: `<div style="
      position:relative;
      width:22px;height:22px;
    ">
      <div style="
        position:absolute;inset:0;
        background:#f59e0b;
        border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,.55);
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
      "></div>
      <span style="
        position:absolute;inset:0;
        display:flex;align-items:center;justify-content:center;
        font-size:9px;font-weight:900;color:white;font-family:sans-serif;
        padding-bottom:2px;
      ">${letter}</span>
    </div>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 22],
    popupAnchor:[0, -24],
  });
}

function makeIcon(priority, selected) {
  const color = PRIORITY_COLOR[priority] || '#94a3b8';
  const size  = selected ? 22 : 16;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,.6);
    "></div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor:[0, -(size / 2 + 4)],
  });
}


// ─── MapController — flies to selected incident ──────────────────────────────

function MapController({ selectedId, incidents }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const inc = incidents.find((i) => i.id === selectedId);
    if (inc?.lat && inc?.lng) {
      map.flyTo([inc.lat, inc.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ─── Map location picker (for coordinator pin correction) ─────────────────────

const EDIT_PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f59e0b;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
  iconSize: [28, 28], iconAnchor: [14, 28],
});

function MapLocationPicker({ position, onChange }) {
  useMapEvents({ click: e => onChange([e.latlng.lat, e.latlng.lng]) });
  return position
    ? <Marker position={position} icon={EDIT_PIN_ICON} draggable
        eventHandlers={{ dragend: e => onChange([e.target.getLatLng().lat, e.target.getLatLng().lng]) }} />
    : null;
}

// ─── Audit log type labels ────────────────────────────────────────────────────

const AUDIT_LABEL = {
  assigned:         (e) => `Toegewezen aan ${e.team}`,
  unassigned:       ()  => 'Toewijzing verwijderd',
  accepted:         (e) => `Aangenomen door ${e.team}${e.eta ? ` · ETA ${e.eta}` : ''}`,
  rejected:         (e) => `Afgewezen door ${e.team}${e.reason ? `: ${e.reason}` : ''}`,
  closed:           ()  => 'Melding afgesloten',
  location_updated: ()  => 'Locatie gecorrigeerd',
  note:             (e) => `📝 ${e.note}`,
};

function fmtAuditTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Timestamp formatters ─────────────────────────────────────────────────────

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function fmtRelative(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return 'zojuist';
  if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
  return fmtTime(iso);
}

const STATUS_COLOR = { beschikbaar: '#22c55e', onderweg: '#eab308', bezet: '#ef4444' };

// ─── Main component ──────────────────────────────────────────────────────────

// ─── Fallback teams (used before settings load) ───────────────────────────────
const FALLBACK_TEAMS = [{ role: 'coordinator', label: 'Coordinator' }];

// Default centre — set to your event location.
const MAP_CENTER = [51.5771791, 4.7351289]; // Ambachtenlaan 1, Breda
const MAP_ZOOM   = 13;

export default function DashboardView() {
  const navigate = useNavigate();
  const [incidents, setIncidents]   = useState([]);
  const [settings,  setSettings]    = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showLinks, setShowLinks]   = useState(false);
  const [showBeheer, setShowBeheer] = useState(false);
  const [confirm, setConfirm]       = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [flash, setFlash]                 = useState(null);
  const [activeEventId, setActiveEventId] = useState(null); // null = alle evenementen
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [assigningId, setAssigningId]         = useState(null);
  const [connected, setConnected]             = useState(true);
  const [filterPriority, setFilterPriority]   = useState(null);
  const [filterTeam, setFilterTeam]           = useState(null);
  const [showFilter, setShowFilter]           = useState(false);
  const [qrUrls, setQrUrls]                   = useState({});
  const [qrModal, setQrModal]                 = useState(null); // { label, key }
  const [detailInc, setDetailInc]             = useState(null);
  const [searchText, setSearchText]           = useState('');
  const [hideClosed, setHideClosed]           = useState(false);
  const [teamStatuses, setTeamStatuses]       = useState({});
  const [tick, setTick]                       = useState(0);
  const [editLocationId, setEditLocationId]   = useState(null); // incId being pin-moved
  const [editLocationPos, setEditLocationPos] = useState(null); // [lat, lng]
  const [noteText, setNoteText]               = useState('');
  const [noteSaving, setNoteSaving]           = useState(false);
  const feedRef                               = useRef(null);
  const listRefs = useRef({});

  const teams  = settings?.teams ?? FALLBACK_TEAMS;
  const events = (settings?.events ?? []).slice().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // Routes filtered by active event (null = all, 'none' = geen, id = specific)
  const routes = activeEventId === 'none' ? [] : events
    .filter(e => activeEventId === null || e.id === activeEventId)
    .flatMap(e => (e.routes ?? []).map(r => ({ ...r, eventName: e.name, eventDate: e.date })));

  // Waypoints filtered by active event
  const waypoints = activeEventId === 'none' ? [] : events
    .filter(e => activeEventId === null || e.id === activeEventId)
    .flatMap(e => (e.waypoints ?? []).map(w => ({ ...w, eventName: e.name })));

  const soundUrl = settings?.sound?.type === 'custom'
    ? `/api/settings/uploads/${settings.sound.filename}`
    : null;

  // ── Page title ──
  useEffect(() => { document.title = 'MET – Dashboard'; }, []);

  // ── Relative-time ticker ──
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Auto-select the active event on load, otherwise no event ──
  useEffect(() => {
    if (settings === null) return;
    const ae = settings.active_event;
    setActiveEventId(ae ? ae.id : 'none');
  }, [settings?.active_event]);

  // ── Fetch all & open socket ──
  useEffect(() => {
    fetch('/api/incidents').then(r => r.json()).then(setIncidents).catch(console.error);
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(console.error);

    const socket = io({ transports: ['websocket', 'polling'] });

    socket.on('new_incident', (inc) => {
      setIncidents((prev) => [inc, ...prev]);
      if (inc.priority === 'high') {
        playAlert(soundUrl);
        setFlash(inc.id);
        setTimeout(() => setFlash(null), 3000);
      } else if (inc.priority === 'medium') {
        playAlertSoft();
      }
      // Auto-scroll feed to top
      setTimeout(() => feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    });

    socket.on('team_statuses',        (statuses) => setTeamStatuses(statuses));
    socket.on('team_status_updated',  ({ label, status }) =>
      setTeamStatuses(prev => ({ ...prev, [label]: status }))
    );

    socket.on('incident_updated', (updated) => {
      setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    });

    socket.on('incident_deleted', ({ id }) => {
      setIncidents((prev) => prev.filter((i) => i.id !== id));
    });

    socket.on('incidents_bulk_deleted', ({ ids }) => {
      setIncidents((prev) => prev.filter((i) => !ids.includes(i.id)));
    });

    socket.on('incidents_reset', () => setIncidents([]));

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect',    () => setConnected(true));

    socket.on('settings_updated', ({ key, value }) => {
      setSettings(s => s ? { ...s, [key]: value } : s);
      if (key === 'active_event') {
        setActiveEventId(value ? value.id : 'none');
      }
    });

    return () => socket.disconnect();
  }, []);

  const selectIncident = useCallback((id) => {
    setSelectedId(id);
    // Scroll list item into view
    setTimeout(() => {
      listRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  const closeIncident = useCallback(async (id, e) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/incidents/${id}/close`, { method: 'PATCH' });
      if (res.ok) {
        const updated = await res.json();
        setIncidents((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const deleteIncident = useCallback(async (id, e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
      setIncidents((prev) => prev.filter((i) => i.id !== id));
      setSelectedId((sel) => sel === id ? null : sel);
      setConfirmDelete(null);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const deleteClosed = useCallback(async () => {
    try {
      await fetch('/api/incidents', { method: 'DELETE' });
      setConfirm(null);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const resetAll = useCallback(async () => {
    try {
      await fetch('/api/incidents/reset/all', { method: 'DELETE' });
      setSelectedId(null);
      setConfirm(null);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const assignTeam = useCallback(async (incId, teamLabel) => {
    try {
      const res = await fetch(`/api/incidents/${incId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: teamLabel }),
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents(prev => prev.map(i => i.id === updated.id ? updated : i));
      }
    } catch (err) { console.error(err); }
    setAssigningId(null);
  }, []);

  const saveLocation = useCallback(async (incId, lat, lng) => {
    try {
      const res = await fetch(`/api/incidents/${incId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents(prev => prev.map(i => i.id === updated.id ? updated : i));
        setDetailInc(updated);
      }
    } catch (err) { console.error(err); }
    setEditLocationId(null);
    setEditLocationPos(null);
  }, []);

  const saveNote = useCallback(async (incId, note) => {
    if (!note.trim()) return;
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/incidents/${incId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      if (res.ok) {
        const updated = await res.json();
        setIncidents(prev => prev.map(i => i.id === updated.id ? updated : i));
        setDetailInc(updated);
        setNoteText('');
      }
    } catch (err) { console.error(err); }
    setNoteSaving(false);
  }, []);

  // Generate QR codes when links panel opens
  useEffect(() => {
    if (!showLinks) return;
    const allLinks = [
      ...teams.map(({ role }) => ({ key: role, url: `${window.location.origin}/report?role=${role}` })),
      { key: '__meld', url: `${window.location.origin}/meld` },
    ];
    Promise.all(
      allLinks.map(({ key, url }) =>
        QRCode.toDataURL(url, { margin: 1, width: 140, color: { dark: '#ffffff', light: '#1e293b' } })
          .then(dataUrl => [key, dataUrl])
      )
    ).then(entries => setQrUrls(Object.fromEntries(entries)));
  }, [showLinks, teams]);

  const activeEvent = settings?.active_event ?? null;

  const setActiveEvent = useCallback(async (event) => {
    // event = { id, name } | null
    setActiveEventId(event ? event.id : 'none'); // sync routes immediately
    await fetch('/api/settings/active_event', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: event }),
    });
  }, []);

  // Filter incidents by active event filter (reuses activeEventId from route bar)
  const eventFiltered = incidents.filter(inc => {
    if (activeEventId === 'none') return true;
    if (activeEventId === null)   return true;
    return inc.event_id === activeEventId;
  });

  const visibleIncidents = eventFiltered
    .filter(inc => !filterPriority || inc.priority === filterPriority)
    .filter(inc => !filterTeam    || inc.assigned_team === filterTeam)
    .filter(inc => !hideClosed    || inc.status !== 'closed')
    .filter(inc => {
      if (!searchText.trim()) return true;
      const q = searchText.toLowerCase();
      return (inc.reporter   || '').toLowerCase().includes(q)
          || (inc.complaint  || '').toLowerCase().includes(q)
          || (inc.event_name || '').toLowerCase().includes(q);
    });

  const openCount   = visibleIncidents.filter((i) => i.status === 'open').length;
  const closedCount = incidents.filter((i) => i.status === 'closed').length;

  const priorityCounts = {
    high:   eventFiltered.filter(i => i.status === 'open' && i.priority === 'high').length,
    medium: eventFiltered.filter(i => i.status === 'open' && i.priority === 'medium').length,
    low:    eventFiltered.filter(i => i.status === 'open' && i.priority === 'low').length,
  };

  // Team open-incident counts (based on event filter, ignoring priority/team filter)
  const teamCounts = teams.reduce((acc, t) => {
    acc[t.label] = eventFiltered.filter(i => i.status === 'open' && i.assigned_team === t.label).length;
    return acc;
  }, {});
  const unassignedOpenCount = eventFiltered.filter(i => i.status === 'open' && !i.assigned_team).length;

  const exportXLSX = useCallback(() => {
    const rows = incidents.map(i => ({
      Tijd:           new Date(i.created_at).toLocaleString('nl-NL'),
      Melder:         i.reporter,
      Bron:           i.source === 'public' ? 'Omstander' : 'Team',
      Prioriteit:     i.priority,
      Status:         i.status,
      Team:           i.assigned_team || '',
      Aangenomen_om:  i.accepted_at ? new Date(i.accepted_at).toLocaleString('nl-NL') : '',
      Afgesloten_om:  i.closed_at   ? new Date(i.closed_at).toLocaleString('nl-NL')   : '',
      Melding:        i.complaint    || '',
      Evenement:      i.event_name   || '',
      Lat:            i.lat ?? '',
      Lng:            i.lng ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Incidenten');
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `met-incidenten-${date}.xlsx`);
  }, [incidents]);

  return (
    <div className="page-enter flex h-screen bg-slate-950 overflow-hidden">

      {/* ── Offline banner ── */}
      {!connected && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-700 text-white text-xs font-bold text-center py-2 tracking-wide">
          Verbinding verbroken — live updates liggen stil. Herverbinden…
        </div>
      )}

      {/* ── Right: Incident Feed (40%) ── */}
      <div className="w-1/2 lg:w-2/5 flex flex-col border-l border-slate-700 overflow-hidden order-last">

        {/* Header */}
        <div className="bg-slate-900 border-b border-slate-700 shrink-0">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-white font-bold text-lg tracking-wide leading-none">MET</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <p className="text-slate-400 text-xs">
                  {openCount} open &bull; {visibleIncidents.length} zichtbaar
                  {unassignedOpenCount > 0 && (
                    <span className="ml-2 text-amber-400 font-semibold">{unassignedOpenCount} ontoeg.</span>
                  )}
                </p>
                {/* Priority counts */}
                {priorityCounts.high   > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">🔴 {priorityCounts.high}</span>}
                {priorityCounts.medium > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">🟡 {priorityCounts.medium}</span>}
                {priorityCounts.low    > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">🟢 {priorityCounts.low}</span>}
              </div>
              {/* Team counts with status dots */}
              {teams.some(t => teamCounts[t.label] > 0 || teamStatuses[t.label]) && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {teams.filter(t => teamCounts[t.label] > 0 || teamStatuses[t.label]).map(t => {
                    const st = teamStatuses[t.label];
                    return (
                      <span key={t.role} className="flex items-center gap-1 text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
                        {st && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[st] ?? '#94a3b8' }} />}
                        {t.label}{teamCounts[t.label] > 0 ? ` ${teamCounts[t.label]}` : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0 items-center">
              <button
                onClick={() => { setShowLinks(v => !v); setShowBeheer(false); setConfirm(null); }}
                className={`text-xs font-semibold px-3 py-2 rounded-lg transition-colors
                  ${showLinks ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
              >
                Links
              </button>
              <button
                onClick={() => { setShowBeheer(v => !v); setShowLinks(false); setConfirm(null); }}
                className={`text-xs font-semibold px-3 py-2 rounded-lg transition-colors
                  ${showBeheer ? 'bg-red-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
              >
                Beheer
              </button>
              <button
                onClick={() => setShowFilter(v => !v)}
                className={`text-xs font-semibold px-3 py-2 rounded-lg transition-colors
                  ${(filterPriority || filterTeam) ? 'bg-amber-600 text-white' : showFilter ? 'bg-slate-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                title="Filter meldingen"
              >
                {(filterPriority || filterTeam) ? 'Filter ●' : 'Filter'}
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                title="Instellingen"
              >
                ⚙
              </button>
            </div>
          </div>

          {/* Active event bar */}
          <div
            className="px-4 py-3 border-t border-slate-800 flex items-center gap-2 cursor-pointer select-none"
            onClick={() => { setShowEventPicker(v => !v); setShowLinks(false); setShowBeheer(false); }}
          >
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-widest shrink-0">Actief evenement</span>
            <span className={`flex-1 text-xs font-bold truncate ${activeEvent ? 'text-green-400' : 'text-slate-600 italic'}`}>
              {activeEvent ? activeEvent.name : 'Geen — klik om in te stellen'}
            </span>
            {activeEvent && (
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0 animate-pulse" />
            )}
            <span className="text-slate-600 text-xs">{showEventPicker ? '▲' : '▼'}</span>
          </div>

          {/* Event picker panel */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: showEventPicker ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.25s ease',
            }}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-3 pt-1 flex flex-col gap-1.5">
                <button
                  onClick={() => { setActiveEvent(null); setShowEventPicker(false); }}
                  className={`w-full text-left text-xs px-3 py-2 rounded-xl transition-colors font-semibold
                    ${!activeEvent ? 'bg-slate-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
                >
                  Geen actief evenement
                </button>
                {events.length === 0 && (
                  <p className="text-slate-600 text-xs italic px-1">Nog geen evenementen — maak ze aan via Instellingen.</p>
                )}
                {events.map(e => (
                  <button
                    key={e.id}
                    onClick={() => { setActiveEvent({ id: e.id, name: e.name }); setShowEventPicker(false); }}
                    className={`w-full text-left text-xs px-3 py-2 rounded-xl transition-colors
                      ${activeEvent?.id === e.id ? 'bg-green-700 text-white font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                  >
                    <span className="font-semibold">{e.name}</span>
                    {e.date && (
                      <span className="ml-2 opacity-60">
                        {new Date(e.date + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick links panel — always rendered, height animated */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: showLinks ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.3s ease',
            }}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-3 pt-1 flex flex-col gap-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">
                  Rapportagelinks
                </p>

                {/* 2-column team grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  {teams.map(({ role, label }) => {
                    const url = `${window.location.origin}/report?role=${role}`;
                    return (
                      <div key={role} className="flex items-center gap-1 bg-slate-800 rounded-xl px-2.5 py-2 min-w-0">
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-white text-sm font-semibold hover:text-blue-400 transition-colors truncate"
                        >
                          {label}
                        </a>
                        <button
                          onClick={() => setQrModal({ label, key: role })}
                          className="text-slate-500 hover:text-white text-sm shrink-0 transition-colors leading-none"
                          title="QR-code tonen"
                        >
                          ▣
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Omstander — full width */}
                <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-3 py-2">
                  <a
                    href={`${window.location.origin}/meld`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-white text-sm font-medium hover:text-blue-400 transition-colors"
                  >
                    👥 Omstander melding
                  </a>
                  <button
                    onClick={() => setQrModal({ label: 'Omstander melding', key: '__meld' })}
                    className="text-slate-500 hover:text-white text-sm shrink-0 transition-colors leading-none"
                    title="QR-code tonen"
                  >
                    ▣
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* Beheer panel */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: showBeheer ? '1fr' : '0fr',
              transition: 'grid-template-rows 0.3s ease',
            }}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-3 pt-1 flex flex-col gap-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1">
                  Beheer
                </p>

                {/* Navigate + export row */}
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate('/rapportage')}
                    className="flex-1 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 transition-colors"
                  >
                    📋 Rapportage
                  </button>
                  <button
                    onClick={exportXLSX}
                    title={incidents.length === 0 ? 'Geen meldingen om te exporteren' : `${incidents.length} melding(en) exporteren als Excel`}
                    className="flex-1 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 transition-colors"
                  >
                    ↓ Excel exporteren
                  </button>
                </div>

                <div className="w-full h-px bg-slate-700/60" />

                {/* Delete closed */}
                <div className="flex gap-2">
                  {confirm === 'closed' ? (
                    <>
                      <button
                        onClick={deleteClosed}
                        className="flex-1 text-xs font-bold bg-orange-600 hover:bg-orange-500 text-white rounded-xl py-2 transition-colors"
                      >
                        Ja, verwijder {closedCount} gesloten
                      </button>
                      <button
                        onClick={() => setConfirm(null)}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl px-3 py-2 transition-colors"
                      >
                        Annuleer
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirm('closed')}
                      disabled={closedCount === 0}
                      className="flex-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-xl py-2 transition-colors"
                    >
                      Verwijder gesloten ({closedCount})
                    </button>
                  )}
                </div>

                {/* Reset all */}
                <div className="flex gap-2">
                  {confirm === 'all' ? (
                    <>
                      <button
                        onClick={resetAll}
                        className="flex-1 text-xs font-bold bg-red-700 hover:bg-red-600 text-white rounded-xl py-2 transition-colors"
                      >
                        Ja, alles verwijderen ({incidents.length})
                      </button>
                      <button
                        onClick={() => setConfirm(null)}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl px-3 py-2 transition-colors"
                      >
                        Annuleer
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirm('all')}
                      disabled={incidents.length === 0}
                      className="flex-1 text-xs font-semibold bg-red-900/40 hover:bg-red-900 disabled:opacity-30 disabled:cursor-not-allowed text-red-400 rounded-xl py-2 transition-colors"
                    >
                      Alles resetten &amp; verwijderen
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Event filter bar */}
        {events.length > 0 && (
          <div className="relative shrink-0 border-b border-slate-800 bg-slate-950">
            {/* Fade edges */}
            <div className="pointer-events-none absolute left-0 top-0 h-full w-6 z-10"
              style={{ background: 'linear-gradient(to right, #020617, transparent)' }} />
            <div className="pointer-events-none absolute right-0 top-0 h-full w-6 z-10"
              style={{ background: 'linear-gradient(to left, #020617, transparent)' }} />

            {/* Scrollable row */}
            <div className="flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-none"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

              {/* Geen */}
              <button
                onClick={() => setActiveEventId('none')}
                className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-full border transition-all
                  ${activeEventId === 'none'
                    ? 'bg-slate-600 border-slate-500 text-white shadow'
                    : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}
              >
                Geen
              </button>

              {/* Alle */}
              <button
                onClick={() => setActiveEventId(null)}
                className={`shrink-0 text-xs font-semibold px-3 py-2 rounded-full border transition-all
                  ${activeEventId === null
                    ? 'bg-blue-600 border-blue-500 text-white shadow'
                    : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}
              >
                Alle
              </button>

              {/* Divider */}
              <div className="w-px bg-slate-700 my-1 shrink-0" />

              {/* Per event */}
              {events.map(e => {
                const isToday  = e.date === new Date().toLocaleDateString('en-CA');
                const isActive = activeEventId === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setActiveEventId(e.id)}
                    className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border transition-all
                      ${isActive
                        ? 'bg-blue-600 border-blue-500 text-white shadow'
                        : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}
                  >
                    {isToday && (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-green-300' : 'bg-green-500'}`} />
                    )}
                    <span>{e.name}</span>
                    {e.date && (
                      <span className={isActive ? 'text-blue-200' : 'text-slate-600'}>
                        {new Date(e.date + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search + hide-closed bar */}
        <div className="shrink-0 border-b border-slate-800 px-3 py-2 flex gap-2 items-center bg-slate-950">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Zoek op naam, melding…"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setHideClosed(v => !v)}
            className={`shrink-0 text-sm font-semibold px-3 py-2.5 rounded-lg transition-colors
              ${hideClosed ? 'bg-slate-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
            title="Gesloten meldingen verbergen"
          >
            {hideClosed ? 'Toon gesloten' : 'Verberg gesloten'}
          </button>
        </div>

        {/* Filter bar */}
        {showFilter && (
          <div className="shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2.5 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider shrink-0">Prioriteit</span>
              {[null, 'high', 'medium', 'low'].map(p => (
                <button
                  key={p ?? 'all'}
                  onClick={() => setFilterPriority(p)}
                  className={`text-sm font-bold px-3 py-2 rounded-lg transition-colors
                    ${filterPriority === p
                      ? p === 'high' ? 'bg-red-600 text-white' : p === 'medium' ? 'bg-yellow-600 text-white' : p === 'low' ? 'bg-green-700 text-white' : 'bg-slate-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
                >
                  {p === null ? 'Alle' : p === 'high' ? 'Hoog' : p === 'medium' ? 'Mid' : 'Laag'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider shrink-0">Team</span>
              <button
                onClick={() => setFilterTeam(null)}
                className={`text-sm font-bold px-3 py-2 rounded-lg transition-colors ${!filterTeam ? 'bg-slate-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
              >
                Alle
              </button>
              {teams.map(t => (
                <button
                  key={t.role}
                  onClick={() => setFilterTeam(filterTeam === t.label ? null : t.label)}
                  className={`text-sm font-bold px-3 py-2 rounded-lg transition-colors ${filterTeam === t.label ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feed list */}
        <div ref={feedRef} className="flex-1 overflow-y-auto scroll-touch">
          {visibleIncidents.length === 0 && (
            <p className="text-slate-500 text-center mt-16 text-sm">Nog geen incidenten.</p>
          )}
          {visibleIncidents.map((inc) => {
            const isSelected = selectedId === inc.id;
            const isFlash    = flash === inc.id;
            const color      = PRIORITY_COLOR[inc.priority] || '#94a3b8';

            return (
              <div
                key={inc.id}
                ref={(el) => { listRefs.current[inc.id] = el; }}
                onClick={() => selectIncident(inc.id)}
                style={{ borderLeft: `4px solid ${inc.status === 'closed' ? '#334155' : inc.source === 'public' ? '#f59e0b' : color}` }}
                className={`
                  cursor-pointer pl-3 pr-4 py-4 border-b border-slate-800 transition-colors
                  ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-800'}
                  ${isFlash    ? 'animate-pulse bg-red-900/40' : ''}
                  ${inc.status === 'closed' ? 'opacity-40' : ''}
                `}
              >
                <div className="flex-1 min-w-0">
                  {/* Top row: reporter + priority label + time + info */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white text-base font-semibold truncate">
                        {inc.reporter}
                      </span>
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: color + '33', color }}
                      >
                        {PRIORITY_LABEL[inc.priority]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500 text-xs" title={fmtTime(inc.created_at)}>
                        {fmtRelative(inc.created_at)}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setDetailInc(inc); }}
                        className="text-slate-300 hover:text-white bg-slate-600 hover:bg-slate-500 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0"
                        title="Details"
                      >
                        i
                      </button>
                    </div>
                  </div>
                  {/* Badges row */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {inc.source === 'public' && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400" title="Melding van omstander — verifieer vóór inzet">
                          👥 Omstander
                        </span>
                      )}
                      {inc.assigned_team && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          👥 {inc.assigned_team}
                        </span>
                      )}
                      {inc.accepted_at && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                          ✓ Aangenomen
                        </span>
                      )}
                      {inc.rejected_by && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400" title={inc.rejection_reason || ''}>
                          ✗ Afgew. door {inc.rejected_by}
                        </span>
                      )}
                      {inc.status === 'closed' && (
                        <span className="text-xs text-slate-500 font-semibold">✓ Gesloten</span>
                      )}
                    </div>
                    {inc.complaint && (
                      <p className="text-slate-300 text-xs mt-1 line-clamp-2">{inc.complaint}</p>
                    )}
                    {inc.rejected_by && inc.rejection_reason && (
                      <p className="text-orange-400/80 text-xs mt-0.5 italic">"{inc.rejection_reason}"</p>
                    )}
                    {inc.eta_text && (
                      <span className="inline-block text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 mt-0.5">
                        ⏱ ETA {inc.eta_text}
                      </span>
                    )}
                    {inc.event_name && (
                      <p className="text-slate-500 text-xs mt-0.5">📅 {inc.event_name}</p>
                    )}
                    {!inc.lat && (
                      <p className="text-slate-600 text-xs mt-0.5 italic">Geen GPS</p>
                    )}
                  </div>
                {/* Action buttons */}
                <div className="mt-2 flex gap-2">
                  {inc.status === 'open' && (
                    <button
                      onClick={(e) => closeIncident(inc.id, e)}
                      className="flex-1 text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-600 rounded-lg py-2.5 transition-colors"
                    >
                      Markeer als gesloten
                    </button>
                  )}
                  {inc.status === 'open' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAssigningId(assigningId === inc.id ? null : inc.id); setConfirmDelete(null); }}
                      className={`text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors
                        ${inc.assigned_team ? 'bg-blue-700/50 hover:bg-blue-700 text-blue-300' : 'bg-slate-800 hover:bg-slate-600 text-slate-400 hover:text-white'}`}
                    >
                      👥
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(inc.id); setAssigningId(null); }}
                    className="text-sm text-red-500 hover:text-white bg-slate-800 hover:bg-red-700 rounded-lg px-4 py-2.5 transition-colors"
                    title="Verwijder melding"
                  >
                    ✕
                  </button>
                </div>

                {/* Team picker — smooth slide */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: assigningId === inc.id ? '1fr' : '0fr',
                    transition: 'grid-template-rows 0.25s ease',
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {inc.assigned_team && (
                        <button
                          onClick={() => assignTeam(inc.id, null)}
                          className="text-sm px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors"
                        >
                          Geen
                        </button>
                      )}
                      {teams.map(t => {
                        const count = teamCounts[t.label] || 0;
                        const st    = teamStatuses[t.label];
                        return (
                          <button
                            key={t.role}
                            onClick={() => assignTeam(inc.id, t.label)}
                            className={`text-sm font-semibold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5
                              ${inc.assigned_team === t.label
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 hover:bg-blue-700 text-slate-300 hover:text-white'}`}
                          >
                            {st && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[st] ?? '#94a3b8' }} />}
                            {t.label}
                            {count > 0 && <span className="text-xs opacity-70">({count})</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Inline delete confirmation — smooth slide */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateRows: confirmDelete === inc.id ? '1fr' : '0fr',
                    transition: 'grid-template-rows 0.25s ease',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="overflow-hidden">
                    <div className="flex gap-2 pt-1.5">
                      <button
                        onClick={(e) => deleteIncident(inc.id, e)}
                        className="flex-1 text-xs font-bold bg-red-700 hover:bg-red-600 text-white rounded-lg py-1.5 transition-colors"
                      >
                        Ja, verwijder
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                        className="flex-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg py-1.5 transition-colors"
                      >
                        Annuleer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Left: Map (60%) ── */}
      <div className="w-1/2 lg:w-3/5 relative">
        <MapContainer
          center={MAP_CENTER}
          zoom={MAP_ZOOM}
          style={{ width: '100%', height: '100%' }}
          zoomControl
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
            maxZoom={19}
          />
          <MapController selectedId={selectedId} incidents={incidents} />
          {editLocationId && (
            <MapLocationPicker position={editLocationPos} onChange={setEditLocationPos} />
          )}

          {/* Walking routes from settings */}
          {routes.map((route) => {
            const start  = route.coords?.[0];
            const finish = route.coords?.[route.coords.length - 1];
            const dateLabel = route.eventDate
              ? new Date(route.eventDate + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
              : null;
            return (
              <span key={route.id}>
                <Polyline
                  positions={route.coords}
                  pathOptions={{ color: route.color, weight: route.width, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }}
                >
                  <Popup>
                    <strong>{route.eventName}</strong>
                    {dateLabel && <><br />{dateLabel}</>}
                  </Popup>
                </Polyline>
                {start && (
                  <Marker position={start} icon={START_ICON}>
                    <Popup><strong>Start</strong><br />{route.eventName}{dateLabel && <><br />{dateLabel}</>}</Popup>
                  </Marker>
                )}
                {finish && (
                  <Marker position={finish} icon={FINISH_ICON}>
                    <Popup><strong>Finish</strong><br />{route.eventName}{dateLabel && <><br />{dateLabel}</>}</Popup>
                  </Marker>
                )}
              </span>
            );
          })}

          {waypoints.map(wp => (
            <Marker key={wp.id} position={[wp.lat, wp.lng]} icon={makeWaypointIcon(wp.name)}>
              <Popup>
                <div style={{ minWidth: 140 }}>
                  <p style={{ fontWeight: 'bold', marginBottom: 4 }}>{wp.name || '(naamloos)'}</p>
                  {wp.sym && <p style={{ fontSize: 11, color: '#888' }}>{wp.sym}</p>}
                  {wp.eventName && <p style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{wp.eventName}</p>}
                </div>
              </Popup>
            </Marker>
          ))}

          <MarkerClusterGroup chunkedLoading>
            {visibleIncidents.map((inc) =>
              inc.lat && inc.lng ? (
                <Marker
                  key={`${inc.id}-${selectedId === inc.id}`}
                  position={[inc.lat, inc.lng]}
                  icon={makeIcon(inc.priority, selectedId === inc.id)}
                  eventHandlers={{ click: () => selectIncident(inc.id) }}
                >
                  <Popup>
                    <div style={{ minWidth: 160 }}>
                      <p style={{ fontWeight: 'bold', marginBottom: 4 }}>{inc.reporter}</p>
                      <p style={{ color: PRIORITY_COLOR[inc.priority], fontWeight: 'bold', fontSize: 12 }}>
                        {PRIORITY_LABEL[inc.priority]}
                      </p>
                      {inc.complaint && <p style={{ marginTop: 4, fontSize: 12 }}>{inc.complaint}</p>}
                      <p style={{ marginTop: 4, fontSize: 11, color: '#666' }}>{fmtTime(inc.created_at)}</p>
                    </div>
                  </Popup>
                </Marker>
              ) : null
            )}
          </MarkerClusterGroup>
        </MapContainer>

        {/* Live badge */}
        <div className="absolute top-3 right-3 z-[1000] bg-slate-900/90 backdrop-blur text-white text-xs px-3 py-1.5 rounded-full border border-slate-700 flex items-center gap-2">
          <span className="relative flex items-center justify-center w-3 h-3">
            {/* Ping rings */}
            <span className="live-ping absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60" />
            <span className="live-ping-delay absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60" />
            {/* Core dot */}
            <span className="relative w-2 h-2 rounded-full bg-green-400" />
          </span>
          LIVE
        </div>
      </div>

      {/* Incident detail modal */}
      {detailInc && (() => {
        const inc = incidents.find(i => i.id === detailInc.id) ?? detailInc;
        const color = PRIORITY_COLOR[inc.priority] || '#94a3b8';
        const isEditingLoc = editLocationId === inc.id;
        const history = Array.isArray(inc.assignment_history) ? inc.assignment_history : [];
        return (
          <div className="fixed inset-0 z-[9997] bg-black/75 flex items-center justify-center p-4" onClick={() => { setDetailInc(null); setEditLocationId(null); setEditLocationPos(null); }}>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Color bar */}
              <div style={{ height: 4, background: inc.source === 'public' ? '#f59e0b' : color }} />
              <div className="p-5 flex flex-col gap-3 overflow-y-auto">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-bold text-base">{inc.reporter}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {new Date(inc.created_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                    {inc.accepted_at && (
                      <p className="text-green-400 text-xs mt-0.5">
                        ✓ Aangenomen {new Date(inc.accepted_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    {inc.closed_at && (
                      <p className="text-slate-400 text-xs mt-0.5">
                        Afgesloten {new Date(inc.closed_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: color + '33', color }}>
                      {PRIORITY_LABEL[inc.priority]}
                    </span>
                    {inc.status === 'closed' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-green-900/40 text-green-400">✓ Gesloten</span>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  {inc.source === 'public' && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">👥 Omstander</span>
                  )}
                  {inc.assigned_team && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">👥 {inc.assigned_team}</span>
                  )}
                  {inc.event_name && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-700 text-slate-300">📅 {inc.event_name}</span>
                  )}
                  {inc.eta_text && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">⏱ ETA {inc.eta_text}</span>
                  )}
                  {inc.rejected_by && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">✗ Afgew. {inc.rejected_by}</span>
                  )}
                </div>

                {/* Complaint */}
                {inc.complaint && (
                  <div className="bg-slate-700/50 rounded-xl px-3 py-2.5">
                    <p className="text-slate-300 text-sm whitespace-pre-wrap">{inc.complaint}</p>
                  </div>
                )}
                {inc.rejected_by && inc.rejection_reason && (
                  <p className="text-orange-400/80 text-sm italic">Reden afwijzing: "{inc.rejection_reason}"</p>
                )}

                {/* Coordinator note (only on open incidents) */}
                {inc.status === 'open' && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Notitie toevoegen</p>
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="Voeg een notitie toe aan deze melding…"
                      rows={2}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                    />
                    <button
                      onClick={() => saveNote(inc.id, noteText)}
                      disabled={!noteText.trim() || noteSaving}
                      className="self-end text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {noteSaving ? 'Opslaan…' : 'Opslaan'}
                    </button>
                  </div>
                )}

                {/* GPS + location edit */}
                <div className="flex flex-col gap-2">
                  {inc.lat && inc.lng ? (
                    <a
                      href={`https://maps.google.com/?q=${inc.lat},${inc.lng}`}
                      target="_blank" rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm underline"
                    >
                      📍 Open locatie in Maps
                    </a>
                  ) : (
                    <p className="text-slate-600 text-sm italic">Geen GPS-locatie</p>
                  )}
                  {!isEditingLoc ? (
                    <button
                      onClick={() => {
                        setEditLocationId(inc.id);
                        setEditLocationPos(inc.lat && inc.lng ? [inc.lat, inc.lng] : null);
                      }}
                      className="text-xs text-slate-400 hover:text-amber-400 transition-colors self-start"
                    >
                      ✎ Locatie verplaatsen
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-amber-400 text-xs font-semibold">Klik op de kaart om de locatie te verplaatsen</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (editLocationPos) saveLocation(inc.id, editLocationPos[0], editLocationPos[1]);
                          }}
                          disabled={!editLocationPos}
                          className="flex-1 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition-colors"
                        >
                          Locatie opslaan
                        </button>
                        <button
                          onClick={() => { setEditLocationId(null); setEditLocationPos(null); }}
                          className="px-3 py-2 rounded-xl text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                        >
                          Annuleer
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Audit log / assignment history */}
                {history.length > 0 && (
                  <div>
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Activiteitenlog</p>
                    <div className="flex flex-col gap-1">
                      {history.map((entry, i) => {
                        const labelFn = AUDIT_LABEL[entry.type];
                        const label = labelFn ? labelFn(entry) : entry.type;
                        return (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="text-slate-600 shrink-0 font-mono">{fmtAuditTime(entry.timestamp)}</span>
                            <span className="text-slate-300">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button onClick={() => { setDetailInc(null); setEditLocationId(null); setEditLocationPos(null); }} className="mt-1 w-full py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors">
                  Sluiten
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* QR-code modal */}
      {qrModal && (
        <div
          className="fixed inset-0 z-[9998] bg-black/75 flex items-center justify-center"
          onClick={() => setQrModal(null)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl p-6 flex flex-col items-center gap-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-white font-bold text-base">{qrModal.label}</p>
            {qrUrls[qrModal.key]
              ? <img src={qrUrls[qrModal.key]} alt={qrModal.label} className="rounded-xl" style={{ width: 220, height: 220 }} />
              : <div className="w-[220px] h-[220px] bg-slate-700 rounded-xl flex items-center justify-center text-slate-500 text-sm">Laden…</div>
            }
            <p className="text-slate-400 text-xs text-center break-all max-w-[260px]">
              {qrModal.key === '__meld'
                ? `${window.location.origin}/meld`
                : `${window.location.origin}/report?role=${qrModal.key}`}
            </p>
            <button
              onClick={() => setQrModal(null)}
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Sluiten
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
