import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error, log } from '../utils/logger.js';
import { getAllEntries } from '../utils/candidatureStore.js';
import {
  getAntidoubleConfig,
  setAlertChannel,
  setBlChannel,
  setBannedRole,
  addOperator,
  removeOperator,
  isOperator,
} from '../utils/antidoubleConfig.js';
import { addBlacklistEntry, isBlacklisted } from '../utils/blacklistManager.js';

function norm(str) {
  if (!str) return '';
  return String(str).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function normPhone(str) {
  if (!str) return '';
  return String(str).replace(/\D/g, '');
}

function getNameParts(str) {
  return norm(str).split(/[\s\-]+/).filter(p => p.length > 1);
}

function namePartsFullMatch(a, b) {
  const pa = new Set(getNameParts(a));
  const pb = new Set(getNameParts(b));
  if (pa.size < 2 || pb.size < 2) return false;
  return [...pa].every(p => pb.has(p)) && [...pb].every(p => pa.has(p));
}

function parseDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m - 1, d);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function parseDuration(str) {
  const s = norm(str);
  if (['permanent', 'perm', 'definitif', 'indef'].includes(s)) return null;
  const match = s.match(/^(\d+)\s*(h|j|m|an)s?$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const D = 86400000;
  switch (match[2]) {
    case 'h':  return num * 3600000;
    case 'j':  return num * D;
    case 'm':  return num * 30 * D;
    case 'an': return num * 365 * D;
    default:   return null;
  }
}

const CHECKS = [
  // ── Définitif (100) ──────────────────────────────────────────
  {
    key:   'uniqueId',
    label: '🆔 ID Unique identique',
    score: 100,
    match: (a, b) => a.uniqueId && b.uniqueId && norm(a.uniqueId) === norm(b.uniqueId),
  },
  {
    key:   'userId',
    label: '🎮 Même compte Discord',
    score: 100,
    match: (a, b) => a.userId && b.userId && a.userId === b.userId,
  },

  // ── Très fort (80-90) ─────────────────────────────────────────
  {
    key:   'uniqueId_similar',
    label: '🆔 ID Unique similaire (1 caractère d\'écart)',
    score: 85,
    match: (a, b) => {
      if (!a.uniqueId || !b.uniqueId) return false;
      const ua = norm(a.uniqueId), ub = norm(b.uniqueId);
      if (ua === ub) return false;
      return ua.length >= 3 && levenshtein(ua, ub) === 1;
    },
  },
  {
    key:   'username',
    label: '👤 Même pseudo Discord',
    score: 80,
    match: (a, b) => a.username && b.username && norm(a.username) === norm(b.username),
  },

  // ── Fort (60-75) ──────────────────────────────────────────────
  {
    key:   'phone',
    label: '📞 Même numéro de téléphone',
    score: 70,
    match: (a, b) => {
      if (!a.phone || !b.phone) return false;
      const pa = normPhone(a.phone), pb = normPhone(b.phone);
      if (pa.length >= 4 && pa === pb) return true;
      return norm(a.phone) === norm(b.phone);
    },
  },
  {
    key:   'name_exact',
    label: '📛 Même nom de personnage',
    score: 70,
    match: (a, b) => a.name && b.name && norm(a.name) === norm(b.name),
  },
  {
    key:   'name_parts',
    label: '📛 Mêmes parties de nom (ordre différent)',
    score: 60,
    match: (a, b) => {
      if (!a.name || !b.name) return false;
      if (norm(a.name) === norm(b.name)) return false;
      return namePartsFullMatch(a.name, b.name);
    },
  },

  // ── Modéré (40-55) ─────────────────────────────────────────────
  {
    key:   'birthdate_exact',
    label: '🎂 Même date de naissance',
    score: 50,
    match: (a, b) => a.birthdate && b.birthdate && norm(a.birthdate) === norm(b.birthdate),
  },
  {
    key:   'name_similar',
    label: '📛 Nom de personnage similaire (±2 caractères)',
    score: 35,
    match: (a, b) => {
      if (!a.name || !b.name) return false;
      const na = norm(a.name), nb = norm(b.name);
      if (na === nb) return false;
      if (namePartsFullMatch(a.name, b.name)) return false;
      return levenshtein(na, nb) <= 2;
    },
  },

  // ── Faible / indicatif (15-25) ────────────────────────────────
  {
    key:   'birthdate_close',
    label: '🎂 Date de naissance proche (±1 an)',
    score: 25,
    match: (a, b) => {
      if (!a.birthdate || !b.birthdate) return false;
      const da = parseDate(a.birthdate), db = parseDate(b.birthdate);
      if (!da || !db || da.getTime() === db.getTime()) return false;
      return Math.abs(da - db) <= 365 * 86400000;
    },
  },
];

const COMBINED_BONUSES = [
  {
    label: '⚡ Bonus : nom similaire + même date de naissance',
    bonus: 30,
    condition: (keys) => keys.some(k => ['name_exact','name_parts','name_similar'].includes(k))
                      && keys.some(k => ['birthdate_exact','birthdate_close'].includes(k)),
  },
  {
    label: '⚡ Bonus : nom similaire + même téléphone',
    bonus: 20,
    condition: (keys) => keys.some(k => ['name_exact','name_parts','name_similar'].includes(k))
                      && keys.includes('phone'),
  },
  {
    label: '⚡ Bonus : même téléphone + même date de naissance',
    bonus: 25,
    condition: (keys) => keys.includes('phone')
                      && keys.some(k => ['birthdate_exact','birthdate_close'].includes(k)),
  },
];

const LEVELS = [
  { min: 100, label: '🔴 Critique',     color: 0xe74c3c },
  { min:  70, label: '🟠 Suspect',      color: 0xe67e22 },
  { min:  40, label: '🟡 À surveiller', color: 0xf1c40f },
];

function getLevel(score) {
  return LEVELS.find(l => score >= l.min) ?? null;
}

function isAccountNew(entry) {
  if (!entry.accountCreatedAt || !entry.submittedAt) return false;
  return (entry.submittedAt - entry.accountCreatedAt) < 30 * 24 * 60 * 60 * 1000;
}

export function detectDoubles(newEntry) {
  const all = getAllEntries();
  const results = [];

  for (const existing of all) {
    if (existing.msgId === newEntry.msgId) continue;

    const matched = CHECKS.filter(c => c.match(newEntry, existing));
    if (!matched.length) continue;

    const keys = matched.map(c => c.key);
    const baseScore = matched.reduce((s, c) => s + c.score, 0);

    const bonuses = COMBINED_BONUSES.filter(b => b.condition(keys));
    const bonusScore = bonuses.reduce((s, b) => s + b.bonus, 0);
    const totalScore = baseScore + bonusScore;

    const level = getLevel(totalScore);
    if (!level) continue;

    results.push({ existing, matched, bonuses, totalScore, level });
  }

  return results.sort((a, b) => b.totalScore - a.totalScore);
}

export async function sendDoubleAlerts(client, newEntry) {
  const matches = detectDoubles(newEntry);
  if (!matches.length) return;

  const cfg = getAntidoubleConfig();
  if (!cfg.alertChannelId) return;

  let alertCh;
  try {
    alertCh = await client.channels.fetch(cfg.alertChannelId);
    if (!alertCh?.isTextBased()) return;
  } catch (e) {
    error('[Antidouble] Impossible d\'accéder au salon d\'alerte:', e);
    return;
  }

  for (const { existing, matched, bonuses, totalScore, level } of matches) {
    const isBypass   = isBlacklisted(existing.userId);
    const isNewAcct  = isAccountNew(newEntry);

    const criteriaList = matched.map(c => `• ${c.label} \`+${c.score}\``).join('\n');
    const bonusList    = bonuses.length ? '\n' + bonuses.map(b => `• ${b.label} \`+${b.bonus}\``).join('\n') : '';

    const flags = [];
    if (isBypass)  flags.push('🚨 **CONTOURNEMENT DE BLACKLIST** — le compte existant est blacklisté');
    if (isNewAcct) flags.push('🆕 **COMPTE RÉCENT** — Discord créé il y a moins de 30 jours');

    const accountAge = newEntry.accountCreatedAt
      ? `<t:${Math.floor(newEntry.accountCreatedAt / 1000)}:R>`
      : '—';

    const existingDate = existing.submittedAt
      ? `<t:${Math.floor(existing.submittedAt / 1000)}:d>`
      : '—';

    const embed = new EmbedBuilder()
      .setTitle(isBypass
        ? '🚨 Contournement de Blacklist Détecté'
        : `${level.label} — Double Compte Potentiel`)
      .setColor(isBypass ? 0x8b0000 : level.color)
      .setDescription(
        (flags.length ? flags.join('\n') + '\n\n' : '') +
        `**Score de similarité : ${totalScore} pts**\n\n` +
        `**Critères déclencheurs :**\n${criteriaList}${bonusList}`
      )
      .addFields(
        {
          name:  '🆕 Candidature actuelle',
          value: `<@${newEntry.userId}> (\`${newEntry.userId}\`)\n` +
                 `District: \`${newEntry.districtKey}\`\n` +
                 `ID Unique: \`${newEntry.uniqueId || '—'}\`\n` +
                 `Nom: \`${newEntry.name || '—'}\`\n` +
                 `Né le: \`${newEntry.birthdate || '—'}\`\n` +
                 `Tél: \`${newEntry.phone || '—'}\`\n` +
                 `Compte Discord créé: ${accountAge}`,
          inline: true,
        },
        {
          name:  '📂 Candidature existante',
          value: `<@${existing.userId}> (\`${existing.userId}\`)\n` +
                 `District: \`${existing.districtKey}\`\n` +
                 `ID Unique: \`${existing.uniqueId || '—'}\`\n` +
                 `Nom: \`${existing.name || '—'}\`\n` +
                 `Né le: \`${existing.birthdate || '—'}\`\n` +
                 `Tél: \`${existing.phone || '—'}\`\n` +
                 `Candidature du: ${existingDate}`,
          inline: true,
        },
      )
      .setFooter({ text: 'FlashBack FA • Anti-Double Compte' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`antidbl_ok:${newEntry.userId}`)
        .setLabel('Confirmer la candidature')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`antidbl_bl:${newEntry.userId}`)
        .setLabel('Blacklister')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
    );

    try {
      await alertCh.send({ embeds: [embed], components: [row] });
    } catch (e) {
      error('[Antidouble] Erreur envoi alerte:', e);
    }
  }
}

export async function handleAntidoubleButton(interaction) {
  if (!isOperator(interaction.user.id) && !isAdmin(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Vous n\'êtes pas autorisé à interagir avec les alertes anti-double.',
      ephemeral: true,
    });
  }

  const [action, targetUserId] = interaction.customId.split(':');

  if (action === 'antidbl_ok') {
    const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
    disabledRow.components.forEach(b => b.setDisabled(true));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x2ecc71)
      .setFooter({ text: `✅ Candidature confirmée par ${interaction.user.displayName} • FlashBack FA` });

    await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });
    return;
  }

  if (action === 'antidbl_bl') {
    const modal = new ModalBuilder()
      .setCustomId(`modal_antidbl_bl:${targetUserId}`)
      .setTitle('Blacklister l\'utilisateur');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('bl_duration')
          .setLabel('Durée (7j, 30j, 6m, 1an, permanent)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 30j  |  permanent')
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('bl_reason')
          .setLabel('Raison')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Double compte suspecté — ...')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(500)
      ),
    );

    return interaction.showModal(modal);
  }
}

export async function handleAntidoubleModal(interaction) {
  if (!isOperator(interaction.user.id) && !isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Non autorisé.', ephemeral: true });
  }

  const targetUserId = interaction.customId.split(':')[1];
  const rawDuration  = interaction.fields.getTextInputValue('bl_duration').trim();
  const reason       = interaction.fields.getTextInputValue('bl_reason').trim();

  await interaction.deferUpdate();

  const durationMs = parseDuration(rawDuration);
  const expiresAt  = durationMs ? Date.now() + durationMs : null;
  const durationLabel = expiresAt
    ? `<t:${Math.floor(expiresAt / 1000)}:F>`
    : '**Permanent**';

  addBlacklistEntry({
    id:        targetUserId,
    motif:     reason,
    addedBy:   interaction.user.id,
    addedAt:   Date.now(),
    expiresAt,
    source:    'antidouble',
  });

  let banCount = 0;
  for (const [, guild] of interaction.client.guilds.cache) {
    try {
      const g = await interaction.client.guilds.fetch(guild.id);
      await g.members.ban(targetUserId, { reason, deleteMessageSeconds: 0 }).catch(async () => {
        await g.bans.create(targetUserId, { reason });
      });
      banCount++;
    } catch { }
  }

  log(`[Antidouble] Blacklist: ${targetUserId} — ${rawDuration} — ${reason}`);

  const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
  disabledRow.components.forEach(b => b.setDisabled(true));

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xe74c3c)
    .setFooter({ text: `⛔ Blacklisté par ${interaction.user.displayName} • FlashBack FA` });

  await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});

  const cfg = getAntidoubleConfig();
  if (cfg.blChannelId) {
    try {
      const blCh = await interaction.client.channels.fetch(cfg.blChannelId);
      const blEmbed = new EmbedBuilder()
        .setTitle('⛔ Blacklist — Anti-Double Compte')
        .setColor(0xe74c3c)
        .addFields(
          { name: 'Utilisateur',  value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: true },
          { name: 'Ajouté par',   value: `<@${interaction.user.id}>`,                inline: true },
          { name: 'Durée',        value: durationLabel,                               inline: true },
          { name: 'Raison',       value: reason,                                      inline: false },
          { name: 'Bans appliqués', value: `${banCount} serveur(s)`,                 inline: true },
        )
        .setTimestamp();
      await blCh.send({ embeds: [blEmbed] });
    } catch (e) {
      error('[Antidouble] Erreur envoi log BL:', e);
    }
  }
}

export async function handleAntidouble(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup();
  const sub   = interaction.options.getSubcommand();

  if (group === 'config') {
    if (sub === 'set-alert-channel') {
      const id = interaction.options.getString('channel-id', true).trim();
      setAlertChannel(id);
      return interaction.reply({ content: `✅ Salon d'alertes défini : <#${id}>`, ephemeral: true });
    }
    if (sub === 'set-bl-channel') {
      const id = interaction.options.getString('channel-id', true).trim();
      setBlChannel(id);
      return interaction.reply({ content: `✅ Salon de logs BL défini : <#${id}>`, ephemeral: true });
    }
    if (sub === 'set-banned-role') {
      const role = interaction.options.getRole('role');
      setBannedRole(role?.id ?? null);
      return interaction.reply({
        content: role
          ? `✅ Rôle banni défini : <@&${role.id}> — les membres avec ce rôle ne peuvent plus postuler.`
          : `✅ Rôle banni supprimé.`,
        ephemeral: true,
      });
    }
    if (sub === 'show') {
      const cfg = getAntidoubleConfig();
      const ops = cfg.operatorIds.length > 0
        ? cfg.operatorIds.map(id => `<@${id}>`).join(', ')
        : '_Aucun opérateur configuré_';
      const embed = new EmbedBuilder()
        .setTitle('🔍 Configuration Anti-Double Compte')
        .setColor(0x9b59b6)
        .addFields(
          { name: '📢 Salon alertes',   value: cfg.alertChannelId ? `<#${cfg.alertChannelId}>` : '❌ Non défini', inline: true },
          { name: '📋 Salon logs BL',   value: cfg.blChannelId    ? `<#${cfg.blChannelId}>`    : '❌ Non défini', inline: true },
          { name: '🚫 Rôle banni',      value: cfg.bannedRoleId   ? `<@&${cfg.bannedRoleId}>`  : '❌ Non défini', inline: true },
          { name: '👮 Opérateurs',      value: ops,                                                               inline: false },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  if (group === 'allow') {
    if (sub === 'add') {
      const user  = interaction.options.getUser('user', true);
      const added = addOperator(user.id);
      return interaction.reply({
        content: added
          ? `✅ <@${user.id}> peut désormais gérer les alertes anti-double.`
          : `⚠️ <@${user.id}> est déjà opérateur.`,
        ephemeral: true,
      });
    }
    if (sub === 'remove') {
      const user    = interaction.options.getUser('user', true);
      const removed = removeOperator(user.id);
      return interaction.reply({
        content: removed
          ? `✅ <@${user.id}> retiré de la liste des opérateurs.`
          : `⚠️ <@${user.id}> n'est pas dans la liste.`,
        ephemeral: true,
      });
    }
    if (sub === 'list') {
      const cfg = getAntidoubleConfig();
      const ops = cfg.operatorIds.length > 0
        ? cfg.operatorIds.map(id => `<@${id}> (\`${id}\`)`).join('\n')
        : '_Aucun opérateur configuré_';
      const embed = new EmbedBuilder()
        .setTitle('👮 Opérateurs Anti-Double')
        .setColor(0x9b59b6)
        .setDescription(ops)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}
