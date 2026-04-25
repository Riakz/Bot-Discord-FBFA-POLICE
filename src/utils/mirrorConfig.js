import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'mirror-config.json');

let config = { mirrors: {} };

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    error('[Mirror] Erreur sauvegarde:', e);
  }
}

export function loadMirrorConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      config = { mirrors: parsed.mirrors ?? {} };
    }
  } catch (e) {
    error('[Mirror] Erreur chargement:', e);
  }
  return config;
}

export const getMirrorConfig = () => config;

export function addMirror(sourceId, targetId) {
  if (!config.mirrors[sourceId]) config.mirrors[sourceId] = [];
  if (config.mirrors[sourceId].includes(targetId)) return false;
  config.mirrors[sourceId].push(targetId);
  save();
  return true;
}

export function removeMirror(sourceId, targetId) {
  if (!config.mirrors[sourceId]) return false;
  const prev = config.mirrors[sourceId].length;
  config.mirrors[sourceId] = config.mirrors[sourceId].filter(x => x !== targetId);
  if (config.mirrors[sourceId].length !== prev) {
    if (config.mirrors[sourceId].length === 0) delete config.mirrors[sourceId];
    save();
    return true;
  }
  return false;
}

export function clearMirror(sourceId) {
  if (!config.mirrors[sourceId]) return false;
  delete config.mirrors[sourceId];
  save();
  return true;
}

loadMirrorConfig();
