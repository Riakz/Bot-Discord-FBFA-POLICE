import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PANELS_FILE = path.join(__dirname, '..', '..', 'data', 'custom-panels.json');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let panels = {};

export function loadPanels() {
    try {
        if (fs.existsSync(PANELS_FILE)) {
            const data = fs.readFileSync(PANELS_FILE, 'utf8');
            panels = JSON.parse(data);
            log(`Custom panels loaded: ${Object.keys(panels).length} panels`);
        } else {
            panels = {};
        }
    } catch (e) {
        error('Error loading panels:', e);
        panels = {};
    }
    return panels;
}

export function savePanels() {
    try {
        fs.writeFileSync(PANELS_FILE, JSON.stringify(panels, null, 2), 'utf8');
    } catch (e) {
        error('Error saving panels:', e);
    }
}

function generatePanelId() {
    return `panel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createPanel(config, guildId) {
    const panelId = generatePanelId();
    panels[panelId] = {
        id: panelId,
        guildId,
        messageId: null,
        channelId: null,
        embedTitle: config.embedTitle || 'Panel de Tickets',
        embedDescription: config.embedDescription || 'Cliquez sur un bouton pour ouvrir un ticket',
        embedColor: config.embedColor || 0x3498db,
        logChannelId: config.logChannelId || null,
        buttons: [],
        createdBy: config.createdBy,
        createdAt: Date.now(),
    };
    savePanels();
    return panelId;
}

export function addButtonToPanel(panelId, buttonConfig) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');
    if (panel.buttons.length >= 25) throw new Error('Maximum 25 buttons per panel');

    const buttonId = `btn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    panel.buttons.push({
        id: buttonId,
        label: buttonConfig.label,
        emoji: buttonConfig.emoji || null,
        style: buttonConfig.style || 'PRIMARY',
        categoryId: buttonConfig.categoryId,
        roleIds: buttonConfig.roleIds || [],
        ticketNamePrefix: buttonConfig.ticketNamePrefix || 'ticket',
        welcomeTitle: buttonConfig.welcomeTitle || `Ticket: ${buttonConfig.label}`,
        welcomeMessage: buttonConfig.welcomeMessage || 'Votre ticket a été créé. L\'équipe vous répondra bientôt.',
    });

    savePanels();
    return buttonId;
}

export function updatePanelMessage(panelId, messageId, channelId) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');
    panel.messageId = messageId;
    panel.channelId = channelId;
    savePanels();
}

export function updatePanelLogChannel(panelId, logChannelId) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');
    panel.logChannelId = logChannelId;
    savePanels();
}

export function getPanel(panelId) {
    return panels[panelId] || null;
}

export function getAllPanels(guildId) {
    if (!guildId) return {};
    const result = {};
    for (const [id, panel] of Object.entries(panels)) {
        if (panel.guildId === guildId) {
            result[id] = panel;
        }
    }
    return result;
}

export function deletePanel(panelId) {
    if (!panels[panelId]) throw new Error('Panel not found');
    delete panels[panelId];
    savePanels();
}

export function findPanelByButtonId(buttonId) {
    for (const panel of Object.values(panels)) {
        const button = panel.buttons.find(b => b.id === buttonId);
        if (button) return { panel, button };
    }
    return null;
}

export function updatePanel(panelId, updates) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');
    Object.assign(panel, updates);
    savePanels();
    return panel;
}

export function updateButton(panelId, buttonId, updates) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');

    const buttonIndex = panel.buttons.findIndex(b => b.id === buttonId);
    if (buttonIndex === -1) throw new Error('Button not found');

    const button = panel.buttons[buttonIndex];
    Object.assign(button, updates);
    savePanels();
    return button;
}

export function removeButton(panelId, buttonId) {
    const panel = panels[panelId];
    if (!panel) throw new Error('Panel not found');

    const buttonIndex = panel.buttons.findIndex(b => b.id === buttonId);
    if (buttonIndex === -1) throw new Error('Button not found');

    panel.buttons.splice(buttonIndex, 1);
    savePanels();
}

export function getButton(panelId, buttonId) {
    const panel = panels[panelId];
    if (!panel) return null;
    return panel.buttons.find(b => b.id === buttonId) || null;
}

loadPanels();
