import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');

let whitelist = {};

export function loadWhitelist() {
    try {
        if (fs.existsSync(WHITELIST_FILE)) {
            const data = fs.readFileSync(WHITELIST_FILE, 'utf8');
            whitelist = JSON.parse(data);
        }
    } catch (e) {
        console.error('Error loading whitelist:', e);
    }
}

export function saveWhitelist() {
    try {
        fs.writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving whitelist:', e);
    }
}

function ensureGuild(guildId) {
    if (!whitelist[guildId]) {
        whitelist[guildId] = { users: [], roles: [] };
    }
}

export function addToWhitelist(guildId, id, type = 'user') {
    loadWhitelist();
    ensureGuild(guildId);

    if (type === 'user') {
        if (!whitelist[guildId].users.includes(id)) {
            whitelist[guildId].users.push(id);
            saveWhitelist();
            return true;
        }
    } else if (type === 'role') {
        if (!whitelist[guildId].roles.includes(id)) {
            whitelist[guildId].roles.push(id);
            saveWhitelist();
            return true;
        }
    }
    return false;
}

export function removeFromWhitelist(guildId, id) {
    loadWhitelist();
    if (!whitelist[guildId]) return false;

    let changed = false;

    if (whitelist[guildId].users.includes(id)) {
        whitelist[guildId].users = whitelist[guildId].users.filter(u => u !== id);
        changed = true;
    }

    if (whitelist[guildId].roles.includes(id)) {
        whitelist[guildId].roles = whitelist[guildId].roles.filter(r => r !== id);
        changed = true;
    }

    if (changed) saveWhitelist();
    return changed;
}

export function isWhitelisted(guildId, userId, member) {
    if (!guildId) return false;
    const g = whitelist[guildId];
    if (!g) return false;

    if (g.users.includes(userId)) return true;

    if (member && member.roles && member.roles.cache) {
        return member.roles.cache.some(r => g.roles.includes(r.id));
    }

    return false;
}

export function getWhitelist(guildId) {
    loadWhitelist();
    return whitelist[guildId] || { users: [], roles: [] };
}

loadWhitelist();
