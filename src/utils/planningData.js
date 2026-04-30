import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'planning-pa.json');

let plannings = [];

function getWeekStart() {
  const now = new Date();
  let dow = now.getDay();
  if (dow === 0) dow = 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function parseDateStr(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function cleanOldPlannings() {
  const weekStart = getWeekStart();
  const before = plannings.length;
  plannings = plannings.filter(p => {
    try { return parseDateStr(p.dateStr) >= weekStart; } catch { return false; }
  });
  if (plannings.length !== before) savePlannings();
}

export function loadPlannings() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      plannings = JSON.parse(raw);
    } else {
      plannings = [];
    }
  } catch (e) {
    error('[Planning] Erreur chargement plannings:', e);
    plannings = [];
  }
  cleanOldPlannings();
  return plannings;
}

export function savePlannings() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteJSON(DATA_FILE, plannings);
  } catch (e) {
    error('[Planning] Erreur sauvegarde plannings:', e);
  }
}

export function getAllPlannings() {
  return plannings;
}

export function addPlanning(data) {
  cleanOldPlannings();
  plannings.push(data);
  savePlannings();
}

export function removePlanning(id) {
  const initialLength = plannings.length;
  plannings = plannings.filter(p => p.id !== id);
  if (plannings.length !== initialLength) {
    savePlannings();
    return true;
  }
  return false;
}

loadPlannings();
