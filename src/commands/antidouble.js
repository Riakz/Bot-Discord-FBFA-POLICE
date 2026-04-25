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
  {
    key: 'uniqueId',
    label: '🆔 ID Unique identique',
    score: 100,
    match: (a, b) => a.uniqueId && b.uniqueId && norm(a.uniqueId) === norm(b.uniqueId),
  },
  {
    key: 'userId',
    label: '🎮 Même compte Discord',
    score: 100,
    match: (a, b) => a.userId && b.userId && a.userId === b.userId,
  },
  {
    key: 'username',
    label: '👤 Même pseudo Discord',
    score: 80,
    match: (a, b) => a.username && b.username && norm(a.username) === norm(b.username),
  },
  {
    key: 'name_exact',
    label: '📛 Même nom de personnage',
    score: 70,
    match: (a, b) => a.name && b.name && norm(a.name) === norm(b.name),
  },
  {
    key: 'phone',
    label: '📞 Même numéro de téléphone',
    score: 60,
    match: (a, b) => a.phone && b.phone && norm(a.phone) === norm(b.phone),
  },
  {
    key: 'birthdate_exact',
    label: '🎂 Même date de naissance',
    score: 50,
    match: (a, b) => a.birthdate && b.birthdate && norm(a.birthdate) === norm(b.birthdate),
  },
  {
    key: 'name_similar',
    label: '📛 Nom de personnage similaire',
    score: 35,
    match: (a, b) => {
      if (!a.name || !b.name) return false;
      const na = norm(a.name), nb = norm(b.name);
      if (na === nb) return false;
      return levenshtein(na, nb) <= 2;
    },
  },
  {
    key: 'birthdate_close',
    label: '🎂 Date de naissance proche (±1 an)',
    score: 20,
    match: (a, b) => {
      if (!a.birthdate || !b.birthdate) return false;
      const da = parseDate(a.birthdate), db = parseDate(b.birthdate);
      if (!da || !db || da.getTime() === db.getTime()) return false;
      return Math.abs(da - db) <= 365 * 86400000;
    },
  },
];

const LEVELS = [
  { min: 100, label: '🔴 Critique',      color: 0xe74c3c },
  { min:  70, label: '🟠 Suspect',       color: 0xe67e22 },
  { min:  40, label: '🟡 À surveiller',  color: 0xf1c40f },
];

function getLevel(score) {
  return LEVELS.find(l => score >= l.min) ?? null;
}

export function detectDoubles(newEntry) {
  const all = getAllEntries();
  const results = [];

  for (const existing of all) {
    if (existing.msgId === newEntry.msgId) continue;

    const matched = CHECKS.filter(c => c.match(newEntry, existing));
    if (!matched.length) continue;

    const totalScore = matched.reduce((s, c) => s + c.score, 0);
    const level = getLevel(totalScore);
    if (!level) continue;

    results.push({ existing, matched, totalScore, level });
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

  for (const { existing, matched, totalScore, level } of matches) {
    const criteriaList = matched.map(c => `• ${c.label} (+${c.score})`).join('\n');
    const isBypass = isBlacklisted(existing.userId);

    const bypassBanner = isBypass
      ? '\n\n🚨 **TENTATIVE DE CONTOURNEMENT** — Le compte existant est blacklisté.'
      : '';

    const embed = new EmbedBuilder()
      .setTitle(isBypass
        ? '🚨 Contournement de Blacklist Détecté'
        : `${level.label} — Double Compte Potentiel`)
      .setColor(isBypass ? 0x8b0000 : level.color)
      .setDescription(
        `**Candidat actuel :** <@${newEntry.userId}> (\`${newEntry.userId}\`)\n` +
        `**Candidat existant :** <@${existing.userId}> (\`${existing.userId}\`)` +
        bypassBanner +
        `\n\n**Score de similarité : ${totalScore} pts**\n\n` +
        `**Critères déclencheurs :**\n${criteriaList}`
      )
      .addFields(
        {
          name: '📋 Candidature actuelle',
          value: `District: \`${newEntry.districtKey}\`\nID Unique: \`${newEntry.uniqueId || '—'}\`\nNom: \`${newEntry.name || '—'}\`\nNé le: \`${newEntry.birthdate || '—'}\``,
          inline: true,
        },
        {
          name: '📋 Candidature existante',
          value: `District: \`${existing.districtKey}\`\nID Unique: \`${existing.uniqueId || '—'}\`\nNom: \`${existing.name || '—'}\`\nNé le: \`${existing.birthdate || '—'}\``,
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
