import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indicationsFilePath = path.resolve(__dirname, '../storage/indications.json');

function ensureStorageFile() {
  if (!fs.existsSync(indicationsFilePath)) {
    fs.mkdirSync(path.dirname(indicationsFilePath), { recursive: true });
    fs.writeFileSync(indicationsFilePath, '[]', 'utf-8');
  }
}

function readIndications() {
  ensureStorageFile();

  const raw = fs.readFileSync(indicationsFilePath, 'utf-8').trim();

  if (!raw) {
    return [];
  }

  return JSON.parse(raw);
}

export function saveIndication(indication) {
  const indications = readIndications();
  indications.push(indication);
  fs.writeFileSync(indicationsFilePath, JSON.stringify(indications, null, 2), 'utf-8');
  return indication;
}

export function getIndications() {
  return readIndications();
}
