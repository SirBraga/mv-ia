import { Router } from 'express';
import { env } from '../config/env.js';
import { handleIncomingAnswer } from '../flows/qualification.flow.js';
import { connectEvolutionInstance } from '../services/evolution.service.js';
import { getIndications } from '../services/indication-store.service.js';
import { getAllSessions } from '../store/session-store.js';
import { normalizeEvolutionWebhook } from '../utils/webhook-normalizer.js';

const router = Router();
const processedWebhookMessages = new Map();
const PROCESSED_MESSAGE_TTL_MS = 2 * 60 * 1000;
const FALLBACK_DUPLICATE_WINDOW_MS = 8 * 1000;

function cleanupProcessedMessages(now = Date.now()) {
  for (const [key, expiresAt] of processedWebhookMessages.entries()) {
    if (expiresAt <= now) {
      processedWebhookMessages.delete(key);
    }
  }
}

function buildFallbackMessageFingerprint(normalized) {
  return [
    normalized.contactId,
    normalized.remoteJid,
    normalized.text.trim().toLowerCase()
  ].join('|');
}

function shouldIgnoreDuplicateWebhook(normalized) {
  const now = Date.now();
  cleanupProcessedMessages(now);

  if (normalized.messageId) {
    const messageKey = `id:${normalized.messageId}`;

    if (processedWebhookMessages.has(messageKey)) {
      return true;
    }

    processedWebhookMessages.set(messageKey, now + PROCESSED_MESSAGE_TTL_MS);
  }

  const fallbackKey = `fp:${buildFallbackMessageFingerprint(normalized)}`;
  const existingExpiry = processedWebhookMessages.get(fallbackKey);

  if (existingExpiry && existingExpiry > now) {
    return true;
  }

  processedWebhookMessages.set(fallbackKey, now + FALLBACK_DUPLICATE_WINDOW_MS);
  return false;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAnswersDashboard({ sessions, indications }) {
  const activeSessionsHtml = sessions.length
    ? sessions
        .map((session) => {
          const answers = Array.isArray(session.answers) && session.answers.length
            ? session.answers
                .map((answer, index) => `<li><strong>Resposta ${index + 1}:</strong> ${escapeHtml(answer || 'Nao informada')}</li>`)
                .join('')
            : '<li>Nenhuma resposta validada ainda.</li>';

          return `
            <article class="panel">
              <div class="panel-head">
                <div>
                  <h3>${escapeHtml(session.contactId)}</h3>
                  <p>Destino real: ${escapeHtml(session.replyTarget || 'Nao informado')}</p>
                </div>
                <span class="pill">${escapeHtml(session.status || 'collecting')}</span>
              </div>
              <div class="meta-grid">
                <div><span>Iniciado em</span><strong>${escapeHtml(session.startedAt || '-')}</strong></div>
                <div><span>Pergunta atual</span><strong>${Number(session.currentQuestionIndex || 0) + 1}</strong></div>
                <div><span>Reprompts</span><strong>${Number(session.repromptCount || 0)}</strong></div>
              </div>
              <ul class="answers-list">${answers}</ul>
            </article>
          `;
        })
        .join('')
    : '<div class="empty-state">Nenhuma sessao ativa no momento.</div>';

  const indicationsHtml = indications.length
    ? indications
        .slice()
        .reverse()
        .map((item) => `
          <article class="panel">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(item.customerIdentification || 'Sem identificacao')}</h3>
                <p>Indicador: ${escapeHtml(item.referrerWhatsapp || 'Nao informado')}</p>
              </div>
              <span class="pill success">Concluida</span>
            </div>
            <div class="meta-grid">
              <div><span>Empresa / contato</span><strong>${escapeHtml(item.referralCompanyAndContact || '-')}</strong></div>
              <div><span>Telefone</span><strong>${escapeHtml(item.referralPhone || '-')}</strong></div>
              <div><span>Capturada em</span><strong>${escapeHtml(item.createdAt || '-')}</strong></div>
            </div>
          </article>
        `)
        .join('')
    : '<div class="empty-state">Nenhuma indicacao concluida ainda.</div>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Painel de Respostas - Drica</title>
    <style>
      :root {
        --bg: #0a0d14;
        --panel: rgba(17, 24, 39, 0.82);
        --panel-border: rgba(148, 163, 184, 0.18);
        --text: #edf2f7;
        --muted: #94a3b8;
        --accent: #38bdf8;
        --success: #86efac;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.14), transparent 30%),
          radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 24%),
          linear-gradient(180deg, #030712 0%, #0a0d14 100%);
        color: var(--text);
        min-height: 100vh;
      }
      .shell {
        max-width: 1280px;
        margin: 0 auto;
        padding: 40px 20px 64px;
      }
      .hero {
        display: grid;
        gap: 16px;
        margin-bottom: 32px;
      }
      .eyebrow {
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 12px;
      }
      h1 {
        margin: 0;
        font-size: clamp(36px, 6vw, 72px);
        line-height: 0.96;
        max-width: 920px;
      }
      .hero p {
        margin: 0;
        max-width: 760px;
        color: var(--muted);
        font-family: "Helvetica Neue", Arial, sans-serif;
        line-height: 1.6;
      }
      .stats, .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .stat-card, .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }
      .stat-card {
        padding: 18px 20px;
      }
      .stat-card span {
        display: block;
        color: var(--muted);
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .stat-card strong {
        display: block;
        margin-top: 10px;
        font-size: 30px;
      }
      .section {
        margin-top: 36px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: end;
        margin-bottom: 16px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 28px;
      }
      .section-head p {
        margin: 0;
        color: var(--muted);
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      .panel {
        padding: 20px;
      }
      .panel-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
        margin-bottom: 18px;
      }
      .panel h3 {
        margin: 0 0 6px;
        font-size: 22px;
      }
      .panel-head p {
        margin: 0;
        color: var(--muted);
        font-family: "Helvetica Neue", Arial, sans-serif;
        line-height: 1.5;
      }
      .pill {
        border: 1px solid rgba(56, 189, 248, 0.35);
        color: var(--accent);
        border-radius: 999px;
        padding: 8px 12px;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 12px;
        white-space: nowrap;
      }
      .pill.success {
        color: var(--success);
        border-color: rgba(34, 197, 94, 0.35);
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .meta-grid div {
        background: rgba(15, 23, 42, 0.64);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 16px;
        padding: 14px;
      }
      .meta-grid span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-family: "Helvetica Neue", Arial, sans-serif;
        margin-bottom: 8px;
      }
      .meta-grid strong {
        font-size: 14px;
        line-height: 1.5;
      }
      .answers-list {
        margin: 0;
        padding-left: 18px;
        color: #dbe7f3;
        font-family: "Helvetica Neue", Arial, sans-serif;
        line-height: 1.7;
      }
      .empty-state {
        padding: 26px;
        border: 1px dashed rgba(148, 163, 184, 0.26);
        border-radius: 24px;
        color: var(--muted);
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: rgba(15, 23, 42, 0.46);
      }
      @media (max-width: 720px) {
        .shell { padding-top: 28px; }
        .panel-head, .section-head {
          flex-direction: column;
          align-items: start;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <span class="eyebrow">Drica / Captura operacional</span>
        <h1>Painel editorial para visualizar respostas capturadas no WhatsApp.</h1>
        <p>Este painel mostra o que ja foi validado no fluxo, separando sessoes ativas das indicacoes concluidas. Ele foi desenhado para leitura rapida, auditoria do funil e conferência operacional.</p>
        <section class="stats">
          <div class="stat-card">
            <span>Sessoes ativas</span>
            <strong>${sessions.length}</strong>
          </div>
          <div class="stat-card">
            <span>Indicacoes concluidas</span>
            <strong>${indications.length}</strong>
          </div>
        </section>
      </header>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Sessoes em andamento</h2>
            <p>Respostas ja capturadas e estado atual da conversa.</p>
          </div>
        </div>
        <div class="grid">${activeSessionsHtml}</div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Indicacoes concluidas</h2>
            <p>Leads ja finalizados e persistidos no armazenamento.</p>
          </div>
        </div>
        <div class="grid">${indicationsHtml}</div>
      </section>
    </main>
  </body>
</html>`;
}

async function handleEvolutionWebhookRequest(req, res, next) {
  try {
    const normalized = normalizeEvolutionWebhook(req.body);

    if (!normalized.isValidTextMessage) {
      return res.status(200).json({ ignored: true, reason: 'payload_without_supported_text_message' });
    }

    if (shouldIgnoreDuplicateWebhook(normalized)) {
      return res.status(200).json({ ignored: true, reason: 'duplicate_webhook_event' });
    }

    const result = await handleIncomingAnswer({
      contactId: normalized.contactId,
      text: normalized.text,
      replyTarget: normalized.remoteJid
    });

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
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

router.get('/dashboard/respostas', (_req, res) => {
  const sessions = getAllSessions();
  const indications = getIndications();
  return res.status(200).send(renderAnswersDashboard({ sessions, indications }));
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

router.post('/webhook/evolution', handleEvolutionWebhookRequest);
router.post('/messages-upsert', handleEvolutionWebhookRequest);

export default router;
