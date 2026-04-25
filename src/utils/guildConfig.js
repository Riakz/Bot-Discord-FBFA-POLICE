import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GUILD_CONFIG_FILE = path.join(__dirname, '..', 'data', 'guild-configs.json');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let guildConfigs = {};

export function loadGuildConfigs() {
    try {
        if (fs.existsSync(GUILD_CONFIG_FILE)) {
            const data = fs.readFileSync(GUILD_CONFIG_FILE, 'utf8');
            guildConfigs = JSON.parse(data);
            log(`Guild configs loaded: ${Object.keys(guildConfigs).length} guilds`);
        } else {
            guildConfigs = {};
        }
    } catch (e) {
        error('Error loading guild configs:', e);
        guildConfigs = {};
    }
    return guildConfigs;
}

export function saveGuildConfigs() {
    try {
        fs.writeFileSync(GUILD_CONFIG_FILE, JSON.stringify(guildConfigs, null, 2), 'utf8');
    } catch (e) {
        error('Error saving guild configs:', e);
    }
}

export function getGuildConfig(guildId) {
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = {
            staffRoleId: null,
            ticketCategoryId: null,
            logs: {
                ticketLogs: null,
                policeLogs: null,
                auditLogs: null,
                securityLogs: null
            }
        };
        saveGuildConfigs();
    }
    return guildConfigs[guildId];
}

export function updateGuildConfig(guildId, updates) {
    const config = getGuildConfig(guildId);

    if (updates.logs) {
        config.logs = { ...config.logs, ...updates.logs };
        delete updates.logs;
    }

    Object.assign(config, updates);

    guildConfigs[guildId] = config;
    saveGuildConfigs();
    return config;
}

loadGuildConfigs();
