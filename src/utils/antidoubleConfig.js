import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'antidouble-config.json');

let config = {
  alertChannelId: null,
  blChannelId:    null,
  bannedRoleId:   null,
  operatorIds:    [],
  operatorRoles:  [],
};

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteJSON(DATA_FILE, config);
  } catch (e) {
    error('[AntidoubleConfig] Erreur sauvegarde:', e);
  }
}

export function loadAntidoubleConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      config = {
        alertChannelId: parsed.alertChannelId ?? null,
        blChannelId:    parsed.blChannelId    ?? null,
        bannedRoleId:   parsed.bannedRoleId   ?? null,
        operatorIds:    parsed.operatorIds    ?? [],
        operatorRoles:  parsed.operatorRoles  ?? [],
      };
    }
  } catch (e) {
    error('[AntidoubleConfig] Erreur chargement:', e);
  }
  return config;
}

export const getAntidoubleConfig = () => config;

export function setAlertChannel(id)  { config.alertChannelId = id; save(); }
export function setBlChannel(id)     { config.blChannelId    = id; save(); }
export function setBannedRole(id)    { config.bannedRoleId   = id; save(); }

export function addOperator(userId) {
  if (config.operatorIds.includes(userId)) return false;
  config.operatorIds.push(userId);
  save();
  return true;
}

export function removeOperator(userId) {
  const prev = config.operatorIds.length;
  config.operatorIds = config.operatorIds.filter(id => id !== userId);
  if (config.operatorIds.length !== prev) { save(); return true; }
  return false;
}

export function addOperatorRole(roleId) {
  if (config.operatorRoles.includes(roleId)) return false;
  config.operatorRoles.push(roleId);
  save();
  return true;
}

export function removeOperatorRole(roleId) {
  const prev = config.operatorRoles.length;
  config.operatorRoles = config.operatorRoles.filter(id => id !== roleId);
  if (config.operatorRoles.length !== prev) { save(); return true; }
  return false;
}

export function isOperator(memberOrUserId) {
  if (!memberOrUserId) return false;
  
  // Si c'est juste un string (userId), on ne peut vérifier que l'ID
  if (typeof memberOrUserId === 'string') {
    return config.operatorIds.includes(memberOrUserId);
  }
  
  // Si c'est un objet membre Discord
  if (memberOrUserId.id) {
    if (config.operatorIds.includes(memberOrUserId.id)) return true;
  }
  
  // Vérification des rôles si disponible
  if (memberOrUserId.roles && memberOrUserId.roles.cache) {
    return config.operatorRoles.some(roleId => memberOrUserId.roles.cache.has(roleId));
  }
  
  return false;
}

loadAntidoubleConfig();
