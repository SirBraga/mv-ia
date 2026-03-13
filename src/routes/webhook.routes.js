import { Router } from 'express';
import { env } from '../config/env.js';
import { handleIncomingAnswer } from '../flows/qualification.flow.js';
import { connectEvolutionInstance } from '../services/evolution.service.js';
import { getIndications } from '../services/indication-store.service.js';
import { getAllSessions } from '../store/session-store.js';
import { normalizeEvolutionWebhook } from '../utils/webhook-normalizer.js';

const router = Router();

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

router.get('/sessions', (_req, res) => {
  res.json({ sessions: getAllSessions() });
});

router.get('/indications', (_req, res) => {
  res.json({ indications: getIndications() });
});

router.get('/evolution/connect', async (_req, res, next) => {
  try {
    const data = await connectEvolutionInstance();
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/evolution/qrcode', async (_req, res) => {
  try {
    const result = await connectEvolutionInstance();
    const payload = result?.data || {};
    const pairingCode = payload?.pairingCode || '';
    const qrCodeValue = payload?.code || '';
    const action = result?.action || 'unknown';
    const qrImageUrl = qrCodeValue
      ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrCodeValue)}`
      : '';

    return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QR Code Evolution - Drica</title>
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 560px;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        color: #94a3b8;
        line-height: 1.5;
      }
      .badge {
        display: inline-block;
        background: #1d4ed8;
        color: white;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 13px;
        margin: 8px 0 20px;
      }
      .qr-box {
        background: white;
        border-radius: 16px;
        padding: 16px;
        display: flex;
        justify-content: center;
        margin: 20px 0;
      }
      .qr-box img {
        width: 320px;
        height: 320px;
      }
      .label {
        font-size: 12px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-top: 18px;
        margin-bottom: 8px;
      }
      .code {
        background: #0b1220;
        border: 1px solid #1f2937;
        border-radius: 12px;
        padding: 14px;
        word-break: break-word;
        color: #f8fafc;
      }
      .empty {
        padding: 16px;
        border-radius: 12px;
        background: #1e293b;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>QR Code da Drica</h1>
      <p>Escaneie com o WhatsApp para conectar a instância da Evolution. Se a instância não existia, ela foi criada automaticamente.</p>
      <div class="badge">${escapeHtml(action)}</div>
      ${
        qrImageUrl
          ? `<div class="qr-box"><img src="${qrImageUrl}" alt="QR Code da instância Drica" /></div>`
          : `<div class="empty">A Evolution não retornou o campo <strong>code</strong> para gerar o QR visual.</div>`
      }
      <div class="label">Pairing Code</div>
      <div class="code">${escapeHtml(pairingCode || 'Nao informado')}</div>
      <div class="label">Codigo bruto do QR</div>
      <div class="code">${escapeHtml(qrCodeValue || 'Nao informado')}</div>
    </div>
  </body>
</html>`);
  } catch (error) {
    return res.status(500).send(`<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Erro ao gerar QR</title>
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #111827;
        color: #f8fafc;
        padding: 24px;
      }
      .box {
        max-width: 760px;
        margin: 40px auto;
        background: #1f2937;
        border-radius: 16px;
        padding: 24px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #0b1220;
        padding: 16px;
        border-radius: 12px;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Erro ao gerar QR Code</h1>
      <p>O backend tentou conectar/criar a instância, mas a Evolution retornou erro.</p>
      <pre>${escapeHtml(error?.stack || error?.message || 'Erro desconhecido')}</pre>
    </div>
  </body>
</html>`);
  }
});

router.post('/webhook/evolution', async (req, res, next) => {
  try {
    const headerSecret = req.header('x-webhook-secret') || req.header('x-evolution-secret') || '';
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
    const providedSecret = headerSecret || querySecret;

    if (env.evolutionWebhookSecret && providedSecret !== env.evolutionWebhookSecret) {
      return res.status(401).json({ error: 'Webhook nao autorizado' });
    }

    const normalized = normalizeEvolutionWebhook(req.body);

    if (!normalized.isValidTextMessage) {
      return res.status(200).json({ ignored: true, reason: 'payload_without_supported_text_message' });
    }

    const result = await handleIncomingAnswer({
      contactId: normalized.contactId,
      text: normalized.text
    });

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

export default router;
