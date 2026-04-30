import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'candidature-store.json');

let store = {};

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteJSON(DATA_FILE, store);
  } catch (e) {
    error('[CandStore] Erreur sauvegarde:', e);
  }
}

export function loadCandidatureStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    error('[CandStore] Erreur chargement:', e);
    store = {};
  }
  return store;
}

export function saveCandidatureEntry(messageId, data) {
  store[messageId] = { ...data, savedAt: Date.now() };
  save();
}

export function getAllEntries() {
  return Object.entries(store).map(([msgId, data]) => ({ msgId, ...data }));
}

loadCandidatureStore();
