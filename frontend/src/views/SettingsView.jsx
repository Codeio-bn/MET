import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { playAlert } from '../lib/alert';

// ─── Reusable small components ───────────────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function SaveButton({ onClick, saving, saved }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`mt-3 w-full py-2.5 rounded-xl text-sm font-bold transition-colors
        ${saved   ? 'bg-green-600 text-white' :
          saving  ? 'bg-slate-700 text-slate-400 cursor-wait' :
                    'bg-blue-600 hover:bg-blue-500 text-white'}`}
    >
      {saved ? 'Opgeslagen ✓' : saving ? 'Opslaan…' : 'Opslaan'}
    </button>
  );
}

const TABS = [
  { id: 'events',    label: 'Evenementen' },
  { id: 'teams',     label: 'Teams'       },
  { id: 'materials', label: 'Materialen'  },
  { id: 'sound',     label: 'Geluid'      },
  { id: 'backup',    label: 'Backup'      },
];

const ROUTE_COLORS = ['#3b82f6','#22c55e','#ef4444','#eab308','#a855f7','#f97316','#06b6d4','#ec4899'];

// ─── Main component ──────────────────────────────────────────────────────────

export default function SettingsView() {
  const navigate = useNavigate();
  const [tab, setTab]           = useState('events');
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    document.title = 'SMET – Instellingen';
    fetch('/api/settings').then(r => r.json()).then(setSettings);
  }, []);

  if (!settings) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Laden…</p>
      </div>
    );
  }

  return (
    <div className="page-enter min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-slate-400 hover:text-white text-sm transition-colors"
        >
          ← Dashboard
        </button>
        <h1 className="text-white font-bold text-lg">SMET – Instellingen</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 bg-slate-900 sticky top-0 z-10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2
              ${tab === t.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div key={tab} className="tab-enter">
          {tab === 'events'    && <EventsTab    settings={settings} setSettings={setSettings} />}
          {tab === 'teams'     && <TeamsTab     settings={settings} setSettings={setSettings} />}
          {tab === 'materials' && <MaterialsTab settings={settings} setSettings={setSettings} />}
          {tab === 'sound'     && <SoundTab     settings={settings} setSettings={setSettings} />}
          {tab === 'backup'    && <BackupTab    settings={settings} setSettings={setSettings} />}
        </div>
      </div>
    </div>
  );
}

// ─── Evenementen tab ─────────────────────────────────────────────────────────

function EventsTab({ settings, setSettings }) {
  const [newName, setNewName]   = useState('');
  const [newDate, setNewDate]   = useState('');
  const [uploading, setUploading]   = useState(null); // eventId being uploaded to
  const [routeForm, setRouteForm]   = useState({}); // per-eventId form state
  const [waypointFile, setWaypointFile] = useState({}); // per-eventId file
  const [uploadingWp, setUploadingWp]   = useState(null);
  const [editingId, setEditingId]         = useState(null);
  const [editFields, setEditFields]       = useState({});
  const [wpOpen, setWpOpen]               = useState(new Set());
  const [routesOpen, setRoutesOpen]       = useState(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const saveEvents = useCallback(async (events) => {
    await fetch('/api/settings/events', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: events }),
    });
    setSettings(s => ({ ...s, events }));
  }, [setSettings]);

  const addEvent = useCallback(async () => {
    if (!newName.trim()) return;
    const events = [...settings.events, {
      id:     crypto.randomUUID(),
      name:   newName.trim(),
      date:   newDate,
      routes: [],
    }];
    await saveEvents(events);
    setNewName('');
    setNewDate('');
  }, [newName, newDate, settings.events, saveEvents]);

  const deleteEvent = useCallback(async (id) => {
    await saveEvents(settings.events.filter(e => e.id !== id));
    setConfirmDeleteId(null);
  }, [settings.events, saveEvents]);

  const duplicateEvent = useCallback(async (event) => {
    const copy = { ...event, id: crypto.randomUUID(), name: `${event.name} (kopie)` };
    await saveEvents([...settings.events, copy]);
  }, [settings.events, saveEvents]);

  const startEdit = useCallback((event) => {
    setEditingId(event.id);
    setEditFields({ name: event.name, date: event.date || '' });
  }, []);

  const saveEdit = useCallback(async (id) => {
    if (!editFields.name?.trim()) return;
    const events = settings.events.map(e =>
      e.id === id ? { ...e, name: editFields.name.trim(), date: editFields.date } : e
    );
    await saveEvents(events);
    setEditingId(null);
  }, [editFields, settings.events, saveEvents]);

  const deleteWaypoint = useCallback(async (eventId, waypointId) => {
    await fetch(`/api/settings/events/${eventId}/waypoints/${waypointId}`, { method: 'DELETE' });
    setSettings(s => ({
      ...s,
      events: s.events.map(e =>
        e.id === eventId ? { ...e, waypoints: (e.waypoints ?? []).filter(w => w.id !== waypointId) } : e
      ),
    }));
  }, [setSettings]);

  const uploadWaypoints = useCallback(async (eventId) => {
    const file = waypointFile[eventId];
    if (!file) return;
    setUploadingWp(eventId);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch(`/api/settings/events/${eventId}/waypoints`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      const fresh = await fetch('/api/settings').then(r => r.json());
      setSettings(fresh);
      setWaypointFile(f => ({ ...f, [eventId]: null }));
    } finally {
      setUploadingWp(null);
    }
  }, [waypointFile, setSettings]);

  const deleteRoute = useCallback(async (eventId, routeId) => {
    await fetch(`/api/settings/events/${eventId}/routes/${routeId}`, { method: 'DELETE' });
    setSettings(s => ({
      ...s,
      events: s.events.map(e =>
        e.id === eventId ? { ...e, routes: e.routes.filter(r => r.id !== routeId) } : e
      ),
    }));
  }, [setSettings]);

  const uploadRoute = useCallback(async (eventId) => {
    const form = routeForm[eventId] || {};
    if (!form.file) return;
    setUploading(eventId);
    const fd = new FormData();
    fd.append('file',  form.file);
    fd.append('name',  form.name  || form.file.name);
    fd.append('color', form.color || '#3b82f6');
    fd.append('width', '4');
    try {
      const res  = await fetch(`/api/settings/events/${eventId}/routes`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      // Refresh settings
      const fresh = await fetch('/api/settings').then(r => r.json());
      setSettings(fresh);
      setRouteForm(f => ({ ...f, [eventId]: {} }));
    } finally {
      setUploading(null);
    }
  }, [routeForm, setSettings]);

  return (
    <div className="flex flex-col gap-6">
      {/* Add event */}
      <div>
        <SectionHeader>Nieuw evenement</SectionHeader>
        <div className="flex flex-col gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Naam (bijv. Dag 1)"
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={addEvent}
            disabled={!newName.trim()}
            className="w-full py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Evenement toevoegen
          </button>
        </div>
      </div>

      {/* Event list */}
      {settings.events.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-6">Nog geen evenementen aangemaakt.</p>
      )}

      {settings.events.map(event => (
        <div key={event.id} className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          {/* Event header */}
          {editingId === event.id ? (
            <div className="flex flex-col gap-2">
              <input
                value={editFields.name}
                onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
                placeholder="Naam"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={editFields.date}
                onChange={e => setEditFields(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(event.id)}
                  disabled={!editFields.name?.trim()}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
                >
                  Opslaan
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 py-1.5 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-semibold">{event.name}</p>
                {event.date && <p className="text-slate-400 text-xs">{new Date(event.date).toLocaleDateString('nl-NL', { dateStyle: 'long' })}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(event)}
                  className="text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  Bewerk
                </button>
                <button
                  onClick={() => duplicateEvent(event)}
                  className="text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
                  title="Dupliceer evenement"
                >
                  Kopieer
                </button>
                {confirmDeleteId === event.id ? (
                  <>
                    <button
                      onClick={() => deleteEvent(event.id)}
                      className="text-xs font-bold text-white bg-red-700 hover:bg-red-600 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Zeker?
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-slate-400 bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Nee
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(event.id)}
                    className="text-xs text-red-400 hover:text-white bg-slate-700 hover:bg-red-700 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    Verwijder
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Routes */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setRoutesOpen(s => {
                const next = new Set(s);
                next.has(event.id) ? next.delete(event.id) : next.add(event.id);
                return next;
              })}
              className="flex items-center justify-between w-full text-left"
            >
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                Routes ({(event.routes ?? []).length})
              </p>
              <span className="text-slate-500 text-xs">{routesOpen.has(event.id) ? '▲' : '▼'}</span>
            </button>
            {routesOpen.has(event.id) && (
              <>
                {(event.routes ?? []).length === 0 && (
                  <p className="text-slate-600 text-xs italic">Geen routes</p>
                )}
                {(event.routes ?? []).map(route => (
                  <div key={route.id} className="flex items-center gap-2 bg-slate-700 rounded-xl px-3 py-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: route.color }} />
                    <span className="text-white text-sm flex-1 truncate">{route.name}</span>
                    <span className="text-slate-500 text-xs shrink-0">{(route.coords?.length ?? 0)} punten</span>
                    <button
                      onClick={() => deleteRoute(event.id, route.id)}
                      className="text-red-400 hover:text-white text-xs shrink-0 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Waypoints */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setWpOpen(s => {
                const next = new Set(s);
                next.has(event.id) ? next.delete(event.id) : next.add(event.id);
                return next;
              })}
              className="flex items-center justify-between w-full text-left"
            >
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                Bezienswaardigheden ({(event.waypoints ?? []).length})
              </p>
              <span className="text-slate-500 text-xs">{wpOpen.has(event.id) ? '▲' : '▼'}</span>
            </button>
            {wpOpen.has(event.id) && (
              <>
                {(event.waypoints ?? []).length === 0 && (
                  <p className="text-slate-600 text-xs italic">Geen bezienswaardigheden</p>
                )}
                {(event.waypoints ?? []).map(wp => (
                  <div key={wp.id} className="flex items-center gap-2 bg-slate-700 rounded-xl px-3 py-2">
                    <span className="w-3 h-3 rounded-sm shrink-0 bg-amber-400" style={{ transform: 'rotate(45deg)' }} />
                    <span className="text-white text-sm flex-1 truncate">{wp.name || '(naamloos)'}</span>
                    {wp.sym && <span className="text-slate-400 text-xs shrink-0 truncate max-w-[40%]">{wp.sym}</span>}
                    <button
                      onClick={() => deleteWaypoint(event.id, wp.id)}
                      className="text-red-400 hover:text-white text-xs shrink-0 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Upload waypoints */}
          <div className="border-t border-slate-700 pt-3 flex flex-col gap-2">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Bezienswaardigheden uploaden (GPX)</p>
            <input
              type="file"
              accept=".gpx"
              onChange={e => setWaypointFile(f => ({ ...f, [event.id]: e.target.files[0] }))}
              className="text-xs text-slate-400 file:mr-2 file:text-xs file:bg-slate-700 file:text-white file:border-0 file:rounded-lg file:px-2 file:py-1"
            />
            <button
              onClick={() => uploadWaypoints(event.id)}
              disabled={!waypointFile[event.id] || uploadingWp === event.id}
              className="w-full py-2 rounded-xl text-xs font-bold bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {uploadingWp === event.id ? 'Verwerken…' : 'Bezienswaardigheden uploaden'}
            </button>
          </div>

          {/* Upload route */}
          <div className="border-t border-slate-700 pt-3 flex flex-col gap-2">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Route uploaden (GPX / GeoJSON)</p>
            <input
              type="file"
              accept=".gpx,.geojson,.json"
              onChange={e => setRouteForm(f => ({ ...f, [event.id]: { ...f[event.id], file: e.target.files[0] } }))}
              className="text-xs text-slate-400 file:mr-2 file:text-xs file:bg-slate-700 file:text-white file:border-0 file:rounded-lg file:px-2 file:py-1"
            />
            <div className="flex gap-2">
              <input
                value={routeForm[event.id]?.name || ''}
                onChange={e => setRouteForm(f => ({ ...f, [event.id]: { ...f[event.id], name: e.target.value } }))}
                placeholder="Naam (optioneel)"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-xs">Kleur</span>
                <div className="flex gap-1">
                  {ROUTE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setRouteForm(f => ({ ...f, [event.id]: { ...f[event.id], color: c } }))}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${(routeForm[event.id]?.color || '#3b82f6') === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => uploadRoute(event.id)}
              disabled={!routeForm[event.id]?.file || uploading === event.id}
              className="w-full py-2 rounded-xl text-xs font-bold bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {uploading === event.id ? 'Verwerken…' : 'Route uploaden'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Teams tab ───────────────────────────────────────────────────────────────

function TeamsTab({ settings, setSettings }) {
  const [teams,  setTeams]  = useState(settings.teams);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    await fetch('/api/settings/teams', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: teams }),
    });
    setSettings(s => ({ ...s, teams }));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [teams, setSettings]);

  const update = (i, field, val) =>
    setTeams(t => t.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  const add    = () => setTeams(t => [...t, { role: '', label: '' }]);
  const remove = (i) => setTeams(t => t.filter((_, idx) => idx !== i));
  const moveUp   = (i) => setTeams(t => { const a = [...t]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a; });
  const moveDown = (i) => setTeams(t => { const a = [...t]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a; });

  return (
    <div>
      <SectionHeader>Teams & rapportagelinks</SectionHeader>
      <div className="flex flex-col gap-2 mb-3">
        {teams.map((team, i) => (
          <div key={i} className="flex gap-2 items-center bg-slate-800 rounded-xl px-3 py-2">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(i)}   disabled={i === 0}              className="text-slate-500 hover:text-white disabled:opacity-20 text-xs leading-none transition-colors">▲</button>
              <button onClick={() => moveDown(i)} disabled={i === teams.length-1} className="text-slate-500 hover:text-white disabled:opacity-20 text-xs leading-none transition-colors">▼</button>
            </div>
            <input
              value={team.role}
              onChange={e => update(i, 'role', e.target.value)}
              placeholder="role (bijv. team10km)"
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
            />
            <input
              value={team.label}
              onChange={e => update(i, 'label', e.target.value)}
              placeholder="Naam"
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button onClick={() => remove(i)} className="text-red-400 hover:text-white text-xs transition-colors px-1">✕</button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="w-full py-2 rounded-xl text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors mb-1"
      >
        + Team toevoegen
      </button>
      <SaveButton onClick={save} saving={saving} saved={saved} />
      <p className="text-slate-600 text-xs mt-2 text-center">
        Link wordt: /report?role=<span className="font-mono">{'{role}'}</span>
      </p>
    </div>
  );
}

// ─── Materialen tab ──────────────────────────────────────────────────────────

function MaterialsTab({ settings, setSettings }) {
  const [materials, setMaterials] = useState(settings.materials);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    await fetch('/api/settings/materials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: materials }),
    });
    setSettings(s => ({ ...s, materials }));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [materials, setSettings]);

  const update = (i, field, val) =>
    setMaterials(m => m.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  const add    = () => setMaterials(m => [...m, { key: `item${Date.now()}`, label: '', icon: '🩺' }]);
  const remove = (i) => setMaterials(m => m.filter((_, idx) => idx !== i));

  return (
    <div>
      <SectionHeader>EHBO materiaalknopjes op het rapportageformulier</SectionHeader>
      <div className="flex flex-col gap-2 mb-3">
        {materials.map((mat, i) => (
          <div key={i} className="flex gap-2 items-center bg-slate-800 rounded-xl px-3 py-2">
            <input
              value={mat.icon}
              onChange={e => update(i, 'icon', e.target.value)}
              maxLength={4}
              className="w-10 bg-slate-700 border border-slate-600 rounded-lg px-1 py-1.5 text-center text-base focus:outline-none focus:border-blue-500"
            />
            <input
              value={mat.label}
              onChange={e => update(i, 'label', e.target.value)}
              placeholder="Label"
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button onClick={() => remove(i)} className="text-red-400 hover:text-white text-xs transition-colors px-1">✕</button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="w-full py-2 rounded-xl text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors mb-1"
      >
        + Materiaal toevoegen
      </button>
      <SaveButton onClick={save} saving={saving} saved={saved} />
    </div>
  );
}

// ─── Backup tab ──────────────────────────────────────────────────────────────

function BackupTab({ settings, setSettings }) {
  const [importing, setImporting] = useState(false);
  const [status,    setStatus]    = useState(null); // { ok: bool, msg: string }

  const exportBackup = useCallback(() => {
    const { sound, ...exportable } = settings;
    const blob = new Blob(
      [JSON.stringify({ ...exportable, sound: { type: 'default' } }, null, 2)],
      { type: 'application/json' }
    );
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smet-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [settings]);

  const importBackup = useCallback(async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res  = await fetch('/api/settings/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, msg: result.error || 'Import mislukt' });
        return;
      }
      const fresh = await fetch('/api/settings').then(r => r.json());
      setSettings(fresh);
      setStatus({ ok: true, msg: 'Backup succesvol hersteld.' });
    } catch {
      setStatus({ ok: false, msg: 'Ongeldig bestand of parsefout.' });
    } finally {
      setImporting(false);
    }
  }, [setSettings]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader>Exporteren &amp; importeren</SectionHeader>

      {/* Export */}
      <div className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-white font-semibold text-sm">Backup exporteren</p>
        <p className="text-slate-400 text-xs">
          Slaat alle evenementen (inclusief routes en bezienswaardigheden), teams en materialen op als één JSON-bestand.
          Het notificatiegeluid wordt niet meegenomen.
        </p>
        <button
          onClick={exportBackup}
          className="w-full py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Download backup (.json)
        </button>
      </div>

      {/* Import */}
      <div className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-white font-semibold text-sm">Backup importeren</p>
        <p className="text-slate-400 text-xs">
          Laad een eerder geëxporteerd JSON-bestand. De huidige instellingen worden overschreven.
        </p>
        <label className={`w-full py-2.5 rounded-xl text-sm font-bold text-center cursor-pointer transition-colors
          ${importing ? 'bg-slate-700 text-slate-400 cursor-wait' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}>
          {importing ? 'Verwerken…' : 'Backup importeren (.json)'}
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={importBackup}
            disabled={importing}
          />
        </label>
        {status && (
          <p className={`text-xs text-center font-semibold ${status.ok ? 'text-green-400' : 'text-red-400'}`}>
            {status.msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Geluid tab ──────────────────────────────────────────────────────────────

function SoundTab({ settings, setSettings }) {
  const [uploading, setUploading] = useState(false);
  const isCustom = settings.sound?.type === 'custom';

  const upload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch('/api/settings/upload/sound', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      setSettings(s => ({ ...s, sound: data }));
    } finally {
      setUploading(false);
    }
  }, [setSettings]);

  const reset = useCallback(async () => {
    await fetch('/api/settings/sound', { method: 'DELETE' });
    setSettings(s => ({ ...s, sound: { type: 'default' } }));
  }, [setSettings]);

  const preview = useCallback(() => {
    const url = isCustom ? `/api/settings/uploads/${settings.sound.filename}` : null;
    playAlert(url);
  }, [isCustom, settings.sound]);

  return (
    <div>
      <SectionHeader>Notificatiegeluid bij hoge prioriteit</SectionHeader>

      {/* Current */}
      <div className="bg-slate-800 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-white text-sm font-semibold">
            {isCustom ? settings.sound.originalName : 'Standaard (gesynthetiseerd)'}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {isCustom ? 'Geüpload bestand' : 'Geen bestand nodig — gegenereerd via Web Audio API'}
          </p>
        </div>
        <button
          onClick={preview}
          className="shrink-0 text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          ▶ Test
        </button>
      </div>

      {/* Upload */}
      <div className="flex flex-col gap-3">
        <label className={`w-full py-3 rounded-xl text-sm font-bold text-center cursor-pointer transition-colors
          ${uploading ? 'bg-slate-700 text-slate-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
          {uploading ? 'Uploaden…' : 'MP3 / WAV uploaden'}
          <input type="file" accept=".mp3,.wav,.ogg" className="hidden" onChange={upload} disabled={uploading} />
        </label>

        {isCustom && (
          <button
            onClick={reset}
            className="w-full py-2.5 rounded-xl text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Terug naar standaard geluid
          </button>
        )}
      </div>

      <p className="text-slate-600 text-xs mt-4 text-center">
        Het standaard geluid aanpassen kan ook via <span className="font-mono text-slate-500">frontend/src/lib/alert.js</span>
      </p>
    </div>
  );
}
