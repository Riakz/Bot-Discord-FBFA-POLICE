import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'entretien-config.json');

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
    webhookInputChannelId:       null,
    receptionChannelsByDistrict: {},
    notifChannelId:              null,
    sheetUrl:                    null,
    rolesPassedByDistrict:       {},
    roleFailedId:                null,
    reviewerRoleIds:             [],
  };
}

export function getEntretienConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaultGuildConfig();
    saveEntretienConfigs();
  }
  // migration: ancien champ resultChannelId → on ignore, l'admin reconfigure
  return configs[guildId];
}

export function setEntretienReceptionChannel(guildId, districtKey, channelId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.receptionChannelsByDistrict) cfg.receptionChannelsByDistrict = {};
  cfg.receptionChannelsByDistrict[districtKey] = channelId;
  saveEntretienConfigs();
}

export function clearEntretienReceptionChannel(guildId, districtKey) {
  const cfg = getEntretienConfig(guildId);
  if (cfg.receptionChannelsByDistrict) {
    delete cfg.receptionChannelsByDistrict[districtKey];
    saveEntretienConfigs();
  }
}

export function setEntretienNotifChannel(guildId, channelId) {
  const cfg = getEntretienConfig(guildId);
  cfg.notifChannelId = channelId;
  saveEntretienConfigs();
}

export function setEntretienSecretKey(guildId, key) {
  const cfg = getEntretienConfig(guildId);
  cfg.secretKey = key || null;
  saveEntretienConfigs();
}

export function setEntretienWebhookChannel(guildId, channelId) {
  const cfg = getEntretienConfig(guildId);
  cfg.webhookInputChannelId = channelId || null;
  saveEntretienConfigs();
}

export function setEntretienSheetUrl(guildId, url) {
  const cfg = getEntretienConfig(guildId);
  cfg.sheetUrl = url;
  saveEntretienConfigs();
}

export function setEntretienRolePassed(guildId, districtKey, roleId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.rolesPassedByDistrict) cfg.rolesPassedByDistrict = {};
  cfg.rolesPassedByDistrict[districtKey] = roleId;
  saveEntretienConfigs();
}

export function setEntretienRoleFailed(guildId, roleId) {
  const cfg = getEntretienConfig(guildId);
  cfg.roleFailedId = roleId;
  saveEntretienConfigs();
}

export function addEntretienReviewerRole(guildId, roleId) {
  const cfg = getEntretienConfig(guildId);
  if (!cfg.reviewerRoleIds) cfg.reviewerRoleIds = [];
  if (!cfg.reviewerRoleIds.includes(roleId)) {
    cfg.reviewerRoleIds.push(roleId);
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
    saveEntretienConfigs();
    return true;
  }
  return false;
}

loadEntretienConfigs();
