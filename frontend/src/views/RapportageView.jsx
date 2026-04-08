import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#eab308', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'HOOG',    medium: 'MID',     low: 'LAAG'   };

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ─── Aggregate materials — prefer structured JSONB, fallback to text parsing ───
function aggregateMaterials(incidents, materials) {
  const totals = {};
  if (!materials?.length) return totals;
  for (const inc of incidents) {
    if (inc.status !== 'closed') continue;
    // Use structured materials_used if available
    if (Array.isArray(inc.materials_used) && inc.materials_used.length > 0) {
      for (const { label, count } of inc.materials_used) {
        if (count > 0) totals[label] = (totals[label] || 0) + count;
      }
    } else if (inc.complaint) {
      // Fallback: parse text
      for (const { label } of materials) {
        const re = new RegExp(`(\\d+)x\\s+${label}`, 'g');
        for (const m of inc.complaint.matchAll(re)) {
          totals[label] = (totals[label] || 0) + parseInt(m[1]);
        }
      }
    }
  }
  return totals;
}

export default function RapportageView() {
  const navigate = useNavigate();
  const [incidents, setIncidents]   = useState([]);
  const [settings,  setSettings]    = useState(null);
  const [eventFilter, setEventFilter]   = useState(null);
  const [teamFilter,  setTeamFilter]    = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText,  setSearchText]    = useState('');

  useEffect(() => {
    document.title = 'MET – Rapportage';
    fetch('/api/incidents').then(r => r.json()).then(setIncidents).catch(console.error);
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(console.error);

    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('new_incident',          inc  => setIncidents(p => [inc, ...p]));
    socket.on('incident_updated',      upd  => setIncidents(p => p.map(i => i.id === upd.id ? upd : i)));
    socket.on('incident_deleted',      ({id}) => setIncidents(p => p.filter(i => i.id !== id)));
    socket.on('incidents_bulk_deleted',({ids}) => setIncidents(p => p.filter(i => !ids.includes(i.id))));
    socket.on('incidents_reset',       ()   => setIncidents([]));
    return () => socket.disconnect();
  }, []);

  const events = settings?.events ?? [];
  const teams  = settings?.teams  ?? [];

  // Unique teams that appear in incidents
  const activeTeams = [...new Set(incidents.map(i => i.assigned_team).filter(Boolean))];

  const filtered = incidents.filter(inc => {
    if (eventFilter  != null && inc.event_id      !== eventFilter) return false;
    if (teamFilter   != null && inc.assigned_team !== teamFilter)  return false;
    if (statusFilter === 'open'   && inc.status !== 'open')        return false;
    if (statusFilter === 'closed' && inc.status !== 'closed')      return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      if (!(inc.reporter   || '').toLowerCase().includes(q) &&
          !(inc.complaint  || '').toLowerCase().includes(q) &&
          !(inc.event_name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Summary stats
  const total  = filtered.length;
  const open   = filtered.filter(i => i.status === 'open').length;
  const closed = filtered.filter(i => i.status === 'closed').length;
  const byPriority = {
    high:   filtered.filter(i => i.priority === 'high').length,
    medium: filtered.filter(i => i.priority === 'medium').length,
    low:    filtered.filter(i => i.priority === 'low').length,
  };

  return (
    <div className="rapportage-page page-enter min-h-screen bg-slate-950 flex flex-col">

      {/* Print-only title */}
      <div className="rapportage-print-title hidden">
        MET — Rapportage &nbsp;·&nbsp; {total} meldingen · {open} open · {closed} afgemeld
      </div>

      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-700 px-5 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">Rapportage</h1>
          <p className="text-slate-500 text-xs mt-0.5">{total} meldingen · {open} open · {closed} afgemeld</p>
          <div className="flex gap-2 mt-1.5">
            {byPriority.high   > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">🔴 Hoog: {byPriority.high}</span>}
            {byPriority.medium > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">🟡 Mid: {byPriority.medium}</span>}
            {byPriority.low    > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">🟢 Laag: {byPriority.low}</span>}
          </div>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="print:hidden text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
        >
          ← Dashboard
        </button>
      </div>

      {/* Filters */}
      <div className="print:hidden bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-col gap-2">

        {/* Search */}
        <input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Zoek op naam, melding of evenement…"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />

        {/* Status */}
        <div className="flex gap-2">
          {[['all','Alle'],['open','Open'],['closed','Afgemeld']].map(([val, label]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                ${statusFilter === val ? 'bg-blue-600 border-blue-500 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Event filter */}
        {events.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => { setEventFilter(null); setTeamFilter(null); }}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                ${eventFilter === null ? 'bg-slate-600 border-slate-500 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
              Alle evenementen
            </button>
            {events.map(e => (
              <button key={e.id} onClick={() => { setEventFilter(e.id); setTeamFilter(null); }}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                  ${eventFilter === e.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
                {e.name}
              </button>
            ))}
          </div>
        )}

        {/* Team filter */}
        {activeTeams.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setTeamFilter(null)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                ${!teamFilter ? 'bg-slate-600 border-slate-500 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
              Alle teams
            </button>
            {activeTeams.map(t => (
              <button key={t} onClick={() => setTeamFilter(t)}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
                  ${teamFilter === t ? 'bg-blue-600 border-blue-500 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
                👥 {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Materials summary table */}
      {(() => {
        const allMaterials = settings?.materials ?? [];
        // Build columns: per event (if no eventFilter) or just one column
        const cols = eventFilter
          ? [{ id: eventFilter, name: settings?.events?.find(e => e.id === eventFilter)?.name ?? 'Evenement' }]
          : events.length > 0
            ? events
            : [{ id: null, name: 'Totaal' }];

        // Compute totals per column
        const colTotals = cols.map(col => {
          const colIncidents = filtered.filter(i => col.id === null || i.event_id === col.id);
          return aggregateMaterials(colIncidents, allMaterials);
        });

        // Only show materials that have at least one count across all columns
        const usedMaterials = allMaterials.filter(({ label }) =>
          colTotals.some(t => (t[label] || 0) > 0)
        );

        if (!usedMaterials.length) return null;

        return (
          <div className="bg-slate-900 border-b border-slate-800 px-5 py-4">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-3">
              Gebruikt materiaal
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left text-slate-500 text-xs font-semibold py-2 pr-4 w-40">Materiaal</th>
                    {cols.map(col => (
                      <th key={col.id ?? 'all'} className="text-center text-slate-400 text-xs font-semibold py-2 px-3 whitespace-nowrap">
                        {col.name}
                      </th>
                    ))}
                    {cols.length > 1 && (
                      <th className="text-center text-slate-400 text-xs font-semibold py-2 px-3">Totaal</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {usedMaterials.map(({ label, icon }) => {
                    const rowTotal = colTotals.reduce((sum, t) => sum + (t[label] || 0), 0);
                    return (
                      <tr key={label} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                        <td className="py-2.5 pr-4">
                          <span className="text-slate-300 flex items-center gap-2">
                            {icon && <span>{icon}</span>}
                            {label}
                          </span>
                        </td>
                        {colTotals.map((t, i) => (
                          <td key={i} className="text-center py-2.5 px-3">
                            <span className={`font-bold ${(t[label] || 0) > 0 ? 'text-white' : 'text-slate-700'}`}>
                              {t[label] || '—'}
                            </span>
                          </td>
                        ))}
                        {cols.length > 1 && (
                          <td className="text-center py-2.5 px-3">
                            <span className="font-bold text-blue-400">{rowTotal || '—'}</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {cols.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-slate-600">
                      <td className="py-2.5 pr-4 text-slate-500 text-xs font-semibold">Totaal meldingen</td>
                      {cols.map((col, i) => (
                        <td key={i} className="text-center py-2.5 px-3 text-slate-400 text-xs font-semibold">
                          {filtered.filter(inc => col.id === null || inc.event_id === col.id).length}
                        </td>
                      ))}
                      <td className="text-center py-2.5 px-3 text-blue-400 text-xs font-semibold">{filtered.length}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        );
      })()}

      {/* Beheer */}
      <div className="print:hidden bg-slate-900 border-b border-slate-800 px-4 py-3">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-2">Beheer</p>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex-1 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 transition-colors"
          >
            PDF exporteren
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
        {filtered.length === 0 && (
          <p className="text-slate-500 text-center mt-16 text-sm">Geen meldingen gevonden.</p>
        )}
        {filtered.map(inc => {
          const color = PRIORITY_COLOR[inc.priority] || '#94a3b8';
          return (
            <div key={inc.id} className="rapportage-incident px-5 py-4" style={{ borderLeft: `3px solid ${inc.status === 'closed' ? '#334155' : color}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Top row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                      style={{ background: color + '22', color: inc.status === 'closed' ? '#64748b' : color }}>
                      {PRIORITY_LABEL[inc.priority]}
                    </span>
                    {inc.source === 'public' && (
                      <span className="text-xs font-semibold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">👥 Omstander</span>
                    )}
                    {inc.status === 'closed' && (
                      <span className="text-xs font-semibold text-green-600 bg-green-900/30 px-1.5 py-0.5 rounded">✓ Afgemeld</span>
                    )}
                    {inc.assigned_team && (
                      <span className="text-xs font-semibold text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                        👥 {inc.assigned_team}
                      </span>
                    )}
                    {!inc.assigned_team && (
                      <span className="text-xs text-slate-600 italic">Geen team</span>
                    )}
                  </div>

                  {/* Reporter + time */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-white text-sm font-semibold">{inc.reporter}</span>
                    <span className="text-slate-600 text-xs">{fmtDate(inc.created_at)} · {fmtTime(inc.created_at)}</span>
                  </div>

                  {/* Response times */}
                  {(inc.accepted_at || inc.closed_at) && (
                    <div className="flex gap-3 mt-0.5">
                      {inc.accepted_at && (
                        <span className="text-xs text-green-600">
                          Aangenomen {fmtTime(inc.accepted_at)}
                          {' '}({Math.round((new Date(inc.accepted_at) - new Date(inc.created_at)) / 60000)} min)
                        </span>
                      )}
                      {inc.closed_at && (
                        <span className="text-xs text-slate-500">
                          Afgesloten {fmtTime(inc.closed_at)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Event */}
                  {inc.event_name && (
                    <p className="text-slate-500 text-xs mt-0.5">📅 {inc.event_name}</p>
                  )}

                  {/* Complaint + materials */}
                  {inc.complaint && (
                    <div className="mt-2 bg-slate-800 rounded-xl px-3 py-2">
                      {inc.complaint.split('\n\n').map((part, i) => (
                        <p key={i} className={`text-xs ${i === 0 && inc.complaint.includes('x ') ? 'text-blue-300 font-semibold' : 'text-slate-400'} ${i > 0 ? 'mt-1 pt-1 border-t border-slate-700' : ''}`}>
                          {i === 0 && inc.complaint.match(/^\d+x /) ? '🧰 ' : ''}{part}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Location */}
                  {inc.lat && inc.lng && (
                    <a href={`https://maps.google.com/?q=${inc.lat},${inc.lng}`}
                      target="_blank" rel="noreferrer"
                      className="inline-block mt-1.5 text-blue-500 text-xs underline">
                      📍 Locatie bekijken
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
