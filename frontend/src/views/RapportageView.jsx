import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#eab308', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'Hoog',    medium: 'Middel',  low: 'Laag'   };
const PRIORITY_BG    = { high: 'bg-red-500/15 text-red-400', medium: 'bg-yellow-500/15 text-yellow-400', low: 'bg-green-500/15 text-green-400' };

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}
function fmtMinutes(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}u ${m % 60}m`;
}

function aggregateMaterials(incidents, materials) {
  const totals = {};
  if (!materials?.length) return totals;
  for (const inc of incidents) {
    if (inc.status !== 'closed') continue;
    if (Array.isArray(inc.materials_used) && inc.materials_used.length > 0) {
      for (const { label, count } of inc.materials_used) {
        if (count > 0) totals[label] = (totals[label] || 0) + count;
      }
    } else if (inc.complaint) {
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

function SectionLabel({ children }) {
  return (
    <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest mb-3">{children}</p>
  );
}

export default function RapportageView() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [settings,  setSettings]  = useState(null);
  const [eventFilter,  setEventFilter]  = useState(null);
  const [teamFilter,   setTeamFilter]   = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText,   setSearchText]   = useState('');

  useEffect(() => {
    document.title = 'MET – Rapportage';
    fetch('/api/incidents').then(r => r.json()).then(setIncidents).catch(console.error);
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(console.error);

    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('new_incident',           inc   => setIncidents(p => [inc, ...p]));
    socket.on('incident_updated',       upd   => setIncidents(p => p.map(i => i.id === upd.id ? upd : i)));
    socket.on('incident_deleted',       ({id}) => setIncidents(p => p.filter(i => i.id !== id)));
    socket.on('incidents_bulk_deleted', ({ids}) => setIncidents(p => p.filter(i => !ids.includes(i.id))));
    socket.on('incidents_reset',        ()    => setIncidents([]));
    return () => socket.disconnect();
  }, []);

  const events      = settings?.events ?? [];
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

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total    = filtered.length;
  const open     = filtered.filter(i => i.status === 'open').length;
  const closed   = filtered.filter(i => i.status === 'closed').length;
  const highPrio = filtered.filter(i => i.priority === 'high').length;
  const byPriority = {
    high:   filtered.filter(i => i.priority === 'high').length,
    medium: filtered.filter(i => i.priority === 'medium').length,
    low:    filtered.filter(i => i.priority === 'low').length,
  };

  // ── Responstijden ──────────────────────────────────────────────────────────
  const withAccept = filtered.filter(i => i.accepted_at);
  const withClose  = filtered.filter(i => i.closed_at);
  const avgAcceptMs = withAccept.length
    ? withAccept.reduce((s, i) => s + (new Date(i.accepted_at) - new Date(i.created_at)), 0) / withAccept.length
    : null;
  const avgCloseMs = withClose.length
    ? withClose.reduce((s, i) => s + (new Date(i.closed_at) - new Date(i.created_at)), 0) / withClose.length
    : null;

  // ── Urendiagram ────────────────────────────────────────────────────────────
  const hourCounts = {};
  for (const inc of filtered) {
    const h = new Date(inc.created_at).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  }
  const hours    = Object.keys(hourCounts).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(...Object.values(hourCounts), 1);

  // ── Materialen ─────────────────────────────────────────────────────────────
  const allMaterials = settings?.materials ?? [];
  const matCols = eventFilter
    ? [{ id: eventFilter, name: settings?.events?.find(e => e.id === eventFilter)?.name ?? 'Evenement' }]
    : events.length > 0 ? events : [{ id: null, name: 'Totaal' }];
  const colTotals = matCols.map(col => {
    const colInc = filtered.filter(i => col.id === null || i.event_id === col.id);
    return aggregateMaterials(colInc, allMaterials);
  });
  const usedMaterials = allMaterials.filter(({ label }) => colTotals.some(t => (t[label] || 0) > 0));

  const filterBtn = (active, onClick, label) => (
    <button onClick={onClick}
      className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all
        ${active ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
      {label}
    </button>
  );

  return (
    <div className="rapportage-page page-enter min-h-screen bg-slate-950 flex flex-col">

      {/* ── Print-only title ─────────────────────────────────────────────── */}
      <div className="rapportage-print-title hidden">
        MET — Rapportage · {total} meldingen · {open} open · {closed} afgemeld
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-b border-slate-700 px-5 pt-4 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white font-bold text-xl tracking-tight">Rapportage</h1>
            {eventFilter && (
              <p className="text-slate-400 text-xs mt-0.5">
                {settings?.events?.find(e => e.id === eventFilter)?.name ?? ''}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="print:hidden text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            ← Dashboard
          </button>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-800 rounded-xl px-3 py-3 text-center">
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-slate-500 text-[11px] mt-0.5">Totaal</p>
          </div>
          <div className="bg-slate-800 rounded-xl px-3 py-3 text-center">
            <p className="text-2xl font-bold text-blue-400">{open}</p>
            <p className="text-slate-500 text-[11px] mt-0.5">Open</p>
          </div>
          <div className="bg-slate-800 rounded-xl px-3 py-3 text-center">
            <p className="text-2xl font-bold text-green-400">{closed}</p>
            <p className="text-slate-500 text-[11px] mt-0.5">Afgemeld</p>
          </div>
          <div className="bg-slate-800 rounded-xl px-3 py-3 text-center">
            <p className={`text-2xl font-bold ${highPrio > 0 ? 'text-red-400' : 'text-slate-600'}`}>{highPrio}</p>
            <p className="text-slate-500 text-[11px] mt-0.5">Hoog prio</p>
          </div>
        </div>

        {/* Priority breakdown bar */}
        {total > 0 && (
          <div className="mt-3 flex gap-1 h-1.5 rounded-full overflow-hidden">
            {byPriority.high   > 0 && <div className="bg-red-500    rounded-full" style={{ flex: byPriority.high }} />}
            {byPriority.medium > 0 && <div className="bg-yellow-400 rounded-full" style={{ flex: byPriority.medium }} />}
            {byPriority.low    > 0 && <div className="bg-green-500  rounded-full" style={{ flex: byPriority.low }} />}
          </div>
        )}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="print:hidden bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-col gap-2.5">
        <input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Zoek op naam, melding of evenement…"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-2 flex-wrap">
          {filterBtn(statusFilter === 'all',    () => setStatusFilter('all'),    'Alle')}
          {filterBtn(statusFilter === 'open',   () => setStatusFilter('open'),   'Open')}
          {filterBtn(statusFilter === 'closed', () => setStatusFilter('closed'), 'Afgemeld')}
        </div>
        {events.length > 0 && (
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {filterBtn(eventFilter === null, () => { setEventFilter(null); setTeamFilter(null); }, 'Alle evenementen')}
            {events.map(e => filterBtn(eventFilter === e.id, () => { setEventFilter(e.id); setTeamFilter(null); }, e.name))}
          </div>
        )}
        {activeTeams.length > 0 && (
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {filterBtn(!teamFilter, () => setTeamFilter(null), 'Alle teams')}
            {activeTeams.map(t => filterBtn(teamFilter === t, () => setTeamFilter(t), t))}
          </div>
        )}
      </div>

      {/* ── Statistieken (responstijden + urendiagram) ────────────────────── */}
      {(avgAcceptMs !== null || avgCloseMs !== null || hours.length > 0) && (
        <div className="bg-slate-900 border-b border-slate-800 px-5 py-4 flex flex-col gap-5">

          {(avgAcceptMs !== null || avgCloseMs !== null) && (
            <div>
              <SectionLabel>Gemiddelde responstijden</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                {avgAcceptMs !== null && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{fmtMinutes(avgAcceptMs)}</p>
                    <p className="text-green-700 text-[11px] mt-1">tot aanname <span className="text-slate-600">({withAccept.length}×)</span></p>
                  </div>
                )}
                {avgCloseMs !== null && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">{fmtMinutes(avgCloseMs)}</p>
                    <p className="text-blue-700 text-[11px] mt-1">tot afsluiting <span className="text-slate-600">({withClose.length}×)</span></p>
                  </div>
                )}
              </div>
            </div>
          )}

          {hours.length > 0 && (
            <div>
              <SectionLabel>Meldingen per uur</SectionLabel>
              <div className="flex items-end gap-1" style={{ height: 72 }}>
                {hours.map(h => {
                  const count = hourCounts[h];
                  const pct   = Math.round((count / maxCount) * 100);
                  return (
                    <div key={h} className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                      <span className="text-slate-400 text-[10px] font-semibold leading-none">{count}</span>
                      <div
                        className="w-full rounded-sm bg-blue-600 hover:bg-blue-500 transition-colors"
                        style={{ height: `${Math.max(pct, 6)}%` }}
                        title={`${h}:00 — ${count} melding(en)`}
                      />
                      <span className="text-slate-600 text-[10px] leading-none">{h}u</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Materiaalverbruik ─────────────────────────────────────────────── */}
      {usedMaterials.length > 0 && (
        <div className="bg-slate-900 border-b border-slate-800 px-5 py-4">
          <SectionLabel>Materiaalverbruik</SectionLabel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-700/60">
                  <th className="text-left text-slate-500 text-xs font-semibold py-2 pr-4 w-40">Materiaal</th>
                  {matCols.map(col => (
                    <th key={col.id ?? 'all'} className="text-center text-slate-400 text-xs font-semibold py-2 px-3 whitespace-nowrap">
                      {col.name}
                    </th>
                  ))}
                  {matCols.length > 1 && (
                    <th className="text-center text-slate-400 text-xs font-semibold py-2 px-3">Totaal</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {usedMaterials.map(({ label, icon }) => {
                  const rowTotal = colTotals.reduce((s, t) => s + (t[label] || 0), 0);
                  return (
                    <tr key={label} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
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
                      {matCols.length > 1 && (
                        <td className="text-center py-2.5 px-3">
                          <span className="font-bold text-blue-400">{rowTotal || '—'}</span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {matCols.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-600">
                    <td className="py-2.5 pr-4 text-slate-500 text-xs font-semibold">Totaal meldingen</td>
                    {matCols.map((col, i) => (
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
      )}

      {/* ── Beheer ───────────────────────────────────────────────────────── */}
      <div className="print:hidden bg-slate-900 border-b border-slate-800 px-4 py-3">
        <SectionLabel>Beheer</SectionLabel>
        <button
          onClick={() => window.print()}
          className="w-full text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 transition-colors"
        >
          PDF exporteren
        </button>
      </div>

      {/* ── Meldingen ────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-slate-800">
        <SectionLabel>Meldingen ({total})</SectionLabel>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-slate-500 text-center mt-16 text-sm">Geen meldingen gevonden.</p>
        )}
        {filtered.map(inc => {
          const color    = PRIORITY_COLOR[inc.priority] || '#94a3b8';
          const isClosed = inc.status === 'closed';
          const acceptMin = inc.accepted_at
            ? Math.round((new Date(inc.accepted_at) - new Date(inc.created_at)) / 60000)
            : null;

          return (
            <div
              key={inc.id}
              className={`rapportage-incident px-4 py-3.5 border-b border-slate-800/70 ${isClosed ? 'opacity-70' : ''}`}
            >
              {/* ── Card top: priority bar + name + time ── */}
              <div className="flex items-start gap-3">
                {/* Priority indicator */}
                <div
                  className="shrink-0 w-1 self-stretch rounded-full mt-0.5"
                  style={{ background: isClosed ? '#334155' : color }}
                />

                <div className="flex-1 min-w-0">
                  {/* Row 1: name + timestamp */}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-white font-semibold text-sm truncate">{inc.reporter}</span>
                    <span className="text-slate-600 text-xs shrink-0">{fmtDate(inc.created_at)} · {fmtTime(inc.created_at)}</span>
                  </div>

                  {/* Row 2: badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_BG[inc.priority]}`}
                    >
                      {PRIORITY_LABEL[inc.priority]}
                    </span>
                    {isClosed && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">
                        ✓ Afgemeld
                      </span>
                    )}
                    {!isClosed && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                        Open
                      </span>
                    )}
                    {inc.source === 'public' && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
                        Omstander
                      </span>
                    )}
                    {inc.assigned_team && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                        {inc.assigned_team}
                      </span>
                    )}
                    {inc.event_name && (
                      <span className="text-[11px] text-slate-600">{inc.event_name}</span>
                    )}
                  </div>

                  {/* Row 3: response times */}
                  {(inc.accepted_at || inc.closed_at) && (
                    <div className="flex gap-3 mt-1.5 text-[11px]">
                      {inc.accepted_at && (
                        <span className="text-green-600">
                          Aangenomen {fmtTime(inc.accepted_at)}
                          {acceptMin !== null && <span className="text-green-800 ml-1">({acceptMin} min)</span>}
                        </span>
                      )}
                      {inc.closed_at && (
                        <span className="text-slate-500">Afgesloten {fmtTime(inc.closed_at)}</span>
                      )}
                    </div>
                  )}

                  {/* Row 4: complaint */}
                  {inc.complaint && (
                    <div className="mt-2 bg-slate-800/60 rounded-lg px-3 py-2 border-l-2 border-slate-700">
                      {inc.complaint.split('\n\n').map((part, i) => (
                        <p key={i} className={`text-xs text-slate-400 ${i > 0 ? 'mt-1 pt-1 border-t border-slate-700' : ''}`}>
                          {part}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Row 5: location link */}
                  {inc.lat && inc.lng && (
                    <a
                      href={`https://maps.google.com/?q=${inc.lat},${inc.lng}`}
                      target="_blank" rel="noreferrer"
                      className="inline-block mt-1.5 text-blue-500 text-[11px] hover:text-blue-400 underline"
                    >
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
