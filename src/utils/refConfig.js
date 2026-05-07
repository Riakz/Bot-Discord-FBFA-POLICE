import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'ref-config.json');

const DEFAULT = () => ({
  roleIds:         [],
  allowedUserIds:  [],
  allowedRoleIds:  [],
});

let configs = {};

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = DEFAULT();
  return configs[guildId];
}

function save() {
  try { safeWriteJSON(DATA_FILE, configs); }
  catch (e) { error('[RefConfig] Erreur sauvegarde:', e); }
}

export function loadRefConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      configs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) ?? {};
    }
  } catch (e) { error('[RefConfig] Erreur chargement:', e); }
}

export const getRefConfig    = (guildId) => getConfig(guildId);
export const getAllRefConfigs = ()        => configs;

export function addRefRole(guildId, roleId) {
  const c = getConfig(guildId);
  if (c.roleIds.includes(roleId)) return false;
  c.roleIds.push(roleId); save(); return true;
}
export function removeRefRole(guildId, roleId) {
  const c = getConfig(guildId);
  const prev = c.roleIds.length;
  c.roleIds = c.roleIds.filter(r => r !== roleId);
  if (c.roleIds.length !== prev) { save(); return true; }
  return false;
}

export function addRefAllowedUser(guildId, userId) {
  const c = getConfig(guildId);
  if (c.allowedUserIds.includes(userId)) return false;
  c.allowedUserIds.push(userId); save(); return true;
}
export function removeRefAllowedUser(guildId, userId) {
  const c = getConfig(guildId);
  const prev = c.allowedUserIds.length;
  c.allowedUserIds = c.allowedUserIds.filter(u => u !== userId);
  if (c.allowedUserIds.length !== prev) { save(); return true; }
  return false;
}

export function addRefAllowedRole(guildId, roleId) {
  const c = getConfig(guildId);
  if (c.allowedRoleIds.includes(roleId)) return false;
  c.allowedRoleIds.push(roleId); save(); return true;
}
export function removeRefAllowedRole(guildId, roleId) {
  const c = getConfig(guildId);
  const prev = c.allowedRoleIds.length;
  c.allowedRoleIds = c.allowedRoleIds.filter(r => r !== roleId);
  if (c.allowedRoleIds.length !== prev) { save(); return true; }
  return false;
}

loadRefConfig();
