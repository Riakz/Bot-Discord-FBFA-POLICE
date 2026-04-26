import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'liens-config.json');

let configs = {};

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(configs, null, 2), 'utf8');
  } catch (e) {
    error('[LiensConfig] Erreur sauvegarde:', e);
  }
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      configs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    error('[LiensConfig] Erreur chargement:', e);
  }
}

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = { allowedRoleIds: [] };
  return configs[guildId];
}

export function getLiensConfig(guildId) {
  return getConfig(guildId);
}

export function addLiensRole(guildId, roleId) {
  const cfg = getConfig(guildId);
  if (cfg.allowedRoleIds.includes(roleId)) return false;
  cfg.allowedRoleIds.push(roleId);
  save();
  return true;
}

export function removeLiensRole(guildId, roleId) {
  const cfg = getConfig(guildId);
  const prev = cfg.allowedRoleIds.length;
  cfg.allowedRoleIds = cfg.allowedRoleIds.filter(id => id !== roleId);
  if (cfg.allowedRoleIds.length !== prev) { save(); return true; }
  return false;
}

load();
