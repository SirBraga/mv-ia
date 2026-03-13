import express from 'express';
import webhookRoutes from './routes/webhook.routes.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(webhookRoutes);

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  });

  return app;
}
