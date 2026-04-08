const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET all incidents, newest first
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM incidents ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /incidents error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST new incident
router.post('/', async (req, res) => {
  const { reporter, priority, complaint, lat, lng, event_id, event_name, assigned_team, source, materials_used } = req.body;

  if (!reporter || !priority) {
    return res.status(400).json({ error: 'reporter and priority are required' });
  }
  if (!['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be low, medium, or high' });
  }

  const id = uuidv4();
  const history = assigned_team
    ? [{ type: 'assigned', team: assigned_team, timestamp: new Date().toISOString() }]
    : [];

  try {
    const result = await pool.query(
      `INSERT INTO incidents
         (id, reporter, priority, status, complaint, lat, lng, event_id, event_name,
          assigned_team, source, materials_used, assignment_history)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
       RETURNING *`,
      [
        id, reporter, priority,
        complaint || null, lat || null, lng || null,
        event_id || null, event_name || null, assigned_team || null,
        source || 'team',
        JSON.stringify(Array.isArray(materials_used) ? materials_used : []),
        JSON.stringify(history),
      ]
    );
    const incident = result.rows[0];
    req.io.emit('new_incident', incident);
    res.status(201).json(incident);
  } catch (err) {
    console.error('POST /incidents error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/eta — set/clear ETA text
router.patch('/:id/eta', async (req, res) => {
  const { eta } = req.body;
  try {
    const result = await pool.query(
      'UPDATE incidents SET eta_text = $1 WHERE id = $2 RETURNING *',
      [eta?.trim() || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/eta error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/reject — team rejects the assignment
router.patch('/:id/reject', async (req, res) => {
  const { team, reason } = req.body;
  const entry = { type: 'rejected', team: team || null, reason: reason?.trim() || null, timestamp: new Date().toISOString() };
  try {
    const result = await pool.query(
      `UPDATE incidents
       SET assigned_team = NULL, rejected_by = $2, rejection_reason = $3,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
       WHERE id = $1 RETURNING *`,
      [req.params.id, team || null, reason?.trim() || null, JSON.stringify([entry])]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/reject error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/accept — team accepts/acknowledges the assignment
router.patch('/:id/accept', async (req, res) => {
  const { team, eta } = req.body;
  const now = new Date().toISOString();
  const entry = { type: 'accepted', team: team || null, timestamp: now, eta: eta?.trim() || null };
  try {
    const result = await pool.query(
      `UPDATE incidents
       SET accepted_at = $2, eta_text = COALESCE($3, eta_text),
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
       WHERE id = $1 RETURNING *`,
      [req.params.id, now, eta?.trim() || null, JSON.stringify([entry])]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/accept error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/assign — assign or unassign a team
router.patch('/:id/assign', async (req, res) => {
  const { team } = req.body;
  const entry = team
    ? { type: 'assigned', team, timestamp: new Date().toISOString() }
    : { type: 'unassigned', timestamp: new Date().toISOString() };
  try {
    const result = await pool.query(
      `UPDATE incidents
       SET assigned_team = $1, accepted_at = NULL,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $3::jsonb
       WHERE id = $2 RETURNING *`,
      [team || null, req.params.id, JSON.stringify([entry])]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/assign error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/close — mark incident as closed, optionally append notes to complaint
router.patch('/:id/close', async (req, res) => {
  const { notes, materials_used } = req.body || {};
  const now = new Date().toISOString();
  const entry = { type: 'closed', timestamp: now };
  try {
    let query, params;
    if (notes?.trim()) {
      query = `UPDATE incidents
               SET status = 'closed', closed_at = $2,
                   complaint = CASE WHEN complaint IS NULL OR complaint = ''
                     THEN $3 ELSE complaint || E'\n\n' || $3 END,
                   materials_used = CASE WHEN $4::jsonb != '[]'::jsonb THEN $4::jsonb ELSE materials_used END,
                   assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $5::jsonb
               WHERE id = $1 RETURNING *`;
      params = [req.params.id, now, notes.trim(),
                JSON.stringify(Array.isArray(materials_used) ? materials_used : []),
                JSON.stringify([entry])];
    } else {
      query = `UPDATE incidents
               SET status = 'closed', closed_at = $2,
                   materials_used = CASE WHEN $3::jsonb != '[]'::jsonb THEN $3::jsonb ELSE materials_used END,
                   assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
               WHERE id = $1 RETURNING *`;
      params = [req.params.id, now,
                JSON.stringify(Array.isArray(materials_used) ? materials_used : []),
                JSON.stringify([entry])];
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/close error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/location — update the GPS location (coordinator correction)
router.patch('/:id/location', async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  const entry = { type: 'location_updated', timestamp: new Date().toISOString() };
  try {
    const result = await pool.query(
      `UPDATE incidents
       SET lat = $2, lng = $3,
           assignment_history = COALESCE(assignment_history, '[]'::jsonb) || $4::jsonb
       WHERE id = $1 RETURNING *`,
      [req.params.id, lat, lng, JSON.stringify([entry])]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });
    const incident = result.rows[0];
    req.io.emit('incident_updated', incident);
    res.json(incident);
  } catch (err) {
    console.error('PATCH /incidents/:id/location error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /:id — remove a single incident
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM incidents WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    req.io.emit('incident_deleted', { id: req.params.id });
    res.json({ id: req.params.id });
  } catch (err) {
    console.error('DELETE /incidents/:id error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE / — remove all closed incidents
router.delete('/', async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM incidents WHERE status = 'closed' RETURNING id"
    );
    const ids = result.rows.map((r) => r.id);
    req.io.emit('incidents_bulk_deleted', { ids });
    res.json({ deleted: ids.length });
  } catch (err) {
    console.error('DELETE /incidents error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /all — remove every incident (full reset)
router.delete('/reset/all', async (req, res) => {
  try {
    await pool.query('DELETE FROM incidents');
    req.io.emit('incidents_reset');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /incidents/reset/all error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
