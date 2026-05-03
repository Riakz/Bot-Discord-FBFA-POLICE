import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'fto-config.json');

const DEFAULT = () => ({
  roleIds:                [],
  logChannelId:           null,
  dmAccept:               '',
  dmRefus:                '',
  pendingDays:            20,
  candReceptionChannelId: null,
  candExaminerRoleIds:    [],
  candCooldownHours:      24,
  candCheckBlacklist:     true,
  candPanelChannelId:     null,
  candPanelMessageId:     null,
});

// { guildId: config }
let configs = {};

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = DEFAULT();
  return configs[guildId];
}

function save() {
  try { safeWriteJSON(DATA_FILE, configs); }
  catch (e) { error('[FTOConfig] Erreur sauvegarde:', e); }
}

export function loadFtoConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // migration: si l'ancien format était un objet plat (pas de guildId en clé)
      if (raw && raw.roleIds !== undefined) {
        // ancien format mono-serveur, on ignore (reset)
        configs = {};
      } else {
        configs = raw ?? {};
        // normaliser chaque entrée
        for (const guildId of Object.keys(configs)) {
          const d = DEFAULT();
          const p = configs[guildId];
          configs[guildId] = {
            roleIds:                p.roleIds                ?? d.roleIds,
            logChannelId:           p.logChannelId           ?? d.logChannelId,
            dmAccept:               p.dmAccept               ?? d.dmAccept,
            dmRefus:                p.dmRefus                ?? d.dmRefus,
            pendingDays:            p.pendingDays             ?? d.pendingDays,
            candReceptionChannelId: p.candReceptionChannelId ?? d.candReceptionChannelId,
            candExaminerRoleIds:    p.candExaminerRoleIds    ?? d.candExaminerRoleIds,
            candCooldownHours:      p.candCooldownHours      ?? d.candCooldownHours,
            candCheckBlacklist:     p.candCheckBlacklist     ?? d.candCheckBlacklist,
            candPanelChannelId:     p.candPanelChannelId     ?? d.candPanelChannelId,
            candPanelMessageId:     p.candPanelMessageId     ?? d.candPanelMessageId,
          };
        }
      }
    }
  } catch (e) { error('[FTOConfig] Erreur chargement:', e); }
}

export const getFtoConfig = (guildId) => getConfig(guildId);

export function addFtoRole(guildId, id) {
  const c = getConfig(guildId);
  if (c.roleIds.includes(id)) return false;
  c.roleIds.push(id); save(); return true;
}
export function removeFtoRole(guildId, id) {
  const c = getConfig(guildId);
  const prev = c.roleIds.length;
  c.roleIds = c.roleIds.filter(r => r !== id);
  if (c.roleIds.length !== prev) { save(); return true; }
  return false;
}
export function setFtoLogChannel(guildId, id)   { getConfig(guildId).logChannelId = id; save(); }
export function setFtoDmAccept(guildId, text)    { getConfig(guildId).dmAccept = text; save(); }
export function setFtoDmRefus(guildId, text)     { getConfig(guildId).dmRefus = text; save(); }
export function setFtoPendingDays(guildId, n)    { getConfig(guildId).pendingDays = n; save(); }

export function setCandReceptionChannel(guildId, id) { getConfig(guildId).candReceptionChannelId = id; save(); }
export function setCandPanelInfo(guildId, channelId, messageId) {
  const c = getConfig(guildId);
  c.candPanelChannelId = channelId;
  c.candPanelMessageId = messageId;
  save();
}
export function addCandExaminerRole(guildId, id) {
  const c = getConfig(guildId);
  if (c.candExaminerRoleIds.includes(id)) return false;
  c.candExaminerRoleIds.push(id); save(); return true;
}
export function removeCandExaminerRole(guildId, id) {
  const c = getConfig(guildId);
  const prev = c.candExaminerRoleIds.length;
  c.candExaminerRoleIds = c.candExaminerRoleIds.filter(r => r !== id);
  if (c.candExaminerRoleIds.length !== prev) { save(); return true; }
  return false;
}
export function setCandCooldown(guildId, h)       { getConfig(guildId).candCooldownHours = h; save(); }
export function toggleCandBlacklist(guildId)      {
  const c = getConfig(guildId);
  c.candCheckBlacklist = !c.candCheckBlacklist;
  save();
  return c.candCheckBlacklist;
}
export function getAllFtoConfigs()                 { return configs; }

loadFtoConfig();
