import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'entretien-config.json');

let configs = {};

export function loadEntretienConfigs() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      configs = JSON.parse(raw);
      log(`[Entretien] Config chargée: ${Object.keys(configs).length} guild(s)`);
    } else {
      configs = {};
    }
  } catch (e) {
    error('[Entretien] Erreur chargement config:', e);
    configs = {};
  }
  return configs;
}

export function saveEntretienConfigs() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf8');
  } catch (e) {
    error('[Entretien] Erreur sauvegarde config:', e);
  }
}

function defaultGuildConfig() {
  return {
    resultChannelId: null,
    notifChannelId:  null,
    sheetUrl: null,
    rolesPassedByDistrict: {},
    roleFailedId: null,
    reviewerRoleIds: [],
  };
}

export function getEntretienConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaultGuildConfig();
    saveEntretienConfigs();
  }
  return configs[guildId];
}

export function setEntretienResultChannel(guildId, channelId) {
  const cfg = getEntretienConfig(guildId);
  cfg.resultChannelId = channelId;
  configs[guildId] = cfg;
  saveEntretienConfigs();
}

export function setEntretienNotifChannel(guildId, channelId) {
  const cfg = getEntretienConfig(guildId);
  cfg.notifChannelId = channelId;
  configs[guildId] = cfg;
  saveEntretienConfigs();
}

export function setEntretienSheetUrl(guildId, url) {
  const cfg = getEntretienConfig(guildId);
  cfg.sheetUrl = url;
  configs[guildId] = cfg;
  saveEntretienConfigs();
}

export function setEntretienRolePassed(guildId, districtKey, roleId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.rolesPassedByDistrict) cfg.rolesPassedByDistrict = {};
  cfg.rolesPassedByDistrict[districtKey] = roleId;
  configs[guildId] = cfg;
  saveEntretienConfigs();
}

export function setEntretienRoleFailed(guildId, roleId) {
  const cfg = getEntretienConfig(guildId);
  cfg.roleFailedId = roleId;
  configs[guildId] = cfg;
  saveEntretienConfigs();
}

export function addEntretienReviewerRole(guildId, roleId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.reviewerRoleIds) cfg.reviewerRoleIds = [];
  if (!cfg.reviewerRoleIds.includes(roleId)) {
    cfg.reviewerRoleIds.push(roleId);
    configs[guildId] = cfg;
    saveEntretienConfigs();
    return true;
  }
  return false;
}

export function removeEntretienReviewerRole(guildId, roleId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.reviewerRoleIds) cfg.reviewerRoleIds = [];
  const before = cfg.reviewerRoleIds.length;
  cfg.reviewerRoleIds = cfg.reviewerRoleIds.filter(id => id !== roleId);
  if (cfg.reviewerRoleIds.length !== before) {
    configs[guildId] = cfg;
    saveEntretienConfigs();
    return true;
  }
  return false;
}

loadEntretienConfigs();
