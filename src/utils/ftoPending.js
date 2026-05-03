import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'fto-pending.json');

// { guildId: { userId: { deadline, addedBy, addedAt } } }
let pending = {};

function save() {
  try { safeWriteJSON(DATA_FILE, pending); }
  catch (e) { error('[FTOPending] Erreur sauvegarde:', e); }
}

export function loadFtoPending() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      pending = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) { error('[FTOPending] Erreur chargement:', e); }
}

export const getFtoPending = (guildId) => pending[guildId] ?? {};

export function addFtoPending(guildId, userId, addedBy, days) {
  if (!pending[guildId]) pending[guildId] = {};
  pending[guildId][userId] = {
    deadline: Date.now() + days * 24 * 3600 * 1000,
    addedBy,
    addedAt: Date.now(),
  };
  save();
}

export function removeFtoPending(guildId, userId) {
  if (!pending[guildId]?.[userId]) return false;
  delete pending[guildId][userId];
  if (Object.keys(pending[guildId]).length === 0) delete pending[guildId];
  save();
  return true;
}

export function isFtoPending(guildId, userId) {
  return !!pending[guildId]?.[userId];
}

export function getExpiredPending() {
  const now = Date.now();
  const results = [];
  for (const [guildId, users] of Object.entries(pending)) {
    for (const [userId, data] of Object.entries(users)) {
      if (data.deadline <= now) results.push({ guildId, userId, ...data });
    }
  }
  return results;
}

export function getAllPending() { return pending; }

loadFtoPending();
