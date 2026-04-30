import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'watcher-config.json');

let config = { sourceChannelIds: [], targetChannelIds: [] };

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteJSON(DATA_FILE, config);
  } catch (e) {
    error('[Watcher] Erreur sauvegarde:', e);
  }
}

export function loadWatcherConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      config = {
        sourceChannelIds: parsed.sourceChannelIds ?? [],
        targetChannelIds: parsed.targetChannelIds ?? [],
      };
    }
  } catch (e) {
    error('[Watcher] Erreur chargement:', e);
  }
  return config;
}

export const getWatcherConfig = () => config;

export function addWatcherSource(id) {
  if (config.sourceChannelIds.includes(id)) return false;
  config.sourceChannelIds.push(id);
  save();
  return true;
}

export function removeWatcherSource(id) {
  const prev = config.sourceChannelIds.length;
  config.sourceChannelIds = config.sourceChannelIds.filter(x => x !== id);
  if (config.sourceChannelIds.length !== prev) { save(); return true; }
  return false;
}

export function addWatcherTarget(id) {
  if (config.targetChannelIds.includes(id)) return false;
  config.targetChannelIds.push(id);
  save();
  return true;
}

export function removeWatcherTarget(id) {
  const prev = config.targetChannelIds.length;
  config.targetChannelIds = config.targetChannelIds.filter(x => x !== id);
  if (config.targetChannelIds.length !== prev) { save(); return true; }
  return false;
}

loadWatcherConfig();
