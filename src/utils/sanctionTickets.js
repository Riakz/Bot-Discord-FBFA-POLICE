import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'sanction-tickets.json');

// [{ channelId, guildId, closeAt }]
let tickets = [];

function save() {
  try { safeWriteJSON(DATA_FILE, tickets); }
  catch (e) { error('[SanctionTickets] Erreur sauvegarde:', e); }
}

export function loadSanctionTickets() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      tickets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) ?? [];
    }
  } catch (e) { error('[SanctionTickets] Erreur chargement:', e); }
}

export function addSanctionTicket(guildId, channelId, closeAt) {
  tickets.push({ channelId, guildId, closeAt });
  save();
}

export function removeSanctionTicket(channelId) {
  tickets = tickets.filter(t => t.channelId !== channelId);
  save();
}

export function getExpiredSanctionTickets() {
  const now = Date.now();
  return tickets.filter(t => t.closeAt <= now);
}

loadSanctionTickets();
