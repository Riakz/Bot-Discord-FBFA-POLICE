import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { error } from './logger.js';
import { safeWriteJSON } from './safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORMS_FILE     = path.join(__dirname, '..', '..', 'data', 'custom-forms.json');
const COOLDOWNS_FILE = path.join(__dirname, '..', '..', 'data', 'form-cooldowns.json');

let forms     = {};
let cooldowns = {};

export function loadForms() {
  try {
    if (fs.existsSync(FORMS_FILE)) forms = JSON.parse(fs.readFileSync(FORMS_FILE, 'utf8'));
  } catch (e) { error('[Forms] Erreur chargement:', e); forms = {}; }
}

export function saveForms() {
  try { safeWriteJSON(FORMS_FILE, forms); } catch (e) { error('[Forms] Erreur sauvegarde:', e); }
}

export function loadCooldowns() {
  try {
    if (fs.existsSync(COOLDOWNS_FILE)) cooldowns = JSON.parse(fs.readFileSync(COOLDOWNS_FILE, 'utf8'));
  } catch (e) { cooldowns = {}; }
}

export function saveCooldowns() {
  try { safeWriteJSON(COOLDOWNS_FILE, cooldowns); } catch (e) { error('[Forms] Erreur sauvegarde cooldowns:', e); }
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function createForm(guildId, config) {
  const formId = generateId('form');
  forms[formId] = {
    id: formId,
    guildId,
    title:             config.title       || 'Formulaire de candidature',
    openMessage:       config.openMessage || 'Remplissez le formulaire ci-dessous.',
    questions:         [],
    receptionChannelId: null,
    examinerRoleIds:   [],
    cooldownHours:     24,
    checkBlacklist:    true,
    panelMessageId:    null,
    panelChannelId:    null,
    embedColor:        0x3498db,
    createdBy:         config.createdBy,
    createdAt:         Date.now(),
  };
  saveForms();
  return formId;
}

export function getForm(formId) {
  return forms[formId] || null;
}

export function getAllForms(guildId) {
  const result = {};
  for (const [id, form] of Object.entries(forms)) {
    if (form.guildId === guildId) result[id] = form;
  }
  return result;
}

export function updateForm(formId, updates) {
  if (!forms[formId]) throw new Error('Formulaire introuvable');
  Object.assign(forms[formId], updates);
  saveForms();
  return forms[formId];
}

export function deleteForm(formId) {
  if (!forms[formId]) throw new Error('Formulaire introuvable');
  delete forms[formId];
  saveForms();
}

export function addQuestion(formId, question) {
  const form = forms[formId];
  if (!form) throw new Error('Formulaire introuvable');
  if (form.questions.length >= 5) throw new Error('Maximum 5 questions par formulaire');
  form.questions.push({ id: generateId('q'), ...question });
  saveForms();
  return form.questions.length;
}

export function removeQuestion(formId, index) {
  const form = forms[formId];
  if (!form) throw new Error('Formulaire introuvable');
  if (index < 0 || index >= form.questions.length) throw new Error('Index invalide');
  form.questions.splice(index, 1);
  saveForms();
}

export function setCooldown(formId, userId) {
  if (!cooldowns[formId]) cooldowns[formId] = {};
  cooldowns[formId][userId] = Date.now();
  saveCooldowns();
}

export function getCooldownRemaining(formId, userId, cooldownHours) {
  if (!cooldownHours) return 0;
  const last = cooldowns[formId]?.[userId];
  if (!last) return 0;
  const remaining = (cooldownHours * 3600000) - (Date.now() - last);
  return Math.max(0, remaining);
}

loadForms();
loadCooldowns();
