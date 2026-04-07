const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

// ─── Upload directory ────────────────────────────────────────────────────────

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.gpx', '.geojson', '.json', '.mp3', '.wav', '.ogg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ─── Default settings ────────────────────────────────────────────────────────

const DEFAULTS = {
  teams: [
    { role: 'coordinator', label: 'Coordinator' },
    { role: 'team3km',     label: 'Team 3km'    },
    { role: 'team5km',     label: 'Team 5km'    },
    { role: 'team10km',    label: 'Team 10km'   },
    { role: 'team15km',    label: 'Team 15km'   },
    { role: 'team20km',    label: 'Team 20km'   },
  ],
  materials: [
    { key: 'pleisters',         label: 'Pleisters',    icon: '🩹' },
    { key: 'zwachtel',          label: 'Zwachtel',     icon: '🫧' },
    { key: 'desinfectiemiddel', label: 'Desinfectie',  icon: '🧴' },
    { key: 'noodfolie',         label: 'Noodfolie',    icon: '🪙' },
    { key: 'coldpack',          label: 'Coldpack',     icon: '🧊' },
    { key: 'pijnstillers',      label: 'Pijnstillers', icon: '💊' },
  ],
  events:       [],
  sound:        { type: 'default' },
  active_event: null, // { id, name } | null
};

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function getAll() {
  const result = await pool.query('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULTS);
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

async function set(key, value, io) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
  io?.emit('settings_updated', { key, value });
}

// ─── File parsers ────────────────────────────────────────────────────────────

function parseGPX(xml) {
  const coords = [];
  const re = /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"|<trkpt\b[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    coords.push([parseFloat(m[1] ?? m[4]), parseFloat(m[2] ?? m[3])]);
  }
  return coords;
}

function parseGPXWaypoints(xml) {
  const waypoints = [];
  const re = /<wpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner     = m[3];
    const nameMatch = /<name>([^<]*)<\/name>/.exec(inner);
    const symMatch  = /<sym>([^<]*)<\/sym>/.exec(inner);
    waypoints.push({
      id:   uuidv4(),
      lat:  parseFloat(m[1]),
      lng:  parseFloat(m[2]),
      name: nameMatch ? nameMatch[1].trim() : '',
      sym:  symMatch  ? symMatch[1].trim()  : '',
    });
  }
  return waypoints;
}

function parseGeoJSON(text) {
  const gj = JSON.parse(text);
  const coords = [];
  for (const f of (gj.features ?? [gj])) {
    const geom = f.geometry ?? f;
    if (geom.type === 'LineString') {
      coords.push(...geom.coordinates.map(([lng, lat]) => [lat, lng]));
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        coords.push(...line.map(([lng, lat]) => [lat, lng]));
      }
    }
  }
  return coords;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/settings
router.get('/', async (_req, res) => {
  try { res.json(await getAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/active_event
router.put('/active_event', async (req, res) => {
  try { await set('active_event', req.body.value, req.io); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/teams
router.put('/teams', async (req, res) => {
  try { await set('teams', req.body.value, req.io); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/materials
router.put('/materials', async (req, res) => {
  try { await set('materials', req.body.value, req.io); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/events
router.put('/events', async (req, res) => {
  try { await set('events', req.body.value, req.io); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/settings/upload/sound
router.post('/upload/sound', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const value = { type: 'custom', filename: req.file.filename, originalName: req.file.originalname };
  try { await set('sound', value, req.io); res.json(value); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/settings/sound  →  reset to default
router.delete('/sound', async (req, res) => {
  try { await set('sound', { type: 'default' }, req.io); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/settings/events/:eventId/routes  →  upload + parse route file
router.post('/events/:eventId/routes', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const { eventId } = req.params;
  const { name, color, width } = req.body;

  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const ext     = path.extname(req.file.originalname).toLowerCase();
    const coords  = ext === '.gpx' ? parseGPX(content) : parseGeoJSON(content);

    if (!coords.length) return res.status(422).json({ error: 'Geen coördinaten gevonden in bestand' });

    const s     = await getAll();
    const event = s.events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Evenement niet gevonden' });

    (event.routes ??= []).push({
      id:     uuidv4(),
      name:   name || req.file.originalname,
      color:  color || '#3b82f6',
      width:  parseInt(width) || 4,
      coords,
    });

    await set('events', s.events, req.io);
    res.json({ ok: true, coordCount: coords.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/events/:eventId/waypoints  →  upload + parse GPX waypoints
router.post('/events/:eventId/waypoints', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const { eventId } = req.params;
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.gpx') return res.status(422).json({ error: 'Alleen GPX bestanden ondersteund voor waypoints' });
    const content   = fs.readFileSync(req.file.path, 'utf8');
    const waypoints = parseGPXWaypoints(content);
    if (!waypoints.length) return res.status(422).json({ error: 'Geen waypoints (<wpt>) gevonden in bestand' });

    const s     = await getAll();
    const event = s.events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Evenement niet gevonden' });

    (event.waypoints ??= []).push(...waypoints);
    await set('events', s.events, req.io);
    res.json({ ok: true, count: waypoints.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/settings/events/:eventId/waypoints/:waypointId
router.delete('/events/:eventId/waypoints/:waypointId', async (req, res) => {
  const { eventId, waypointId } = req.params;
  try {
    const s     = await getAll();
    const event = s.events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Evenement niet gevonden' });
    event.waypoints = (event.waypoints ?? []).filter(w => w.id !== waypointId);
    await set('events', s.events, req.io);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/settings/events/:eventId/routes/:routeId
router.delete('/events/:eventId/routes/:routeId', async (req, res) => {
  const { eventId, routeId } = req.params;
  try {
    const s     = await getAll();
    const event = s.events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'Evenement niet gevonden' });
    event.routes = (event.routes ?? []).filter(r => r.id !== routeId);
    await set('events', s.events, req.io);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message }); }
});

// Serve uploaded files
router.get('/uploads/:filename', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(file);
});

module.exports = { router, getAll, DEFAULTS };
