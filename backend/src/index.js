const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDB, pool } = require('./db');
const incidentRoutes = require('./routes/incidents');
const { router: settingsRoutes } = require('./routes/settings');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Attach socket.io instance to every request
app.use((req, _res, next) => {
  req.io = io;
  next();
});

app.use('/api/incidents', incidentRoutes);
app.use('/api/settings',  settingsRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const teamStatuses = {}; // label -> status string (persisted to DB)

async function persistTeamStatuses() {
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('team_statuses', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(teamStatuses)]
    );
  } catch (err) {
    console.error('Failed to persist team statuses:', err.message);
  }
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  // Send current team statuses to newly connected client
  if (Object.keys(teamStatuses).length > 0) {
    socket.emit('team_statuses', teamStatuses);
  }
  socket.on('team_status', ({ label, status }) => {
    teamStatuses[label] = status;
    io.emit('team_status_updated', { label, status });
    persistTeamStatuses();
  });
  socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`));
});

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await initDB();
    // Restore persisted team statuses
    try {
      const r = await pool.query("SELECT value FROM settings WHERE key = 'team_statuses'");
      if (r.rows.length) Object.assign(teamStatuses, r.rows[0].value);
    } catch {}
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`MET backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
