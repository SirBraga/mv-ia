import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptFilePath = path.resolve(__dirname, '../prompts/base-system-prompt.txt');

function readRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}

function readBaseSystemPrompt() {
  return fs.readFileSync(promptFilePath, 'utf-8').trim();
}

export const env = {
  port: Number(process.env.PORT || 3000),
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  evolutionApiUrl: process.env.EVOLUTION_API_URL || '',
  evolutionApiKey: process.env.EVOLUTION_API_KEY || '',
  evolutionInstance: process.env.EVOLUTION_INSTANCE || '',
  evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || '',
  baseSystemPrompt: readBaseSystemPrompt(),
  minAnswerLength: Number(process.env.MIN_ANSWER_LENGTH || 12),
};

export function validateStartupEnv() {
  readRequiredEnv('GROQ_API_KEY');
  readRequiredEnv('EVOLUTION_API_URL');
  readRequiredEnv('EVOLUTION_API_KEY');
  readRequiredEnv('EVOLUTION_INSTANCE');
}
