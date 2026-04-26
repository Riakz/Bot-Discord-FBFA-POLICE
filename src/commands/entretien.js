import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { error } from '../utils/logger.js';
import {
  getEntretienConfig,
  setEntretienResultChannel,
  setEntretienNotifChannel,
  setEntretienSheetUrl,
  setEntretienRolePassed,
  setEntretienRoleFailed,
  addEntretienReviewerRole,
  removeEntretienReviewerRole,
} from '../utils/entretienConfig.js';
import { DISTRICTS } from '../utils/candidatureConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DECISIONS_FILE = path.join(__dirname, '..', 'data', 'entretien-decisions.json');
let entretienDecisions = {};

function loadEntretienDecisions() {
  try {
    if (fs.existsSync(DECISIONS_FILE)) {
      entretienDecisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8'));
    }
  } catch { entretienDecisions = {}; }
}

function saveEntretienDecisions() {
  try {
    const dir = path.dirname(DECISIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DECISIONS_FILE, JSON.stringify(entretienDecisions, null, 2), 'utf8');
  } catch (e) { error('[Entretien] Erreur sauvegarde decisions:', e); }
}

function getEntretienDecision(messageId) {
  return entretienDecisions[messageId] ?? { status: 'pending' };
}

function setEntretienDecisionData(messageId, data) {
  entretienDecisions[messageId] = { ...data, updatedAt: Date.now() };
  saveEntretienDecisions();
}

loadEntretienDecisions();

const LOGO_PA = 'https://media.discordapp.net/attachments/1447042636279189615/1497229717051277423/SAMP_PA_Logo.png';

const DISTRICT_COLORS = {
  mission_row:  0x1a6fd4,
  vespucci:     0x1fa66a,
  alta:         0x8e44ad,
  sandy_shores: 0xe67e22,
  roxwood:      0x2c3e50,
};

const ENTRETIEN_GIFS = {
  mission_row: {
    passed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626991120355499/ENTRETIEN_ACCEPTE_MR.gif',
    failed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626992520986674/ENTRETIEN_ECHOUE_MR.gif',
  },
  vespucci: {
    passed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626991929856161/ENTRETIEN_ACCEPTE_VP.gif',
    failed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626990293946368/ENTRETIEN_ECHOUE_VP.gif',
  },
  alta: {
    passed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626990843527219/ENTRETIEN_ACCEPTE_ALTA.gif',
    failed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626992215064687/ENTRETIEN_ECHOUE_ALTA.gif',
  },
  sandy_shores: {
    passed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626991665483911/ENTRETIEN_ACCEPTE_SS.gif',
    failed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626990574960650/ENTRETIEN_ECHOUE_SS.gif',
  },
  roxwood: {
    passed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626991439118337/ENTRETIEN_ACCEPTE_RW.gif',
    failed: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497626992810659860/ENTRETIEN_ECHOUE_RW.gif',
  },
};

function hasReviewerRole(interaction) {
  const cfg = getEntretienConfig(interaction.guild.id);
  const ids  = cfg.reviewerRoleIds ?? [];
  if (ids.length === 0) return isAdmin(interaction.user.id);
  return ids.some(id => interaction.member.roles.cache.has(id)) || isAdmin(interaction.user.id);
}

function buildEntretienButtons(district, messageId = null, decided = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`entretien_pass:${district}`)
      .setLabel('Attribuer rôle Réussi')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(decided),
    new ButtonBuilder()
      .setCustomId(`entretien_fail:${district}`)
      .setLabel('Attribuer rôle Échoué')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(decided),
    new ButtonBuilder()
      .setCustomId(`entretien_viewreason:${messageId ?? 'pending'}`)
      .setLabel('Voir le motif')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!decided),
    new ButtonBuilder()
      .setCustomId(`entretien_revert:${messageId ?? 'pending'}`)
      .setLabel('Revenir sur la décision')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!decided),
  );
  return row;
}

export async function processEntretienWebhook(client, message) {
  try {
    const raw = message.content.slice('ENTRETIEN_DATA:'.length).trim();
    const data = JSON.parse(raw);

    const { candidat, instructeur, district, reponses = [], score, resultat, commentaire } = data;

    const guildId = message.guild?.id;
    if (!guildId) return;

    const cfg         = getEntretienConfig(guildId);
    const districtName = DISTRICTS[district] ?? district ?? 'Inconnu';

    const resultatLower = (resultat ?? '').toLowerCase();
    const color = resultatLower.includes('réussi') || resultatLower.includes('reussi')
      ? 0x2ecc71
      : resultatLower.includes('écho') || resultatLower.includes('echo') || resultatLower.includes('raté') || resultatLower.includes('rate')
        ? 0xe74c3c
        : DISTRICT_COLORS[district] ?? 0x2c3e50;

    const embed = new EmbedBuilder()
      .setTitle(`📋 Résultat d'Entretien — ${districtName}`)
      .setColor(color)
      .addFields(
        { name: '👤 Candidat',     value: String(candidat    || '—'), inline: true },
        { name: '🎖️ Instructeur', value: String(instructeur || '—'), inline: true },
        { name: '🏙️ District',    value: districtName,                inline: true },
        { name: '📊 Score',        value: String(score       || '—'), inline: true },
        { name: '🏆 Résultat',     value: String(resultat    || '—'), inline: true },
      );

    if (Array.isArray(reponses) && reponses.length > 0) {
      reponses.forEach((rep, i) => {
        embed.addFields({ name: `💬 Réponse ${i + 1}`, value: String(rep || '—').slice(0, 1024), inline: false });
      });
    }

    if (commentaire) {
      embed.addFields({ name: '📝 Commentaire', value: String(commentaire).slice(0, 1024), inline: false });
    }

    embed
      .setFooter({ text: 'FlashBack FA • Entretien Police Academy' })
      .setTimestamp();

    const row = buildEntretienButtons(district ?? 'unknown');

    let targetChannel = null;
    if (cfg.resultChannelId) {
      try { targetChannel = await client.channels.fetch(cfg.resultChannelId); } catch { }
    }
    if (!targetChannel) targetChannel = message.channel;

    await targetChannel.send({ embeds: [embed], components: [row] });

    try { await message.delete(); } catch { }
  } catch (e) {
    error('[Entretien] Erreur traitement webhook:', e);
  }
}

export async function handleEntretienButton(interaction) {
  if (!hasReviewerRole(interaction)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas le rôle requis pour attribuer un résultat d\'entretien.',
      ephemeral: true,
    });
  }

  const parts     = interaction.customId.split(':');
  const isPass    = parts[0] === 'entretien_pass';
  const district  = parts[1] ?? 'unknown';
  const messageId = interaction.message.id;

  const modal = new ModalBuilder()
    .setCustomId(`modal_entretien_${isPass ? 'pass' : 'fail'}:${district}:${messageId}`)
    .setTitle(isPass ? '✅ Attribuer rôle Réussi' : '❌ Attribuer rôle Échoué');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('entretien_discord_id')
        .setLabel('ID Discord du candidat')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 123456789012345678')
        .setRequired(true)
        .setMaxLength(20)
    ),
  );

  if (!isPass) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('entretien_reason')
          .setLabel('Motif du refus (optionnel)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Raison de l\'échec...')
          .setRequired(false)
          .setMaxLength(500)
      ),
    );
  }

  return interaction.showModal(modal);
}

export async function handleEntretienModal(interaction) {
  const parts     = interaction.customId.split(':');
  const isPass    = parts[0] === 'modal_entretien_pass';
  const district  = parts[1] ?? 'unknown';
  const messageId = parts[2] ?? null;

  const discordId = interaction.fields.getTextInputValue('entretien_discord_id').trim();

  if (!/^\d{16,20}$/.test(discordId)) {
    return interaction.reply({ content: '❌ ID Discord invalide (doit être composé de 16 à 20 chiffres).', ephemeral: true });
  }

  const reason = !isPass
    ? (interaction.fields.getTextInputValue('entretien_reason')?.trim() || null)
    : null;

  await interaction.deferReply({ ephemeral: true });

  const cfg    = getEntretienConfig(interaction.guild.id);
  const roleId = isPass
    ? (cfg.rolesPassedByDistrict?.[district] ?? null)
    : cfg.roleFailedId;

  if (!roleId) {
    const districtName = DISTRICTS[district] ?? district;
    return interaction.editReply({
      content: `❌ Aucun rôle configuré pour ${isPass ? `réussi — ${districtName}` : 'échoué'}. Utilisez \`/config-entretien set-role-${isPass ? 'passed' : 'failed'}\`.`,
    });
  }

  let member = null;
  try {
    member = await interaction.guild.members.fetch(discordId);
  } catch {
    return interaction.editReply({ content: `❌ Membre introuvable (ID: \`${discordId}\`). Vérifiez l'ID Discord.` });
  }

  try {
    await member.roles.add(roleId);
  } catch (e) {
    return interaction.editReply({ content: `❌ Impossible d'attribuer le rôle: ${e.message}` });
  }

  if (messageId) {
    setEntretienDecisionData(messageId, {
      status:      isPass ? 'passed' : 'failed',
      district,
      candidateId: discordId,
      roleId,
      decidedBy:   interaction.user.id,
      decidedAt:   Date.now(),
      reason,
    });
  }

  const districtName   = DISTRICTS[district] ?? district ?? 'Inconnu';
  const recruiterName  = interaction.member?.displayName || interaction.user.displayName;
  const gif            = ENTRETIEN_GIFS[district]?.[isPass ? 'passed' : 'failed'];

  try {
    if (interaction.message?.embeds?.length > 0) {
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
      updatedEmbed.setColor(isPass ? 0x2ecc71 : 0xe74c3c);
      updatedEmbed.setFooter({
        text: `FlashBack FA • Entretien Police Academy • ${isPass ? '✅ Validé' : '❌ Refusé'} par ${recruiterName}`,
      });
      updatedEmbed.addFields({
        name:  '👮 Traité par',
        value: `<@${interaction.user.id}> → Candidat : <@${discordId}>`,
        inline: false,
      });
      await interaction.message.edit({ embeds: [updatedEmbed], components: [buildEntretienButtons(district, messageId, true)] });
    }
  } catch (e) {
    error('[Entretien] Erreur mise à jour embed:', e);
  }

  if (cfg.notifChannelId) {
    try {
      const notifChannel = await interaction.client.channels.fetch(cfg.notifChannelId);

      const notifEmbed = new EmbedBuilder()
        .setTitle(isPass
          ? `✅ Entretien Validé — ${districtName}`
          : `❌ Entretien Refusé — ${districtName}`)
        .setColor(isPass ? 0x2ecc71 : 0xe74c3c)
        .setDescription(isPass
          ? `**Entretien validé : ✅** Félicitations, votre entretien est validé. Vous avez 30 jours pour poursuivre votre parcours.`
          : `**Entretien refusé :** Vous avez été refusé lors de votre passage entretien.\n\n**Motif :** ${reason || '—'}`)
        .addFields(
          { name: 'Candidat', value: `<@${discordId}>`, inline: true },
          { name: 'District', value: districtName,       inline: true },
        )
        .setFooter({ text: `San Andreas Police Academy | Recruteur : ${recruiterName}`, iconURL: LOGO_PA })
        .setTimestamp();

      if (gif) notifEmbed.setImage(gif);

      const sentNotif = await notifChannel.send({ content: `<@${discordId}>`, embeds: [notifEmbed] });
      if (messageId) {
        const cur = getEntretienDecision(messageId);
        setEntretienDecisionData(messageId, { ...cur, notifMessageId: sentNotif.id, notifChannelId: cfg.notifChannelId });
      }
    } catch (e) {
      error('[Entretien] Erreur envoi notification:', e);
    }
  }

  return interaction.editReply({
    content: `✅ Rôle **${isPass ? 'Réussi' : 'Échoué'}** attribué à <@${discordId}>.${reason ? `\n**Motif :** ${reason}` : ''}`,
  });
}

export async function handleEntretienViewReason(interaction) {
  const messageId = interaction.customId.split(':')[1];
  const decision  = getEntretienDecision(messageId);

  if (decision.status === 'pending') {
    return interaction.reply({
      content: '⚠️ Aucune décision n\'a encore été prise pour cet entretien.',
      ephemeral: true,
    });
  }

  if (decision.status === 'passed') {
    return interaction.reply({
      content: `✅ Cet entretien a été **validé** par <@${decision.decidedBy}> le <t:${Math.floor(decision.decidedAt / 1000)}:F>.`,
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📋 Motif de refus — Entretien')
        .setColor(0xe74c3c)
        .setDescription(decision.reason ?? 'Aucun motif renseigné.')
        .addFields(
          { name: 'Décidé par', value: `<@${decision.decidedBy}>`, inline: true },
          { name: 'Date',       value: `<t:${Math.floor(decision.decidedAt / 1000)}:F>`, inline: true },
        )
        .setTimestamp(),
    ],
    ephemeral: true,
  });
}

export async function handleEntretienRevert(interaction) {
  if (!hasReviewerRole(interaction)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas le rôle requis pour annuler une décision d\'entretien.',
      ephemeral: true,
    });
  }

  const messageId = interaction.customId.split(':')[1];
  const decision  = getEntretienDecision(messageId);

  if (decision.status === 'pending') {
    return interaction.reply({
      content: '⚠️ Aucune décision à annuler pour cet entretien.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const member = await interaction.guild.members.fetch(decision.candidateId).catch(() => null);
    if (member && decision.roleId) {
      await member.roles.remove(decision.roleId).catch(() => null);
    }
  } catch (e) {
    error('[Entretien] Erreur retrait rôle revert:', e);
  }

  try {
    if (interaction.message?.embeds?.length > 0) {
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
      const originalColor = DISTRICT_COLORS[decision.district] ?? 0x2c3e50;
      const fields = (updatedEmbed.data.fields ?? []).filter(f => f.name !== '👮 Traité par');
      updatedEmbed.setColor(originalColor);
      updatedEmbed.setFooter({ text: 'FlashBack FA • Entretien Police Academy' });
      updatedEmbed.setFields(fields);
      await interaction.message.edit({
        embeds:     [updatedEmbed],
        components: [buildEntretienButtons(decision.district, null, false)],
      });
    }
  } catch (e) {
    error('[Entretien] Erreur reset embed revert:', e);
  }

  if (decision.notifMessageId && decision.notifChannelId) {
    try {
      const notifCh  = await interaction.client.channels.fetch(decision.notifChannelId);
      const notifMsg = await notifCh.messages.fetch(decision.notifMessageId);
      await notifMsg.delete();
    } catch { }
  }

  setEntretienDecisionData(messageId, {
    ...decision,
    status:         'pending',
    candidateId:    null,
    roleId:         null,
    decidedBy:      null,
    decidedAt:      null,
    reason:         null,
    notifMessageId: null,
    notifChannelId: null,
    revertedBy:     interaction.user.id,
  });

  return interaction.editReply({ content: '✅ La décision a été annulée. L\'entretien est à nouveau en attente.' });
}

export async function handleConfigEntretien(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'show') {
    const cfg   = getEntretienConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`📋 Configuration Entretiens — ${interaction.guild.name}`)
      .setColor(0x2c3e50)
      .setTimestamp();

    embed.addFields(
      {
        name:  '📺 Salon réception (boutons Validé/Refusé)',
        value: cfg.resultChannelId ? `<#${cfg.resultChannelId}>` : '❌ Non défini',
        inline: false,
      },
      {
        name:  '📢 Salon notifications résultats',
        value: cfg.notifChannelId ? `<#${cfg.notifChannelId}>` : '❌ Non défini',
        inline: false,
      },
    );

    if (cfg.sheetUrl) {
      embed.addFields({ name: '📊 Feuille Google Sheet', value: cfg.sheetUrl, inline: false });
    }

    embed.addFields({
      name:  '❌ Rôle Échoué (global)',
      value: cfg.roleFailedId ? `<@&${cfg.roleFailedId}>` : '❌ Non défini',
      inline: false,
    });

    for (const [key, name] of Object.entries(DISTRICTS)) {
      const roleId = cfg.rolesPassedByDistrict?.[key];
      embed.addFields({
        name:  `✅ Rôle Réussi — ${name}`,
        value: roleId ? `<@&${roleId}>` : '❌ Non défini',
        inline: true,
      });
    }

    const reviewerIds = cfg.reviewerRoleIds ?? [];
    embed.addFields({
      name:  '👮 Rôles Examinateurs',
      value: reviewerIds.length > 0
        ? reviewerIds.map(id => `<@&${id}>`).join(', ')
        : '*(aucun — tout le monde peut attribuer les résultats)*',
      inline: false,
    });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'set-result-channel') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) return interaction.reply({ content: '❌ Salon invalide ou introuvable.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Impossible de trouver ce salon.', ephemeral: true });
    }
    setEntretienResultChannel(guildId, channelId);
    return interaction.reply({ content: `✅ Salon de réception des entretiens (boutons Validé/Refusé) défini sur <#${channelId}>.`, ephemeral: true });
  }

  if (sub === 'set-notif-channel') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) return interaction.reply({ content: '❌ Salon invalide ou introuvable.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Impossible de trouver ce salon.', ephemeral: true });
    }
    setEntretienNotifChannel(guildId, channelId);
    return interaction.reply({ content: `✅ Salon de notifications de résultats défini sur <#${channelId}>.`, ephemeral: true });
  }

  if (sub === 'set-sheet-url') {
    const url = interaction.options.getString('url', true).trim();
    setEntretienSheetUrl(guildId, url);
    return interaction.reply({ content: `✅ URL de la feuille Google Sheet enregistrée.`, ephemeral: true });
  }

  if (sub === 'set-role-passed') {
    const districtKey = interaction.options.getString('district', true);
    const roleId      = interaction.options.getRole('role', true).id;
    setEntretienRolePassed(guildId, districtKey, roleId);
    return interaction.reply({
      content: `✅ Rôle **Réussi** pour **${DISTRICTS[districtKey]}** défini sur <@&${roleId}>.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-role-failed') {
    const roleId = interaction.options.getRole('role', true).id;
    setEntretienRoleFailed(guildId, roleId);
    return interaction.reply({
      content: `✅ Rôle **Échoué** (global) défini sur <@&${roleId}>.`,
      ephemeral: true,
    });
  }

  if (sub === 'add-reviewer-role') {
    const role  = interaction.options.getRole('role', true);
    const added = addEntretienReviewerRole(guildId, role.id);
    return interaction.reply({
      content: added
        ? `✅ ${role} ajouté comme rôle examinateur.`
        : `⚠️ ${role} est déjà dans la liste des rôles examinateurs.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-reviewer-role') {
    const role    = interaction.options.getRole('role', true);
    const removed = removeEntretienReviewerRole(guildId, role.id);
    return interaction.reply({
      content: removed
        ? `✅ ${role} retiré des rôles examinateurs.`
        : `⚠️ ${role} n'était pas dans la liste des rôles examinateurs.`,
      ephemeral: true,
    });
  }
}
