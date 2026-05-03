import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const BLACKLIST_FILE = path.join(__dirname, '..', '..', 'data', 'blacklist.json');

// { guildId: [entries] }
let blacklists = {};

export function loadBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'));
      // migration: ancien format était un tableau plat
      if (Array.isArray(raw)) {
        blacklists = {};
        log('Blacklist: ancien format détecté, reset (multi-serveur)');
      } else {
        blacklists = raw ?? {};
        let total = 0;
        for (const entries of Object.values(blacklists)) total += entries.length;
        log(`Blacklist loaded: ${total} entries across ${Object.keys(blacklists).length} guild(s)`);
      }
    } else {
      blacklists = {};
    }
  } catch (e) {
    error('Error loading blacklist:', e);
    blacklists = {};
  }
}

export function saveBlacklist() {
  try {
    safeWriteJSON(BLACKLIST_FILE, blacklists);
  } catch (e) {
    error('Error saving blacklist:', e);
  }
}

export const getBlacklist = (guildId) => blacklists[guildId] ?? [];

export function addBlacklistEntry(guildId, entry) {
  if (!blacklists[guildId]) blacklists[guildId] = [];
  blacklists[guildId].push(entry);
  saveBlacklist();
}

export function removeBlacklistEntry(guildId, id) {
  if (!blacklists[guildId]) return false;
  const prev = blacklists[guildId].length;
  blacklists[guildId] = blacklists[guildId].filter(e => e.id !== id);
  if (blacklists[guildId].length !== prev) { saveBlacklist(); return true; }
  return false;
}

export function isBlacklisted(guildId, id) {
  return (blacklists[guildId] ?? []).some(e => e.id === id);
}

loadBlacklist();
