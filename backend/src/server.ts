import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db/database';
import apiRouter from './routes/api';
import { setupGoogleCalendarSync } from './services/googleCalendarSync';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize DB & Crons
initDatabase();
setupGoogleCalendarSync();

// API Routes
app.use('/api', apiRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint da API não encontrado.' });
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'quick-turing-backend',
    apiVersion: 4,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend static build if built
const frontendBuildPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendBuildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
    if (err) {
      res.send('Quick Turing Backend API is running on port ' + PORT);
    }
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Backend Quick Turing rodando em http://localhost:${PORT}`);
  console.log(`📡 Endpoints API disponíveis em http://localhost:${PORT}/api`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
