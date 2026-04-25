import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'planning-pa.json');

let plannings = [];

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
  return plannings;
}

export function savePlannings() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(plannings, null, 2), 'utf8');
  } catch (e) {
    error('[Planning] Erreur sauvegarde plannings:', e);
  }
}

export function getAllPlannings() {
  return plannings;
}

export function addPlanning(data) {
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
