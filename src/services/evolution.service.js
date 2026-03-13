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
  await evolutionClient.post(`/chat/sendPresence/${env.evolutionInstance}`, {
    number,
    options: {
      delay,
      presence: 'composing'
    }
  });
}

export async function sendTextMessage({ number, text }) {
  const typingDelay = calculateTypingDelay(text);

  await sendTypingPresence({
    number,
    delay: typingDelay
  });

  await wait(typingDelay);

  const response = await evolutionClient.post(`/message/sendText/${env.evolutionInstance}`, {
    number,
    textMessage: {
      text
    },
    options: {
      delay: 0,
      presence: 'composing'
    }
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
  const response = await evolutionClient.post('/instance/create', {
    instanceName: env.evolutionInstance,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
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
