const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDB } = require('./db');
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

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`));
});

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await initDB();
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`SMET backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
