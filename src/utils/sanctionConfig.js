import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'sanction-config.json');

const DEFAULT = () => ({
  sourceChannelId:  null,
  categoryId:       null,
  staffRoleIds:     [],
  staffUserIds:     [],
  contestationText: '',
  footerText:       '',
});

// { guildId: config }
let configs = {};

function getConfig(guildId) {
  if (!configs[guildId]) configs[guildId] = DEFAULT();
  return configs[guildId];
}

function save() {
  try { safeWriteJSON(DATA_FILE, configs); }
  catch (e) { error('[SanctionConfig] Erreur sauvegarde:', e); }
}

export function loadSanctionConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      configs = raw ?? {};
      for (const guildId of Object.keys(configs)) {
        const d = DEFAULT();
        const p = configs[guildId];
        configs[guildId] = {
          sourceChannelId:  p.sourceChannelId  ?? d.sourceChannelId,
          categoryId:       p.categoryId        ?? d.categoryId,
          staffRoleIds:     p.staffRoleIds      ?? d.staffRoleIds,
          staffUserIds:     p.staffUserIds      ?? d.staffUserIds,
          contestationText: p.contestationText  ?? d.contestationText,
          footerText:       p.footerText        ?? d.footerText,
        };
      }
    }
  } catch (e) { error('[SanctionConfig] Erreur chargement:', e); }
}

export const getSanctionConfig  = (guildId) => getConfig(guildId);
export const getAllSanctionConfigs = ()      => configs;

export function setSourceChannel(guildId, id)      { getConfig(guildId).sourceChannelId = id; save(); }
export function setCategory(guildId, id)           { getConfig(guildId).categoryId = id; save(); }
export function setContestationText(guildId, t)    { getConfig(guildId).contestationText = t; save(); }
export function setFooterText(guildId, t)          { getConfig(guildId).footerText = t; save(); }

export function addStaffRole(guildId, id) {
  const c = getConfig(guildId);
  if (c.staffRoleIds.includes(id)) return false;
  c.staffRoleIds.push(id); save(); return true;
}
export function removeStaffRole(guildId, id) {
  const c = getConfig(guildId);
  const prev = c.staffRoleIds.length;
  c.staffRoleIds = c.staffRoleIds.filter(r => r !== id);
  if (c.staffRoleIds.length !== prev) { save(); return true; }
  return false;
}
export function addStaffUser(guildId, id) {
  const c = getConfig(guildId);
  if (c.staffUserIds.includes(id)) return false;
  c.staffUserIds.push(id); save(); return true;
}
export function removeStaffUser(guildId, id) {
  const c = getConfig(guildId);
  const prev = c.staffUserIds.length;
  c.staffUserIds = c.staffUserIds.filter(u => u !== id);
  if (c.staffUserIds.length !== prev) { save(); return true; }
  return false;
}

loadSanctionConfig();
