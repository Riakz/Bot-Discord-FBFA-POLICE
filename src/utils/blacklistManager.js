import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const BLACKLIST_FILE = path.join(__dirname, '..', '..', 'data', 'blacklist.json');

let blacklist = [];

export function loadBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      blacklist = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'));
      log(`Blacklist loaded: ${blacklist.length} entries`);
    } else {
      blacklist = [];
    }
  } catch (e) {
    error('Error loading blacklist:', e);
    blacklist = [];
  }
  return blacklist;
}

export function saveBlacklist() {
  try {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(blacklist, null, 2), 'utf8');
  } catch (e) {
    error('Error saving blacklist:', e);
  }
}

export const getBlacklist = () => blacklist;

export function addBlacklistEntry(entry) {
  blacklist.push(entry);
  saveBlacklist();
}

export function removeBlacklistEntry(id) {
  const before = blacklist.length;
  blacklist = blacklist.filter(e => e.id !== id);
  if (blacklist.length !== before) { saveBlacklist(); return true; }
  return false;
}

export function isBlacklisted(id) {
  return blacklist.some(e => e.id === id);
}

loadBlacklist();
