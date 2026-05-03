import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'antidouble-config.json');

const DEFAULT = () => ({
  alertChannelId: null,
  blChannelId:    null,
  bannedRoleId:   null,
  operatorIds:    [],
  operatorRoles:  [],
});

// { guildId: config }
let configs = {};

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = DEFAULT();
  return configs[guildId];
}

function save() {
  try { safeWriteJSON(DATA_FILE, configs); }
  catch (e) { error('[AntidoubleConfig] Erreur sauvegarde:', e); }
}

export function loadAntidoubleConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // migration: si l'ancien format était un objet plat (pas de guildId en clé)
      if (raw && raw.alertChannelId !== undefined) {
        configs = {}; // ancien format, reset
      } else {
        configs = raw ?? {};
        for (const guildId of Object.keys(configs)) {
          const d = DEFAULT();
          const p = configs[guildId];
          configs[guildId] = {
            alertChannelId: p.alertChannelId ?? d.alertChannelId,
            blChannelId:    p.blChannelId    ?? d.blChannelId,
            bannedRoleId:   p.bannedRoleId   ?? d.bannedRoleId,
            operatorIds:    p.operatorIds    ?? d.operatorIds,
            operatorRoles:  p.operatorRoles  ?? d.operatorRoles,
          };
        }
      }
    }
  } catch (e) { error('[AntidoubleConfig] Erreur chargement:', e); }
}

export const getAntidoubleConfig = (guildId) => getConfig(guildId);

export function setAlertChannel(guildId, id)  { getConfig(guildId).alertChannelId = id; save(); }
export function setBlChannel(guildId, id)     { getConfig(guildId).blChannelId = id; save(); }
export function setBannedRole(guildId, id)    { getConfig(guildId).bannedRoleId = id; save(); }

export function addOperator(guildId, userId) {
  const c = getConfig(guildId);
  if (c.operatorIds.includes(userId)) return false;
  c.operatorIds.push(userId); save(); return true;
}

export function removeOperator(guildId, userId) {
  const c = getConfig(guildId);
  const prev = c.operatorIds.length;
  c.operatorIds = c.operatorIds.filter(id => id !== userId);
  if (c.operatorIds.length !== prev) { save(); return true; }
  return false;
}

export function addOperatorRole(guildId, roleId) {
  const c = getConfig(guildId);
  if (c.operatorRoles.includes(roleId)) return false;
  c.operatorRoles.push(roleId); save(); return true;
}

export function removeOperatorRole(guildId, roleId) {
  const c = getConfig(guildId);
  const prev = c.operatorRoles.length;
  c.operatorRoles = c.operatorRoles.filter(id => id !== roleId);
  if (c.operatorRoles.length !== prev) { save(); return true; }
  return false;
}

export function isOperator(guildId, memberOrUserId) {
  const cfg = getConfig(guildId);
  if (!memberOrUserId) return false;

  if (typeof memberOrUserId === 'string') {
    return cfg.operatorIds.includes(memberOrUserId);
  }

  if (memberOrUserId.id && cfg.operatorIds.includes(memberOrUserId.id)) return true;

  if (memberOrUserId.roles?.cache) {
    return cfg.operatorRoles.some(roleId => memberOrUserId.roles.cache.has(roleId));
  }

  return false;
}

loadAntidoubleConfig();
