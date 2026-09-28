import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db/database';
import apiRouter from './routes/api';
import serviceOrdersRouter from './routes/serviceOrders';
import supportRouter from './routes/support';
import { setupGoogleCalendarSync } from './services/googleCalendarSync';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET é obrigatório em produção. Configure o segredo independente antes de iniciar o servidor.');
}

// Middleware
// O frontend envia o JWT pelo header Authorization, portanto não precisamos
// liberar credenciais/cookies para qualquer origem. Em produção, configure
// CORS_ALLOWED_ORIGINS com as origens reais separadas por vírgula.
const configuredOrigins = new Set(
  [process.env.PUBLIC_APP_URL, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')]
    .map(origin => origin?.trim().replace(/\/$/, ''))
    .filter((origin): origin is string => Boolean(origin))
);
if (process.env.NODE_ENV !== 'production') {
  configuredOrigins.add('http://localhost:5173');
  configuredOrigins.add('http://127.0.0.1:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    // Navegação same-origin e ferramentas de saúde não enviam Origin.
    if (!origin || configuredOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  maxAge: 600
}));
app.use(express.json({ limit: '8mb' }));

// Initialize DB & Crons
initDatabase();
setupGoogleCalendarSync();

// API Routes
app.use('/api/service-orders', serviceOrdersRouter);
app.use('/api/support', supportRouter);
app.use('/api', apiRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint da API não encontrado.' });
});

// Healthcheck
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'quick-turing-backend',
    apiVersion: 5,
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
