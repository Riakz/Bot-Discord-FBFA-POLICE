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
  addOperatorRole,
  removeOperatorRole,
  isOperator,
} from '../utils/antidoubleConfig.js';
import { addBlacklistEntry, isBlacklisted, removeBlacklistEntry, getBlacklist } from '../utils/blacklistManager.js';

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
    if (existing.userId === newEntry.userId) continue;

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

  const cfg = getAntidoubleConfig(newEntry.guildId);
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
    const isBypass   = isBlacklisted(newEntry.guildId, existing.userId);
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
        .setCustomId(`antidbl_bl:${newEntry.userId}:${existing.userId}`)
        .setLabel('Blacklister')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`antidbl_ban:${newEntry.userId}:${existing.userId}`)
        .setLabel('Blacklister & Bannir')
        .setEmoji('🔨')
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
  if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Vous n\'êtes pas autorisé à interagir avec les alertes anti-double.',
      ephemeral: true,
    });
  }

  const parts = interaction.customId.split(':');
  const action        = parts[0];
  const targetUserId  = parts[1];
  const existingUserId = parts[2] || null;

  if (action === 'antidbl_ok') {
    const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
    disabledRow.components.forEach(b => b.setDisabled(true));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x2ecc71)
      .setFooter({ text: `✅ Candidature confirmée par ${interaction.user.displayName} • FlashBack FA` });

    const revertRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`antidbl_revert:${targetUserId}`)
        .setLabel('Revenir')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [updatedEmbed], components: [disabledRow, revertRow] });
    return;
  }

  if (action === 'antidbl_bl' || action === 'antidbl_ban') {
    const modal = new ModalBuilder()
      .setCustomId(`modal_${action}:${targetUserId}:${existingUserId || ''}`)
      .setTitle(action === 'antidbl_ban' ? 'Blacklister & Bannir' : 'Blacklister l\'utilisateur');

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

  if (action === 'antidbl_revert') {
    const logMsgId   = parts[2] || null;
    const logChId    = parts[3] || null;

    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xf1c40f)
      .setFooter({ text: 'FlashBack FA • Anti-Double Compte' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`antidbl_ok:${targetUserId}`)
        .setLabel('Confirmer la candidature')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`antidbl_bl:${targetUserId}`)
        .setLabel('Blacklister')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`antidbl_ban:${targetUserId}`)
        .setLabel('Blacklister & Bannir')
        .setEmoji('🔨')
        .setStyle(ButtonStyle.Danger),
    );

    removeBlacklistEntry(interaction.guild.id, targetUserId);

    for (const [, guild] of interaction.client.guilds.cache) {
      try {
        const g = await interaction.client.guilds.fetch(guild.id);
        await g.members.unban(targetUserId, 'Annulation de la décision (Antidouble)');
      } catch { }
    }

    if (logMsgId && logChId) {
      try {
        const logCh = await interaction.client.channels.fetch(logChId);
        const logMsg = await logCh.messages.fetch(logMsgId);
        await logMsg.delete();
      } catch { }
    }

    await interaction.update({ embeds: [originalEmbed], components: [row] });
    return;
  }
}

export async function handleAntidoubleModal(interaction) {
  if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Non autorisé.', ephemeral: true });
  }

  const parts2       = interaction.customId.split(':');
  const modalAction  = parts2[0];
  const targetUserId = parts2[1];
  const existingUserId = parts2[2] || null;
  const doBan = modalAction === 'modal_antidbl_ban';
  const rawDuration  = interaction.fields.getTextInputValue('bl_duration').trim();
  const reason       = interaction.fields.getTextInputValue('bl_reason').trim();

  await interaction.deferUpdate();

  const durationMs = parseDuration(rawDuration);
  const expiresAt  = durationMs ? Date.now() + durationMs : null;
  const durationLabel = expiresAt
    ? `<t:${Math.floor(expiresAt / 1000)}:F>`
    : '**Permanent**';

  const allTargets = [targetUserId, existingUserId].filter(Boolean);

  // Blacklister les deux comptes
  for (const uid of allTargets) {
    addBlacklistEntry(interaction.guild.id, {
      id:        uid,
      motif:     reason,
      addedBy:   interaction.user.id,
      addedAt:   Date.now(),
      expiresAt,
      source:    'antidouble',
      rawDuration,
      banned:    doBan,
    });
  }

  // Assigner le bannedRoleId aux deux comptes + bannir si demandé
  const cfg2 = getAntidoubleConfig(interaction.guild.id);
  let banCount = 0;
  for (const uid of allTargets) {
    if (cfg2.bannedRoleId) {
      try {
        const m = await interaction.guild.members.fetch(uid).catch(() => null);
        if (m) await m.roles.add(cfg2.bannedRoleId).catch(() => {});
      } catch { }
    }
    if (doBan) {
      for (const [, guild] of interaction.client.guilds.cache) {
        try {
          const g = await interaction.client.guilds.fetch(guild.id);
          await g.members.ban(uid, { reason, deleteMessageSeconds: 0 }).catch(async () => {
            await g.bans.create(uid, { reason });
          });
          banCount++;
        } catch { }
      }
    }
  }

  log(`[Antidouble] Blacklist: ${allTargets.join(', ')} — ${rawDuration} — ${reason}`);

  const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
  disabledRow.components.forEach(b => b.setDisabled(true));

  const footerText = doBan 
    ? `⛔ Blacklisté et banni par ${interaction.user.displayName} • FlashBack FA`
    : `⛔ Blacklisté par ${interaction.user.displayName} • FlashBack FA`;

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xe74c3c)
    .setFooter({ text: footerText });

  let logMsgId = '';
  let logChId  = '';
  if (cfg2.blChannelId) {
    try {
      const blCh = await interaction.client.channels.fetch(cfg2.blChannelId);
      const usersValue = allTargets.map(uid => `<@${uid}> (\`${uid}\`)`).join('\n');
      const blEmbed = new EmbedBuilder()
        .setTitle('⛔ Blacklist — Anti-Double Compte')
        .setColor(0xe74c3c)
        .addFields(
          { name: 'Comptes visés', value: usersValue,                                  inline: false },
          { name: 'Ajouté par',    value: `<@${interaction.user.id}>`,                 inline: true },
          { name: 'Durée',         value: durationLabel,                               inline: true },
          { name: 'Raison',        value: reason,                                      inline: false },
          { name: 'Bans appliqués', value: `${banCount} serveur(s)`,                  inline: true },
        )
        .setTimestamp();
      const sentLog = await blCh.send({ embeds: [blEmbed] });
      logMsgId = sentLog.id;
      logChId  = blCh.id;
    } catch (e) {
      error('[Antidouble] Erreur envoi log BL:', e);
    }
  }

  const revertRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`antidbl_revert:${targetUserId}:${logMsgId}:${logChId}`)
      .setLabel('Revenir')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow, revertRow] }).catch(() => {});
}

export async function handleAntidouble(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const group   = interaction.options.getSubcommandGroup();
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (group === 'config') {
    if (sub === 'set-alert-channel') {
      const id = interaction.options.getString('channel-id', true).trim();
      setAlertChannel(guildId, id);
      return interaction.reply({ content: `✅ Salon d'alertes défini : <#${id}>`, ephemeral: true });
    }
    if (sub === 'set-bl-channel') {
      const id = interaction.options.getString('channel-id', true).trim();
      setBlChannel(guildId, id);
      return interaction.reply({ content: `✅ Salon de logs BL défini : <#${id}>`, ephemeral: true });
    }
    if (sub === 'set-banned-role') {
      const role = interaction.options.getRole('role');
      setBannedRole(guildId, role?.id ?? null);
      return interaction.reply({
        content: role
          ? `✅ Rôle banni défini : <@&${role.id}> — les membres avec ce rôle ne peuvent plus postuler.`
          : `✅ Rôle banni supprimé.`,
        ephemeral: true,
      });
    }
    if (sub === 'show') {
      const cfg = getAntidoubleConfig(guildId);
      const ops = cfg.operatorIds.length > 0
        ? cfg.operatorIds.map(id => `<@${id}>`).join(', ')
        : '_Aucun opérateur configuré_';
      const opsRoles = (cfg.operatorRoles && cfg.operatorRoles.length > 0)
        ? cfg.operatorRoles.map(id => `<@&${id}>`).join(', ')
        : '_Aucun rôle opérateur configuré_';
      const embed = new EmbedBuilder()
        .setTitle('🔍 Configuration Anti-Double Compte')
        .setColor(0x9b59b6)
        .addFields(
          { name: '📢 Salon alertes',   value: cfg.alertChannelId ? `<#${cfg.alertChannelId}>` : '❌ Non défini', inline: true },
          { name: '📋 Salon logs BL',   value: cfg.blChannelId    ? `<#${cfg.blChannelId}>`    : '❌ Non défini', inline: true },
          { name: '🚫 Rôle banni',      value: cfg.bannedRoleId   ? `<@&${cfg.bannedRoleId}>`  : '❌ Non défini', inline: true },
          { name: '👮 Opérateurs',      value: ops,                                                               inline: false },
          { name: '🛡️ Rôles Opérateurs', value: opsRoles,                                                          inline: false },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  if (group === 'allow') {
    if (sub === 'add') {
      const user  = interaction.options.getUser('user', true);
      const added = addOperator(guildId, user.id);
      return interaction.reply({
        content: added
          ? `✅ <@${user.id}> peut désormais gérer les alertes anti-double.`
          : `⚠️ <@${user.id}> est déjà opérateur.`,
        ephemeral: true,
      });
    }
    if (sub === 'remove') {
      const user    = interaction.options.getUser('user', true);
      const removed = removeOperator(guildId, user.id);
      return interaction.reply({
        content: removed
          ? `✅ <@${user.id}> retiré de la liste des opérateurs.`
          : `⚠️ <@${user.id}> n'est pas dans la liste.`,
        ephemeral: true,
      });
    }
    if (sub === 'add-role') {
      const role  = interaction.options.getRole('role', true);
      const added = addOperatorRole(guildId, role.id);
      return interaction.reply({
        content: added
          ? `✅ Le rôle <@&${role.id}> peut désormais gérer les alertes anti-double et la blacklist PA.`
          : `⚠️ Le rôle <@&${role.id}> est déjà opérateur.`,
        ephemeral: true,
      });
    }
    if (sub === 'remove-role') {
      const role    = interaction.options.getRole('role', true);
      const removed = removeOperatorRole(guildId, role.id);
      return interaction.reply({
        content: removed
          ? `✅ Le rôle <@&${role.id}> a été retiré de la liste des opérateurs.`
          : `⚠️ Le rôle <@&${role.id}> n'est pas dans la liste.`,
        ephemeral: true,
      });
    }
    if (sub === 'list') {
      const cfg = getAntidoubleConfig(guildId);
      const ops = cfg.operatorIds.length > 0
        ? cfg.operatorIds.map(id => `<@${id}> (\`${id}\`)`).join('\n')
        : '_Aucun opérateur configuré_';
      const opsRoles = (cfg.operatorRoles && cfg.operatorRoles.length > 0)
        ? cfg.operatorRoles.map(id => `<@&${id}> (\`${id}\`)`).join('\n')
        : '_Aucun rôle opérateur configuré_';
      const embed = new EmbedBuilder()
        .setTitle('👮 Opérateurs & Rôles')
        .setColor(0x9b59b6)
        .addFields(
          { name: '👤 Utilisateurs', value: ops, inline: false },
          { name: '🛡️ Rôles', value: opsRoles, inline: false }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

const AD_BL_PAGE_SIZE = 8;

async function buildAdBlEmbed(client, page = 0, guildId = null) {
  const bl = guildId ? getBlacklist(guildId) : [];
  const total = bl.length;
  const pages = Math.max(1, Math.ceil(total / AD_BL_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p * AD_BL_PAGE_SIZE;
  const slice = bl.slice(start, start + AD_BL_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle('⛔ Blacklist — Police Academy')
    .setColor(0xe74c3c)
    .setFooter({ text: `Page ${p + 1}/${pages} • Total: ${total} entrée(s)` })
    .setTimestamp(new Date());

  if (slice.length === 0) {
    embed.setDescription('✅ Aucune entrée dans la blacklist.');
  } else {
    const lines = await Promise.all(slice.map(async (e, i) => {
      const idx = start + i + 1;
      const when = e.addedAt ? `<t:${Math.floor(e.addedAt / 1000)}:f>` : '—';
      const expires = e.expiresAt
        ? `<t:${Math.floor(e.expiresAt / 1000)}:R>`
        : '**Permanent**';
      let username = 'Inconnu';
      try {
        const user = await client.users.fetch(e.id);
        username = user.username;
      } catch { }

      const addedBy = e.addedBy ? `<@${e.addedBy}>` : '—';
      const duration = e.rawDuration || '—';
      const banStatus = e.banned ? '🔨 Banni du Discord' : '⛔ Blacklist uniquement';

      return `**#${idx}** — <@${e.id}> (\`${e.id}\`)\n` +
             `> 👤 @${username}\n` +
             `> 📝 ${e.motif || '—'}\n` +
             `> ⏱️ Durée: **${duration}** • Expire: ${expires}\n` +
             `> 📅 ${when} • ${banStatus}\n` +
             `> 👮 ${addedBy}` +
             (e.source ? ` • Source: \`${e.source}\`` : '');
    }));
    embed.setDescription(lines.join('\n\n'));
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`adbl_prev:${p}`)
      .setLabel('◀️ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p === 0),
    new ButtonBuilder()
      .setCustomId(`adbl_next:${p}`)
      .setLabel('Suivant ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= pages - 1),
    new ButtonBuilder()
      .setCustomId('adbl_refresh')
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, row, page: p, pages };
}

export async function handleBlpa(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'search') {
    const userId = interaction.options.getString('user-id', true).trim();
    const bl = getBlacklist(interaction.guild.id);
    const entry = bl.find(e => e.id === userId);

    if (!entry) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔍 Résultat de recherche')
            .setColor(0x2ecc71)
            .setDescription(`✅ L'utilisateur <@${userId}> (\`${userId}\`) **n'est pas** dans la blacklist Police Academy.`)
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    let username = 'Inconnu';
    try {
      const user = await interaction.client.users.fetch(entry.id);
      username = user.username;
    } catch { }

    const when = entry.addedAt ? `<t:${Math.floor(entry.addedAt / 1000)}:F>` : '—';
    const expires = entry.expiresAt
      ? `<t:${Math.floor(entry.expiresAt / 1000)}:F> (<t:${Math.floor(entry.expiresAt / 1000)}:R>)`
      : '**Permanent**';
    const duration = entry.rawDuration || '—';
    const banStatus = entry.banned ? '🔨 **Banni du Discord** + Blacklist' : '⛔ **Blacklist uniquement** (non banni)';
    const addedBy = entry.addedBy ? `<@${entry.addedBy}>` : '—';

    const embed = new EmbedBuilder()
      .setTitle('⛔ Blacklist PA — Fiche Utilisateur')
      .setColor(0xe74c3c)
      .addFields(
        { name: '👤 Utilisateur',     value: `<@${entry.id}> (\`${entry.id}\`)\n@${username}`, inline: false },
        { name: '📝 Motif',           value: entry.motif || '—',                                inline: false },
        { name: '⏱️ Durée',            value: duration,                                          inline: true },
        { name: '⏳ Expiration',       value: expires,                                           inline: true },
        { name: '🛡️ Statut',           value: banStatus,                                         inline: false },
        { name: '📅 Date d\'ajout',    value: when,                                              inline: true },
        { name: '👮 Ajouté par',       value: addedBy,                                           inline: true },
      )
      .setFooter({ text: `FlashBack FA • Blacklist PA${entry.source ? ` • Source: ${entry.source}` : ''}` })
      .setTimestamp();

    try {
      const user = await interaction.client.users.fetch(entry.id);
      if (user.displayAvatarURL()) {
        embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
      }
    } catch { }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'list') {
    if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
      return interaction.reply({ content: '❌ Vous devez être opérateur ou admin pour voir la blacklist.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const { embed, row } = await buildAdBlEmbed(interaction.client, 0, interaction.guild.id);
    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (sub === 'add') {
    if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
      return interaction.reply({ content: '❌ Vous devez être opérateur ou admin pour ajouter à la blacklist.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_blpa_add')
      .setTitle('Ajouter à la Blacklist PA');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('blpa_user_id')
          .setLabel('ID Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 123456789012345678')
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('blpa_reason')
          .setLabel('Motif')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Raison de la blacklist...')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('blpa_duration')
          .setLabel('Durée (7j, 30j, 6m, 1an, permanent)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 30j  |  permanent')
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('blpa_ban')
          .setLabel('Bannir du Discord ? (oui / non)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('oui ou non')
          .setRequired(true)
          .setMaxLength(3)
      ),
    );

    return interaction.showModal(modal);
  }

  if (sub === 'remove') {
    if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
      return interaction.reply({ content: '❌ Vous devez être opérateur ou admin pour retirer quelqu\'un de la blacklist.', ephemeral: true });
    }
    const userId = interaction.options.getString('user-id', true).trim();
    const removed = removeBlacklistEntry(interaction.guild.id, userId);
    if (!removed) {
      return interaction.reply({ content: '⚠️ Cet utilisateur n\'est pas dans la blacklist.', ephemeral: true });
    }

    for (const [, guild] of interaction.client.guilds.cache) {
      try {
        const g = await interaction.client.guilds.fetch(guild.id);
        await g.members.unban(userId, 'Retiré de la blacklist PA');
      } catch { }
    }

    log(`[BLPA] Remove: ${userId} — par ${interaction.user.id}`);
    return interaction.reply({ content: `✅ <@${userId}> (\`${userId}\`) a été retiré de la blacklist PA et débanni des serveurs.`, ephemeral: true });
  }
}

export async function handleBlpaModal(interaction) {
  if (!isOperator(interaction.guild.id, interaction.member) && !isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Non autorisé.', ephemeral: true });
  }

  const userId      = interaction.fields.getTextInputValue('blpa_user_id').trim();
  const reason      = interaction.fields.getTextInputValue('blpa_reason').trim();
  const rawDuration = interaction.fields.getTextInputValue('blpa_duration').trim();
  const banAnswer   = interaction.fields.getTextInputValue('blpa_ban').trim().toLowerCase();

  if (!/^\d{16,20}$/.test(userId)) {
    return interaction.reply({ content: '❌ ID Discord invalide (doit contenir 16-20 chiffres).', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const doBan = ['oui', 'o', 'yes', 'y'].includes(banAnswer);
  const durationMs = parseDuration(rawDuration);
  const expiresAt  = durationMs ? Date.now() + durationMs : null;

  addBlacklistEntry(interaction.guild.id, {
    id:        userId,
    motif:     reason,
    addedBy:   interaction.user.id,
    addedAt:   Date.now(),
    expiresAt,
    source:    'blpa',
    rawDuration,
    banned:    doBan,
  });

  let banCount = 0;
  if (doBan) {
    for (const [, guild] of interaction.client.guilds.cache) {
      try {
        const g = await interaction.client.guilds.fetch(guild.id);
        await g.members.ban(userId, { reason, deleteMessageSeconds: 0 }).catch(async () => {
          await g.bans.create(userId, { reason });
        });
        banCount++;
      } catch { }
    }
  }

  log(`[BLPA] Add: ${userId} — ${rawDuration} — ban:${doBan} — ${reason} — guild:${interaction.guild.id}`);

  const durationLabel = expiresAt
    ? `<t:${Math.floor(expiresAt / 1000)}:F>`
    : '**Permanent**';
  const banLabel = doBan ? `🔨 Banni de ${banCount} serveur(s)` : '⛔ Blacklist uniquement (non banni)';

  return interaction.editReply({
    content: `✅ <@${userId}> (\`${userId}\`) ajouté à la Blacklist PA.\n` +
             `> 📝 ${reason}\n` +
             `> ⏱️ Durée: **${rawDuration}** • Expire: ${durationLabel}\n` +
             `> ${banLabel}`,
  });
}

export { buildAdBlEmbed };
