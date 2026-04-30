import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_SHEETS_PATH = path.join(__dirname, '../../data/userSheets.json');

const dataDir = path.dirname(USER_SHEETS_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export function loadUserSheets() {
    if (!fs.existsSync(USER_SHEETS_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(USER_SHEETS_PATH, 'utf8'));
    } catch (error) {
        console.error("Error loading user sheets:", error);
        return {};
    }
}

export function saveUserSheets(data) {
    try {
        safeWriteJSON(USER_SHEETS_PATH, data);
    } catch (error) {
        console.error("Error saving user sheets:", error);
    }
}
