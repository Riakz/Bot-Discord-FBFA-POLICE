import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DISTRICTS,
  getCandidatureConfig,
  setApplicationChannel,
  setResultChannel,
  setGlobalRefusedRole,
  setAcceptedRole,
  addReviewerRole,
  removeReviewerRole,
} from '../utils/candidatureConfig.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import { saveCandidatureEntry } from '../utils/candidatureStore.js';
import { sendDoubleAlerts } from './antidouble.js';
import { isBlacklisted } from '../utils/blacklistManager.js';
import { getAntidoubleConfig } from '../utils/antidoubleConfig.js';
import { safeWriteJSON } from '../utils/safeWrite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pendingForms = new Map();
const FORM_TTL_MS = 10 * 60 * 1000;

function storePart1(userId, district, part1) {
  pendingForms.set(userId, {
    district,
    part1,
    expiresAt: Date.now() + FORM_TTL_MS,
  });
}

function getPending(userId) {
  const entry = pendingForms.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingForms.delete(userId);
    return null;
  }
  return entry;
}

function clearPending(userId) {
  pendingForms.delete(userId);
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of pendingForms) {
    if (now > entry.expiresAt) pendingForms.delete(uid);
  }
}, 5 * 60 * 1000);

const DECISIONS_FILE = path.join(__dirname, '..', '..', 'data', 'candidature-decisions.json');

let decisions = {};

function loadDecisions() {
  try {
    if (fs.existsSync(DECISIONS_FILE)) {
      decisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8'));
    }
  } catch { decisions = {}; }
}

function saveDecisions() {
  try {
    safeWriteJSON(DECISIONS_FILE, decisions);
  } catch (e) { error('[Candidature] Erreur sauvegarde decisions:', e); }
}

function getDecision(messageId) {
  return decisions[messageId] ?? { status: 'pending' };
}

function setDecision(messageId, data) {
  decisions[messageId] = { ...data, updatedAt: Date.now() };
  saveDecisions();
}

loadDecisions();

const DISTRICT_COLORS = {
  mission_row:  0x1a6fd4,
  vespucci:     0x1fa66a,
  alta:         0x8e44ad,
  sandy_shores: 0xe67e22,
  roxwood:      0x2c3e50,
};

const DISTRICT_GIFS = {
  mission_row:  { accepted: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229026807386124/mrca.gif', refused: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229027109503188/mrcr.gif' },
  vespucci:     { accepted: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229025213677578/vpca.gif', refused: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229025742028841/vpcr.gif' },
  alta:         { accepted: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229026513649664/altaca.gif', refused: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229026153201685/altacrr.gif' },
  sandy_shores: { accepted: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229024181879004/ssca.gif', refused: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229024823476354/sscr.gif' },
  roxwood:      { accepted: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229023594545263/rwca.gif', refused: 'https://cdn.discordapp.com/attachments/1452091261212426392/1497229023904927896/rwcr.gif' },
};

const LOGO_PA = 'https://media.discordapp.net/attachments/1447042636279189615/1497229717051277423/SAMP_PA_Logo.png';

function hasReviewerRole(interaction) {
  const cfg = getCandidatureConfig(interaction.guild.id);
  const ids  = cfg.reviewerRoleIds ?? [];
  if (ids.length === 0) return isAdmin(interaction.user.id);
  return ids.some(id => interaction.member.roles.cache.has(id)) || isAdmin(interaction.user.id);
}

function buildDecisionButtons(messageId, status = 'pending') {
  const isPending = status === 'pending';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cand_accept:${messageId}`)
      .setLabel('Accepté')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isPending),

    new ButtonBuilder()
      .setCustomId(`cand_refuse:${messageId}`)
      .setLabel('Refusé')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isPending),

    new ButtonBuilder()
      .setCustomId(`cand_viewreason:${messageId}`)
      .setLabel('Voir le motif')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isPending),

    new ButtonBuilder()
      .setCustomId(`cand_revert:${messageId}`)
      .setLabel('Revenir')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isPending),
  );
}

export async function handleCandidaturePanel(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Réservé aux administrateurs du bot.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal_cand_panel_setup')
    .setTitle('Configuration du Panel Candidature');

  const defaultDesc = '**Bienvenue dans le formulaire de candidature de la Police.**\n\n' +
    'Sélectionnez le district dans lequel vous souhaitez postuler en cliquant sur le bouton correspondant.\n';

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_setup_title')
        .setLabel('Titre de l\'embed (Optionnel)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('📋 Candidature — Police')
        .setRequired(false)
        .setMaxLength(250)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_setup_desc')
        .setLabel('Description (Optionnel)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Texte affiché au-dessus de la liste des districts')
        .setValue(defaultDesc)
        .setRequired(false)
        .setMaxLength(2000)
    )
  );

  return interaction.showModal(modal);
}

export async function handleCandidaturePanelModal(interaction) {
  if (!isAdmin(interaction.user.id)) return interaction.reply({ content: '❌ Réservé aux admins.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    const customTitle = interaction.fields.getTextInputValue('cand_setup_title').trim() || '📋 Candidature — Police';
    const customDesc  = interaction.fields.getTextInputValue('cand_setup_desc').trim();

    let finalDesc = '';
    if (customDesc) {
      finalDesc += customDesc + '\n\n';
    }

    finalDesc += Object.entries(DISTRICTS).map(([key, name]) =>
      `- **${name}**`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(customTitle)
      .setDescription(finalDesc)
      .setColor(0x2c3e50)
      .setFooter({ text: 'FlashBack FA • Candidature Police' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      ...Object.entries(DISTRICTS).map(([key, name]) =>
        new ButtonBuilder()
          .setCustomId(`cand_district:${key}`)
          .setLabel(name)
          .setStyle(ButtonStyle.Primary)
      )
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.editReply({ content: '✅ Panel de candidature publié.' });
  } catch (e) {
    return interaction.editReply({ content: `❌ Erreur lors de la publication : ${e.message}` });
  }
}

export async function handleDistrictButton(interaction) {
  const districtKey = interaction.customId.split(':')[1];
  if (!DISTRICTS[districtKey]) return;

  if (isBlacklisted(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Vous êtes blacklisté et ne pouvez pas postuler.',
      ephemeral: true,
    });
  }

  const adCfg = getAntidoubleConfig();
  if (adCfg.bannedRoleId && interaction.member.roles.cache.has(adCfg.bannedRoleId)) {
    return interaction.reply({
      content: '❌ Vous n\'êtes pas autorisé à postuler.',
      ephemeral: true,
    });
  }

  const now = Date.now();
  for (const dec of Object.values(decisions)) {
    if (dec.candidateId === interaction.user.id && dec.status === 'refused') {
      const waitTimeMs = 48 * 60 * 60 * 1000;
      if (now - dec.decidedAt < waitTimeMs) {
        const unlockDate = Math.floor((dec.decidedAt + waitTimeMs) / 1000);
        return interaction.reply({
          content: `❌ Vous avez été refusé récemment.\n\nVous êtes bloqué(e) et vous pourrez à nouveau postuler le <t:${unlockDate}:f> (<t:${unlockDate}:R>).`,
          ephemeral: true,
        });
      }
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_cand_part1:${districtKey}`)
    .setTitle(`Candidature — ${DISTRICTS[districtKey]} (1/2)`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_unique_id')
        .setLabel('🆔 ID Unique')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 4404')
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_birthdate')
        .setLabel('🎂 Date de naissance HRP')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 15/04/2002')
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_hours')
        .setLabel('⏱️ Heures sur le serveur')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 250')
        .setRequired(true)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_name')
        .setLabel('👤 Nom Prénom')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Jean Dupont')
        .setRequired(true)
        .setMaxLength(60)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_diploma')
        .setLabel('🎓 Diplôme')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Master en criminologie')
        .setRequired(true)
        .setMaxLength(100)
    ),
  );

  return interaction.showModal(modal);
}

export async function handleFormPart1(interaction) {
  const districtKey = interaction.customId.split(':')[1];
  if (!DISTRICTS[districtKey]) return;

  const part1 = {
    uniqueId:  interaction.fields.getTextInputValue('cand_unique_id').trim(),
    birthdate: interaction.fields.getTextInputValue('cand_birthdate').trim(),
    hours:     interaction.fields.getTextInputValue('cand_hours').trim(),
    name:      interaction.fields.getTextInputValue('cand_name').trim(),
    diploma:   interaction.fields.getTextInputValue('cand_diploma').trim(),
  };

  storePart1(interaction.user.id, districtKey, part1);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cand_part2_btn:${districtKey}`)
      .setLabel('Passer à l\'étape 2')
      .setStyle(ButtonStyle.Success)
  );

  return interaction.reply({
    content: `✅ La **Partie 1** de votre candidature pour **${DISTRICTS[districtKey]}** a bien été enregistrée.\n\nCliquez sur le bouton ci-dessous pour continuer vers la Partie 2 (vous avez 10 minutes max).`,
    components: [row],
    ephemeral: true,
  });
}

export async function handlePart2Button(interaction) {
  const districtKey = interaction.customId.split(':')[1];
  if (!DISTRICTS[districtKey]) return;

  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: '❌ Votre session est introuvable ou a expiré. Veuillez reprendre depuis le début (panel des districts).',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_cand_part2:${districtKey}`)
    .setTitle(`Candidature — ${DISTRICTS[districtKey]} (2/2)`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_nationality')
        .setLabel('🌎 Nationalité')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Française')
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_phone')
        .setLabel('📞 Numéro de téléphone')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 555-0123')
        .setRequired(true)
        .setMaxLength(30)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_letter')
        .setLabel('📝 Lettre de motivation')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Expliquez pourquoi vous souhaitez rejoindre ce district...')
        .setRequired(true)
        .setMinLength(50)
        .setMaxLength(1000)
    ),
  );

  return interaction.showModal(modal);
}

export async function handleFormPart2(interaction) {
  const districtKey = interaction.customId.split(':')[1];
  if (!DISTRICTS[districtKey]) return;

  await interaction.deferReply({ ephemeral: true });

  const pending = getPending(interaction.user.id);
  if (!pending) {
    return interaction.editReply({
      content: '❌ Votre formulaire a expiré (10 min max entre les deux étapes). Veuillez recommencer.',
    });
  }

  const part2 = {
    nationality: interaction.fields.getTextInputValue('cand_nationality').trim(),
    phone:       interaction.fields.getTextInputValue('cand_phone').trim(),
    letter:      interaction.fields.getTextInputValue('cand_letter').trim(),
  };

  clearPending(interaction.user.id);

  const { part1 } = pending;
  const districtName  = DISTRICTS[districtKey];
  const color         = DISTRICT_COLORS[districtKey];

  const cfg = getCandidatureConfig(interaction.guild.id);
  const channelId = cfg.districts[districtKey]?.applicationChannelId;

  if (!channelId) {
    return interaction.editReply({
      content: `❌ Le salon de candidature pour **${districtName}** n'est pas encore configuré. Contactez un administrateur.`,
    });
  }

  let applicationChannel;
  try {
    applicationChannel = await interaction.client.channels.fetch(channelId);
  } catch {
    return interaction.editReply({
      content: `❌ Impossible d'accéder au salon de candidature pour **${districtName}**. Contactez un administrateur.`,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Candidature — ${districtName}`)
    .setColor(color)
    .addFields(
      { name: '🆔 ID Unique',                value: part1.uniqueId,     inline: false },
      { name: '🎂 Date de naissance HRP',    value: part1.birthdate,    inline: false },
      { name: '⏱️ Heures sur le serveur',   value: part1.hours,        inline: false },
      { name: '👤 Nom Prénom',              value: part1.name,         inline: false },
      { name: '🎓 Diplôme',                 value: part1.diploma,      inline: false },
      { name: '🌎 Nationalité',             value: part2.nationality,  inline: false },
      { name: '📞 Numéro de téléphone',     value: part2.phone,        inline: false },
      { name: '📝 Lettre de motivation',    value: part2.letter,       inline: false },
      {
        name:  '👮 Identification candidat',
        value: `<@${interaction.user.id}> • \`${interaction.user.id}\` • @${interaction.user.username}`,
        inline: false,
      },
    )
    .setFooter({ text: `FlashBack FA • Candidature Police • ${districtName}` })
    .setTimestamp();

  let sentMsg;
  try {
    sentMsg = await applicationChannel.send({
      embeds: [embed],
      components: [buildDecisionButtons('placeholder')],
    });
  } catch (e) {
    error('[Candidature] Erreur envoi candidature:', e);
    return interaction.editReply({
      content: `❌ Erreur lors de l'envoi de la candidature: ${e.message}`,
    });
  }

  const realButtons = buildDecisionButtons(sentMsg.id, 'pending');
  await sentMsg.edit({ components: [realButtons] });

  setDecision(sentMsg.id, {
    status:      'pending',
    districtKey,
    guildId:     interaction.guild.id,
    channelId:   applicationChannel.id,
    candidateId: interaction.user.id,
  });

  const storeEntry = {
    msgId:            sentMsg.id,
    userId:           interaction.user.id,
    username:         interaction.user.username,
    uniqueId:         part1.uniqueId,
    name:             part1.name,
    birthdate:        part1.birthdate,
    phone:            part2.phone,
    districtKey,
    guildId:          interaction.guild.id,
    submittedAt:      Date.now(),
    accountCreatedAt: interaction.user.createdTimestamp,
  };
  saveCandidatureEntry(sentMsg.id, storeEntry);
  sendDoubleAlerts(interaction.client, storeEntry).catch(e => error('[Antidouble] Détection échouée:', e));

  return interaction.editReply({
    content: `✅ Votre candidature pour **${districtName}** a été envoyée avec succès ! Vous serez informé de la décision.`,
  });
}

export async function handleAcceptButton(interaction) {
  if (!hasReviewerRole(interaction)) {
    return interaction.reply({ content: '❌ Vous n\'avez pas le rôle requis pour valider une candidature.', ephemeral: true });
  }

  const messageId = interaction.customId.split(':')[1];
  const decision  = getDecision(messageId);

  if (decision.status === 'accepted') {
    return interaction.reply({ content: '⚠️ Cette candidature a déjà été acceptée.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const updatedButtons = buildDecisionButtons(messageId, 'accepted');
    await interaction.message.edit({ components: [updatedButtons] });
  } catch (e) {
    error('[Candidature] Erreur mise à jour boutons:', e);
  }

  const existing = getDecision(messageId);
  setDecision(messageId, {
    ...existing,
    status:     'accepted',
    decidedBy:  interaction.user.id,
    decidedAt:  Date.now(),
  });

  const cfg        = getCandidatureConfig(interaction.guild.id);
  const districtKey = existing.districtKey;

  try {
    const member = await interaction.guild.members.fetch(existing.candidateId).catch(() => null);
    if (member) {
      if (cfg.districts[districtKey]?.acceptedRoleId) {
        await member.roles.add(cfg.districts[districtKey].acceptedRoleId).catch(() => null);
      }
      if (cfg.globalRefusedRoleId) {
        await member.roles.remove(cfg.globalRefusedRoleId).catch(() => null);
      }
    }
  } catch (e) {
    error('[Candidature] Erreur attribution rôles accept:', e);
  }

  const resultId = cfg.districts[districtKey]?.resultChannelId;

  if (resultId) {
    try {
      const resultChannel = await interaction.client.channels.fetch(resultId);
      const districtName  = DISTRICTS[districtKey] ?? districtKey;
      const gif           = DISTRICT_GIFS[districtKey]?.accepted;

      const embed = new EmbedBuilder()
        .setTitle(`✅ Candidature Acceptée — ${districtName}`)
        .setColor(0x2ecc71)
        .setDescription(`Le dossier de <@${existing.candidateId}> a été retenu.\n\n**Instructions :**\nVeuillez lire attentivement les salons pour passer votre entretien.`)
        .addFields(
          { name: 'Candidat',   value: `<@${existing.candidateId}>`, inline: true },
          { name: 'District',   value: districtName,                 inline: true },
        )
        .setFooter({ text: `San Andreas Police Academy | Recruteur : ${interaction.member?.displayName || interaction.user.displayName}`, iconURL: LOGO_PA })
        .setTimestamp();

      if (gif) embed.setImage(gif);

      const sentResultMsg = await resultChannel.send({ content: `<@${existing.candidateId}>`, embeds: [embed] });
      const cur = getDecision(messageId);
      setDecision(messageId, { ...cur, resultMessageId: sentResultMsg.id, resultChannelId: resultId });
    } catch (e) {
      error('[Candidature] Erreur envoi résultat Accept:', e);
    }
  }

  try {
    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
    const districtName = DISTRICTS[existing.districtKey] ?? existing.districtKey;
    originalEmbed.setColor(0x2ecc71);
    originalEmbed.setFooter({
      text: `FlashBack FA • Candidature Police • ${districtName} • ✅ Acceptée par ${interaction.member?.displayName || interaction.user.displayName}`,
    });
    await interaction.message.edit({ embeds: [originalEmbed] });
  } catch { }

  return interaction.editReply({ content: '✅ Candidature acceptée.' });
}

export async function handleRefuseButton(interaction) {
  if (!hasReviewerRole(interaction)) {
    return interaction.reply({ content: '❌ Vous n\'avez pas le rôle requis pour refuser une candidature.', ephemeral: true });
  }

  const messageId = interaction.customId.split(':')[1];
  const decision  = getDecision(messageId);

  if (decision.status === 'refused') {
    return interaction.reply({ content: '⚠️ Cette candidature a déjà été refusée.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_cand_refuse:${messageId}`)
    .setTitle('Motif de refus');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cand_refuse_reason')
        .setLabel('Motif du refus')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Expliquez la raison du refus...')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(500)
    ),
  );

  return interaction.showModal(modal);
}

export async function handleRefuseModal(interaction) {
  const messageId = interaction.customId.split(':')[1];
  const reason    = interaction.fields.getTextInputValue('cand_refuse_reason').trim();

  await interaction.deferReply({ ephemeral: true });

  const existing = getDecision(messageId);

  try {
    const updatedButtons = buildDecisionButtons(messageId, 'refused');
    await interaction.message.edit({ components: [updatedButtons] });
  } catch (e) {
    error('[Candidature] Erreur mise à jour boutons refus:', e);
  }

  setDecision(messageId, {
    ...existing,
    status:    'refused',
    reason,
    decidedBy: interaction.user.id,
    decidedAt: Date.now(),
  });

  try {
    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
    const districtName = DISTRICTS[existing.districtKey] ?? existing.districtKey;
    originalEmbed.setColor(0xe74c3c);
    originalEmbed.setFooter({
      text: `FlashBack FA • Candidature Police • ${districtName} • ❌ Refusée par ${interaction.member?.displayName || interaction.user.displayName}`,
    });
    await interaction.message.edit({ embeds: [originalEmbed] });
  } catch { }

  const cfg       = getCandidatureConfig(interaction.guild.id);
  const districtKey = existing.districtKey;

  try {
    const member = await interaction.guild.members.fetch(existing.candidateId).catch(() => null);
    if (member) {
      if (cfg.globalRefusedRoleId) {
        await member.roles.add(cfg.globalRefusedRoleId).catch(() => null);
      }
      if (cfg.districts[districtKey]?.acceptedRoleId) {
        await member.roles.remove(cfg.districts[districtKey].acceptedRoleId).catch(() => null);
      }
    }
  } catch (e) {
    error('[Candidature] Erreur attribution rôles refus:', e);
  }

  const resultId = cfg.districts[districtKey]?.resultChannelId;

  if (resultId) {
    try {
      const resultChannel = await interaction.client.channels.fetch(resultId);
      const districtName  = DISTRICTS[districtKey] ?? districtKey;
      const gif           = DISTRICT_GIFS[districtKey]?.refused;
      const unlockDate    = Math.floor((Date.now() + 48 * 60 * 60 * 1000) / 1000);

      const embed = new EmbedBuilder()
        .setTitle(`❌ Candidature Refusée — ${districtName}`)
        .setColor(0xe74c3c)
        .setDescription(`Le dossier de <@${existing.candidateId}> n'a pas été retenu.\n\nVous êtes invité à réessayer dans deux jours. Votre compte pourra à nouveau postuler le **<t:${unlockDate}:f>**.\n\n**Motif** : ${reason}`)
        .addFields(
          { name: 'Candidat',    value: `<@${existing.candidateId}>`, inline: true  },
          { name: 'District',    value: districtName,                  inline: true  },
        )
        .setFooter({ text: `San Andreas Police Academy | Recruteur : ${interaction.member?.displayName || interaction.user.displayName}`, iconURL: LOGO_PA })
        .setTimestamp();

      if (gif) embed.setImage(gif);

      const sentResultMsg = await resultChannel.send({ content: `<@${existing.candidateId}>`, embeds: [embed] });
      const cur = getDecision(messageId);
      setDecision(messageId, { ...cur, resultMessageId: sentResultMsg.id, resultChannelId: resultId });
    } catch (e) {
      error('[Candidature] Erreur envoi résultat Refus:', e);
    }
  }

  return interaction.editReply({ content: '✅ Candidature refusée. Le motif a été enregistré.' });
}

export async function handleViewReasonButton(interaction) {
  const messageId = interaction.customId.split(':')[1];
  const decision  = getDecision(messageId);

  if (decision.status === 'pending') {
    return interaction.reply({
      content: '⚠️ Aucune décision n\'a encore été prise pour cette candidature.',
      ephemeral: true,
    });
  }

  if (decision.status === 'accepted') {
    return interaction.reply({
      content: `✅ Cette candidature a été **acceptée** par <@${decision.decidedBy}>.`,
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📋 Motif de refus')
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

export async function handleRevertButton(interaction) {
  if (!hasReviewerRole(interaction)) {
    return interaction.reply({ content: '❌ Vous n\'avez pas le rôle requis pour annuler une décision.', ephemeral: true });
  }

  const messageId = interaction.customId.split(':')[1];
  const decision  = getDecision(messageId);

  if (decision.status === 'pending') {
    return interaction.reply({
      content: '⚠️ Cette candidature est déjà en attente de décision.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const updatedButtons = buildDecisionButtons(messageId, 'pending');
    const existingEmbed  = EmbedBuilder.from(interaction.message.embeds[0]);
    const distKey        = decision.districtKey;
    const originalColor  = DISTRICT_COLORS[distKey] ?? 0x2c3e50;
    const districtName   = DISTRICTS[distKey] ?? distKey;

    existingEmbed.setColor(originalColor);
    existingEmbed.setFooter({
      text: `FlashBack FA • Candidature Police • ${districtName}`,
    });

    await interaction.message.edit({
      embeds:     [existingEmbed],
      components: [updatedButtons],
    });
  } catch (e) {
    error('[Candidature] Erreur revert:', e);
  }

  try {
    const cfg = getCandidatureConfig(interaction.guild.id);
    const member = await interaction.guild.members.fetch(decision.candidateId).catch(() => null);

    if (member) {
      if (decision.status === 'accepted' && cfg.districts[decision.districtKey]?.acceptedRoleId) {
        await member.roles.remove(cfg.districts[decision.districtKey].acceptedRoleId).catch(() => null);
      }
      if (decision.status === 'refused' && cfg.globalRefusedRoleId) {
        await member.roles.remove(cfg.globalRefusedRoleId).catch(() => null);
      }
    }
  } catch (e) {
    error('[Candidature] Erreur retrait rôles sur revert:', e);
  }

  if (decision.resultMessageId && decision.resultChannelId) {
    try {
      const resultCh  = await interaction.client.channels.fetch(decision.resultChannelId);
      const resultMsg = await resultCh.messages.fetch(decision.resultMessageId);
      await resultMsg.delete();
    } catch { }
  }

  setDecision(messageId, {
    ...decision,
    status:          'pending',
    reason:          null,
    decidedBy:       null,
    decidedAt:       null,
    resultMessageId: null,
    resultChannelId: null,
    revertedBy:      interaction.user.id,
  });

  return interaction.editReply({ content: '✅ La décision a été annulée. La candidature est à nouveau en attente.' });
}

export async function handleConfigCandidature(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Réservé aux administrateurs du bot.',
      ephemeral: true,
    });
  }

  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'show') {
    const cfg   = getCandidatureConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`📋 Configuration Candidatures — ${interaction.guild.name}`)
      .setColor(0x2c3e50)
      .setTimestamp();

    for (const [key, name] of Object.entries(DISTRICTS)) {
      const d    = cfg.districts[key];
      const appCh = d.applicationChannelId ? `<#${d.applicationChannelId}>` : '❌';
      const resCh = d.resultChannelId      ? `<#${d.resultChannelId}>`      : '❌';
      const role  = d.acceptedRoleId       ? `<@&${d.acceptedRoleId}>`      : '❌';
      embed.addFields({
        name:  `**${name}**`,
        value: `📥 Candidatures: ${appCh}\n📤 Résultats: ${resCh}\n🎖️ Rôle Accept: ${role}`,
        inline: false,
      });
    }

    const reviewerIds = cfg.reviewerRoleIds ?? [];
    const reviewerVal = reviewerIds.length > 0
      ? reviewerIds.map(id => `<@&${id}>`).join(', ')
      : '*(aucun — tout le monde peut décider)*';

    embed.addFields({
      name:  '**Recruteurs (Accepter / Refuser)**',
      value: reviewerVal,
      inline: false,
    });

    if (cfg.globalRefusedRoleId) {
      embed.addFields({ name: '**Défaut Global**', value: `Rôle Refus: <@&${cfg.globalRefusedRoleId}>` });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'add-reviewer-role') {
    const role = interaction.options.getRole('role', true);
    const added = addReviewerRole(guildId, role.id);
    return interaction.reply({
      content: added
        ? `✅ ${role} ajouté comme rôle recruteur. Les membres avec ce rôle peuvent valider/refuser les candidatures.`
        : `⚠️ ${role} est déjà dans la liste des rôles recruteurs.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-reviewer-role') {
    const role = interaction.options.getRole('role', true);
    const removed = removeReviewerRole(guildId, role.id);
    return interaction.reply({
      content: removed
        ? `✅ ${role} retiré des rôles recruteurs.`
        : `⚠️ ${role} n'était pas dans la liste des rôles recruteurs.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-role-refused') {
    const roleId = interaction.options.getRole('role').id;
    setGlobalRefusedRole(guildId, roleId);
    return interaction.reply({ content: `✅ Le rôle attribué lors d'un **refus** a été défini sur <@&${roleId}>.`, ephemeral: true });
  }

  if (sub === 'set-role-accepted') {
    const districtKey = interaction.options.getString('district', true);
    const roleId = interaction.options.getRole('role').id;
    setAcceptedRole(guildId, districtKey, roleId);
    return interaction.reply({ content: `✅ Le rôle attribué lors d'une **acceptation** pour **${DISTRICTS[districtKey]}** est <@&${roleId}>.`, ephemeral: true });
  }

  if (sub === 'set-application' || sub === 'set-result') {
    const districtKey = interaction.options.getString('district', true);
    const channelId   = interaction.options.getString('channel-id', true).trim();

    if (!DISTRICTS[districtKey]) {
      return interaction.reply({ content: '❌ District invalide.', ephemeral: true });
    }

    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) {
        return interaction.reply({ content: '❌ Salon invalide ou introuvable (doit être un salon textuel).', ephemeral: true });
      }
    } catch {
      return interaction.reply({ content: '❌ Impossible de trouver ce salon.', ephemeral: true });
    }

    if (sub === 'set-application') {
      setApplicationChannel(guildId, districtKey, channelId);
      return interaction.reply({
        content: `✅ Salon de **candidatures** pour **${DISTRICTS[districtKey]}** défini sur <#${channelId}>`,
        ephemeral: true,
      });
    }

    if (sub === 'set-result') {
      setResultChannel(guildId, districtKey, channelId);
      return interaction.reply({
        content: `✅ Salon de **résultats** pour **${DISTRICTS[districtKey]}** défini sur <#${channelId}>`,
        ephemeral: true,
      });
    }
  }
}
