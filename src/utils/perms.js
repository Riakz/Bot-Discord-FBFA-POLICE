import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '..', '..', 'data');
const adminsPath = join(dataDir, 'admins.json');

let admins = new Set();

export function registerPermsStore() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(adminsPath)) {
    writeFileSync(adminsPath, JSON.stringify({ admins: [] }, null, 2), 'utf-8');
  }
  try {
    const raw = readFileSync(adminsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    admins = new Set((parsed.admins || []).map(String));
    console.log(`[BOT] Admins chargés : ${admins.size} (${Array.from(admins).join(', ')})`);
    console.log(`[BOT] Chemin admins : ${adminsPath}`);
  } catch (e) {
    console.error(`[BOT][ERROR] Erreur chargement admins : ${e.message}`);
    admins = new Set();
  }
}

export function saveAdmins() {
  const tmp = adminsPath + '.tmp';
  writeFileSync(tmp, JSON.stringify({ admins: Array.from(admins) }, null, 2), 'utf-8');
  renameSync(tmp, adminsPath);
}

export function isAdmin(userId) {
  return admins.has(userId);
}

export function addAdmin(userId) {
  admins.add(userId);
  saveAdmins();
}

export function removeAdmin(userId) {
  admins.delete(userId);
  saveAdmins();
}

export function getAdmins() {
  return Array.from(admins);
}
