import axios from 'axios';
import { env } from '../config/env.js';

const evolutionClient = axios.create({
  baseURL: env.evolutionApiUrl,
  headers: {
    apikey: env.evolutionApiKey,
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

function isAxiosNotFoundError(error) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function buildWebhookUrl() {
  if (!env.publicWebhookUrl) {
    return '';
  }

  const baseUrl = env.publicWebhookUrl.replace(/\/$/, '');
  const queryString = env.evolutionWebhookSecret
    ? `?secret=${encodeURIComponent(env.evolutionWebhookSecret)}`
    : '';

  return `${baseUrl}/webhook/evolution${queryString}`;
}

function normalizeOutboundNumber(value = '') {
  return String(value)
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@g\.us$/i, '')
    .replace(/@lid$/i, '')
    .replace(/\D/g, '');
}

const TYPING_BPM = 500;
const MIN_TYPING_MS = 800;
const MAX_TYPING_MS = 7000;
const HUMAN_JITTER_MS = 180;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateTypingDelay(text) {
  const safeText = String(text || '').trim();
  const charsPerMinute = TYPING_BPM;
  const baseDelayMs = safeText.length > 0 ? (safeText.length / charsPerMinute) * 60000 : MIN_TYPING_MS;
  const jitter = Math.floor(Math.random() * HUMAN_JITTER_MS);
  return clamp(Math.round(baseDelayMs + jitter), MIN_TYPING_MS, MAX_TYPING_MS);
}

async function sendTypingPresence({ number, delay }) {
  const normalizedNumber = normalizeOutboundNumber(number);

  await evolutionClient.post(`/chat/sendPresence/${env.evolutionInstance}`, {
    number: normalizedNumber,
    options: {
      delay,
      presence: 'composing',
      number: normalizedNumber
    }
  });
}

export async function sendTextMessage({ number, text }) {
  const typingDelay = calculateTypingDelay(text);
  const normalizedNumber = normalizeOutboundNumber(number);

  try {
    await sendTypingPresence({
      number: normalizedNumber,
      delay: typingDelay
    });

    await wait(typingDelay);
  } catch (error) {
    console.error('Falha ao enviar presence para Evolution. Seguindo com envio do texto.', {
      number,
      status: error?.response?.status,
      response: error?.response?.data || null,
      message: error?.message
    });
  }

  const response = await evolutionClient.post(`/message/sendText/${env.evolutionInstance}`, {
    number: normalizedNumber,
    text,
    delay: 0,
    linkPreview: false
  });

  return response.data;
}

export async function connectEvolutionInstance() {
  try {
    const response = await evolutionClient.get(`/instance/connect/${env.evolutionInstance}`);
    return {
      action: 'connected_existing_instance',
      data: response.data
    };
  } catch (error) {
    if (!isAxiosNotFoundError(error)) {
      throw error;
    }

    await createEvolutionInstance();

    const response = await evolutionClient.get(`/instance/connect/${env.evolutionInstance}`);

    return {
      action: 'created_and_connected_instance',
      data: response.data
    };
  }
}

async function createEvolutionInstance() {
  const webhookUrl = buildWebhookUrl();

  const response = await evolutionClient.post('/instance/create', {
    instanceName: env.evolutionInstance,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    webhook: webhookUrl
      ? {
          enabled: true,
          url: webhookUrl,
          byEvents: true,
          base64: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']
        }
      : undefined,
    rejectCall: true,
    msgCall: 'No momento nao atendemos chamadas por aqui.',
    groupsIgnore: true,
    alwaysOnline: true,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false
  });

  return response.data;
}
