import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'candidature-config.json');

export const DISTRICTS = {
  mission_row:  'Mission Row',
  vespucci:     'Vespucci',
  alta:         'Alta',
  sandy_shores: 'Sandy Shores',
  roxwood:      'Roxwood',
};

export function districtSlugFromLabel(label) {
  return Object.entries(DISTRICTS).find(([, v]) => v === label)?.[0] ?? null;
}

function defaultGuildConfig() {
  const districts = {};
  for (const key of Object.keys(DISTRICTS)) {
    districts[key] = {
      applicationChannelId: null,
      resultChannelId:      null,
      acceptedRoleId:       null,
    };
  }
  return { globalRefusedRoleId: null, reviewerRoleIds: [], districts };
}

let configs = {};

export function loadCandidatureConfigs() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      configs = JSON.parse(raw);
      log(`[Candidature] Config chargée: ${Object.keys(configs).length} guild(s)`);
    } else {
      configs = {};
    }
  } catch (e) {
    error('[Candidature] Erreur de chargement config:', e);
    configs = {};
  }
  return configs;
}

export function saveCandidatureConfigs() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf8');
  } catch (e) {
    error('[Candidature] Erreur de sauvegarde config:', e);
  }
}

export function getCandidatureConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaultGuildConfig();
    saveCandidatureConfigs();
  }
  return configs[guildId];
}

export function setApplicationChannel(guildId, districtKey, channelId) {
  if (!DISTRICTS[districtKey]) throw new Error(`District inconnu: ${districtKey}`);
  const cfg = getCandidatureConfig(guildId);
  cfg.districts[districtKey].applicationChannelId = channelId;
  configs[guildId] = cfg;
  saveCandidatureConfigs();
}

export function setResultChannel(guildId, districtKey, channelId) {
  if (!DISTRICTS[districtKey]) throw new Error(`District inconnu: ${districtKey}`);
  const cfg = getCandidatureConfig(guildId);
  cfg.districts[districtKey].resultChannelId = channelId;
  configs[guildId] = cfg;
  saveCandidatureConfigs();
}

export function setGlobalRefusedRole(guildId, roleId) {
  const cfg = getCandidatureConfig(guildId);
  cfg.globalRefusedRoleId = roleId;
  configs[guildId] = cfg;
  saveCandidatureConfigs();
}

export function setAcceptedRole(guildId, districtKey, roleId) {
  if (!DISTRICTS[districtKey]) throw new Error(`District inconnu: ${districtKey}`);
  const cfg = getCandidatureConfig(guildId);
  cfg.districts[districtKey].acceptedRoleId = roleId;
  configs[guildId] = cfg;
  saveCandidatureConfigs();
}

export function addReviewerRole(guildId, roleId) {
  const cfg = getCandidatureConfig(guildId);
  if (!cfg.reviewerRoleIds) cfg.reviewerRoleIds = [];
  if (!cfg.reviewerRoleIds.includes(roleId)) {
    cfg.reviewerRoleIds.push(roleId);
    configs[guildId] = cfg;
    saveCandidatureConfigs();
    return true;
  }
  return false;
}

export function removeReviewerRole(guildId, roleId) {
  const cfg = getCandidatureConfig(guildId);
  if (!cfg.reviewerRoleIds) cfg.reviewerRoleIds = [];
  const before = cfg.reviewerRoleIds.length;
  cfg.reviewerRoleIds = cfg.reviewerRoleIds.filter(id => id !== roleId);
  if (cfg.reviewerRoleIds.length !== before) {
    configs[guildId] = cfg;
    saveCandidatureConfigs();
    return true;
  }
  return false;
}

loadCandidatureConfigs();
