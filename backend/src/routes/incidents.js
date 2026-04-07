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
  const { reporter, priority, complaint, lat, lng, event_id, event_name, assigned_team } = req.body;

  if (!reporter || !priority) {
    return res.status(400).json({ error: 'reporter and priority are required' });
  }
  if (!['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be low, medium, or high' });
  }

  const id = uuidv4();
  try {
    const result = await pool.query(
      `INSERT INTO incidents (id, reporter, priority, status, complaint, lat, lng, event_id, event_name, assigned_team)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, reporter, priority, complaint || null, lat || null, lng || null, event_id || null, event_name || null, assigned_team || null]
    );
    const incident = result.rows[0];
    req.io.emit('new_incident', incident);
    res.status(201).json(incident);
  } catch (err) {
    console.error('POST /incidents error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /:id/assign — assign or unassign a team
router.patch('/:id/assign', async (req, res) => {
  const { team } = req.body;
  try {
    const result = await pool.query(
      'UPDATE incidents SET assigned_team = $1 WHERE id = $2 RETURNING *',
      [team || null, req.params.id]
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
  const { notes } = req.body || {};
  try {
    const result = await pool.query(
      notes?.trim()
        ? `UPDATE incidents SET status = 'closed',
             complaint = CASE WHEN complaint IS NULL OR complaint = ''
               THEN $2
               ELSE complaint || E'\n\n' || $2
             END
           WHERE id = $1 RETURNING *`
        : `UPDATE incidents SET status = 'closed' WHERE id = $1 RETURNING *`,
      notes?.trim() ? [req.params.id, notes.trim()] : [req.params.id]
    );
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
