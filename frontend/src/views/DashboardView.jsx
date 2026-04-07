import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { playAlert } from '../lib/alert';

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

// ─── Timestamp formatter ─────────────────────────────────────────────────────

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

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
  const listRefs = useRef({});

  const teams  = settings?.teams ?? FALLBACK_TEAMS;
  const events = settings?.events ?? [];

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
  useEffect(() => { document.title = 'SMET – Dashboard'; }, []);

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
      }
    });

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
  const visibleIncidents = incidents.filter(inc => {
    if (activeEventId === 'none') return true; // show all when no route filter
    if (activeEventId === null)   return true; // show all
    return inc.event_id === activeEventId;
  });

  const openCount   = visibleIncidents.filter((i) => i.status === 'open').length;
  const closedCount = incidents.filter((i) => i.status === 'closed').length;

  return (
    <div className="page-enter flex h-screen bg-slate-950 overflow-hidden">

      {/* ── Right: Incident Feed (40%) ── */}
      <div className="w-2/5 flex flex-col border-l border-slate-700 overflow-hidden order-last">

        {/* Header */}
        <div className="bg-slate-900 border-b border-slate-700 shrink-0">
          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-white font-bold text-lg tracking-wide">SMET Dashboard</h1>
              <p className="text-slate-400 text-xs mt-0.5">
                {openCount} open &bull; {visibleIncidents.length} zichtbaar
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => { setShowLinks((v) => !v); setShowBeheer(false); setConfirm(null); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors
                  ${showLinks ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                {showLinks ? 'Verberg' : 'Links'}
              </button>
              <button
                onClick={() => { setShowBeheer((v) => !v); setShowLinks(false); setConfirm(null); }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors
                  ${showBeheer ? 'bg-red-700 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                Beheer
              </button>
              <button
                onClick={() => navigate('/rapportage')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                title="Rapportage"
              >
                📋
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                title="Instellingen"
              >
                ⚙
              </button>
            </div>
          </div>

          {/* Active event bar */}
          <div
            className="px-4 py-2 border-t border-slate-800 flex items-center gap-2 cursor-pointer select-none"
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
              <div className="px-4 pb-3 pt-1 flex flex-col gap-1.5">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1">
                  Rapportagelinks — tik om te openen of te delen
                </p>
                {teams.map(({ role, label }) => {
                  const url = `${window.location.origin}/report?role=${role}`;
                  return (
                    <a
                      key={role}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between bg-slate-800 hover:bg-slate-700 rounded-xl px-3 py-2 transition-colors group"
                    >
                      <span className="text-white text-sm font-medium">{label}</span>
                      <span className="text-slate-500 group-hover:text-slate-300 text-xs truncate max-w-[55%] text-right">
                        /report?role={role}
                      </span>
                    </a>
                  );
                })}
                <div className="w-full h-px bg-slate-700 my-0.5" />
                <a
                  href={`${window.location.origin}/meld`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between bg-slate-800 hover:bg-slate-700 rounded-xl px-3 py-2 transition-colors group"
                >
                  <span className="text-white text-sm font-medium">👥 Omstander melding</span>
                  <span className="text-slate-500 group-hover:text-slate-300 text-xs text-right">/meld</span>
                </a>
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
                  Meldingen beheren
                </p>

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
                      Verwijder gesloten meldingen ({closedCount})
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
                      className="flex-1 text-xs font-semibold bg-red-900/50 hover:bg-red-900 disabled:opacity-30 disabled:cursor-not-allowed text-red-300 rounded-xl py-2 transition-colors"
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
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                  ${activeEventId === 'none'
                    ? 'bg-slate-600 border-slate-500 text-white shadow'
                    : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}
              >
                Geen
              </button>

              {/* Alle */}
              <button
                onClick={() => setActiveEventId(null)}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
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
                    className={`shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
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

        {/* Feed list */}
        <div className="flex-1 overflow-y-auto">
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
                className={`
                  cursor-pointer px-4 py-3 border-b border-slate-800 transition-colors
                  ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-800'}
                  ${isFlash    ? 'animate-pulse bg-red-900/40' : ''}
                  ${inc.status === 'closed' ? 'opacity-40' : ''}
                `}
              >
                <div className="flex items-start gap-3">
                  {/* Priority dot */}
                  <div
                    className="mt-1 shrink-0 w-3 h-3 rounded-full ring-2 ring-white/20"
                    style={{ background: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm font-semibold truncate">
                        {inc.reporter}
                      </span>
                      <span className="text-slate-500 text-xs shrink-0">
                        {fmtTime(inc.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ background: color + '33', color }}
                      >
                        {PRIORITY_LABEL[inc.priority]}
                      </span>
                      {inc.assigned_team && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          👥 {inc.assigned_team}
                        </span>
                      )}
                      {inc.status === 'closed' && (
                        <span className="text-xs text-slate-500">GESLOTEN</span>
                      )}
                    </div>
                    {inc.complaint && (
                      <p className="text-slate-300 text-xs mt-1 line-clamp-2">{inc.complaint}</p>
                    )}
                    {inc.event_name && (
                      <p className="text-slate-500 text-xs mt-0.5">📅 {inc.event_name}</p>
                    )}
                    {!inc.lat && (
                      <p className="text-slate-600 text-xs mt-0.5 italic">Geen GPS</p>
                    )}
                  </div>
                </div>
                {/* Action buttons */}
                <div className="mt-2 flex gap-2">
                  {inc.status === 'open' && (
                    <button
                      onClick={(e) => closeIncident(inc.id, e)}
                      className="flex-1 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-600 rounded-lg py-1.5 transition-colors"
                    >
                      Markeer als gesloten
                    </button>
                  )}
                  {inc.status === 'open' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAssigningId(assigningId === inc.id ? null : inc.id); setConfirmDelete(null); }}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors
                        ${inc.assigned_team ? 'bg-blue-700/50 hover:bg-blue-700 text-blue-300' : 'bg-slate-800 hover:bg-slate-600 text-slate-400 hover:text-white'}`}
                    >
                      👥
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(inc.id); setAssigningId(null); }}
                    className="text-xs text-red-500 hover:text-white bg-slate-800 hover:bg-red-700 rounded-lg px-3 py-1.5 transition-colors"
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
                          className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors"
                        >
                          Geen
                        </button>
                      )}
                      {teams.map(t => (
                        <button
                          key={t.role}
                          onClick={() => assignTeam(inc.id, t.label)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors
                            ${inc.assigned_team === t.label
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800 hover:bg-blue-700 text-slate-300 hover:text-white'}`}
                        >
                          {t.label}
                        </button>
                      ))}
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
      <div className="w-3/5 relative">
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
    </div>
  );
}
