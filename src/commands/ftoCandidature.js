import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
} from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import { isBlacklisted } from '../utils/blacklistManager.js';
import { getCooldownRemaining, setCooldown } from '../utils/customForms.js';
import {
  getFtoConfig,
  setCandReceptionChannel,
  setCandPanelInfo,
  addCandExaminerRole,
  removeCandExaminerRole,
  setCandCooldown,
  toggleCandBlacklist,
} from '../utils/ftoConfig.js';

// customId fictif pour le cooldown (réutilise le système existant)
const COOLDOWN_KEY = '__fto_candidature__';

// Stockage temporaire des réponses Part 1 en mémoire
// key: userId, value: { guildId, matricule, grade, motivation, ts }
const part1Store = new Map();

// Nettoyage des entrées orphelines (> 15 min)
setInterval(() => {
  const limit = Date.now() - 15 * 60 * 1000;
  for (const [uid, data] of part1Store) {
    if (data.ts < limit) part1Store.delete(uid);
  }
}, 5 * 60 * 1000);

// ─── /config-fto subcommands candidature ─────────────────────────────────────

export async function handleFtoCandidatureConfig(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const cfg = getFtoConfig(guildId);

  if (sub === 'set-cand-reception') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      // client.channels.fetch permet un salon sur un autre serveur
      const ch = await interaction.client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return interaction.reply({ content: '❌ Salon invalide.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Salon introuvable (vérifiez que le bot est bien dans le serveur cible).', ephemeral: true });
    }
    setCandReceptionChannel(guildId, channelId);
    return interaction.reply({ content: `✅ Salon de réception candidatures FTO → <#${channelId}>.`, ephemeral: true });
  }

  if (sub === 'add-cand-examiner') {
    const role = interaction.options.getRole('role', true);
    const added = addCandExaminerRole(guildId, role.id);
    return interaction.reply({
      content: added ? `✅ Rôle <@&${role.id}> ajouté aux examinateurs FTO.` : `⚠️ Ce rôle est déjà examinateur.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-cand-examiner') {
    const role = interaction.options.getRole('role', true);
    const removed = removeCandExaminerRole(guildId, role.id);
    return interaction.reply({
      content: removed ? `✅ Rôle <@&${role.id}> retiré.` : `⚠️ Ce rôle n'est pas examinateur.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-cand-cooldown') {
    const hours = interaction.options.getInteger('hours', true);
    setCandCooldown(guildId, hours);
    return interaction.reply({ content: `✅ Cooldown candidature FTO : **${hours}h**.`, ephemeral: true });
  }

  if (sub === 'toggle-cand-blacklist') {
    const newVal = toggleCandBlacklist(guildId);
    return interaction.reply({ content: `✅ Vérification blacklist ${newVal ? '**activée**' : '**désactivée**'}.`, ephemeral: true });
  }

  if (sub === 'publish-cand') {
    if (!cfg.candReceptionChannelId) {
      return interaction.reply({ content: '❌ Définissez d\'abord le salon de réception (`set-cand-reception`).', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Field Training Operations')
      .setDescription('Vous souhaitez rejoindre le **F.T.O.** ?\nCliquez sur le bouton ci-dessous pour soumettre votre candidature.')
      .setColor(0x3498db);

    const button = new ButtonBuilder()
      .setCustomId('ftocand_start')
      .setLabel('Candidater')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋');

    await interaction.deferReply({ ephemeral: true });
    try {
      const msg = await interaction.channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(button)],
      });
      setCandPanelInfo(guildId, interaction.channel.id, msg.id);
      return interaction.editReply({ content: '✅ Panel FTO publié.' });
    } catch (e) {
      error('[FTOCand] Erreur publication:', e);
      return interaction.editReply({ content: `❌ Erreur: ${e.message}` });
    }
  }

  if (sub === 'show-cand') {
    const examiners = cfg.candExaminerRoleIds.length > 0
      ? cfg.candExaminerRoleIds.map(id => `<@&${id}>`).join(', ')
      : '_Aucun_';
    const embed = new EmbedBuilder()
      .setTitle('📋 Config Candidature FTO')
      .setColor(0x3498db)
      .addFields(
        { name: 'Réception', value: cfg.candReceptionChannelId ? `<#${cfg.candReceptionChannelId}>` : '❌ Non défini', inline: true },
        { name: 'Cooldown', value: `${cfg.candCooldownHours}h`, inline: true },
        { name: 'Vérif. Blacklist', value: cfg.candCheckBlacklist ? '✅' : '❌', inline: true },
        { name: 'Examinateurs', value: examiners, inline: false },
        { name: 'Panel publié', value: cfg.candPanelChannelId ? `<#${cfg.candPanelChannelId}>` : '❌ Non publié', inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

// ─── Bouton : ftocand_start ───────────────────────────────────────────────────

export async function handleFtoCandStart(interaction) {
  const cfg = getFtoConfig(interaction.guild.id);

  if (cfg.candCheckBlacklist && isBlacklisted(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: '⛔ Vous êtes blacklisté et ne pouvez pas soumettre une candidature.', ephemeral: true });
  }

  const remaining = getCooldownRemaining(COOLDOWN_KEY, interaction.user.id, cfg.candCooldownHours);
  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return interaction.reply({
      content: `⏳ Vous devez attendre encore **${hours}h ${minutes}min** avant de postuler à nouveau.`,
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('ftocand_part1')
    .setTitle('Candidature FTO — Partie 1/2');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('matricule')
        .setLabel('🆔 Matricule')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: 107 | DUPONT Jean')
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('grade')
        .setLabel('⭐ Grade')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Officier 3')
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('motivation')
        .setLabel('🎯 Motivation')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Pourquoi souhaitez-vous rejoindre la FTO ?')
        .setRequired(true)
        .setMaxLength(1000)
    ),
  );

  return interaction.showModal(modal);
}

// ─── Modal Part 1 : ftocand_part1 ────────────────────────────────────────────

export async function handleFtoCandPart1(interaction) {
  const matricule  = interaction.fields.getTextInputValue('matricule').trim();
  const grade      = interaction.fields.getTextInputValue('grade').trim();
  const motivation = interaction.fields.getTextInputValue('motivation').trim();

  part1Store.set(interaction.user.id, { guildId: interaction.guild.id, matricule, grade, motivation, ts: Date.now() });

  const button = new ButtonBuilder()
    .setCustomId('ftocand_continue')
    .setLabel('Continuer →')
    .setStyle(ButtonStyle.Primary);

  return interaction.reply({
    content: '✅ Partie 1 enregistrée. Cliquez sur **Continuer** pour remplir la suite.',
    components: [new ActionRowBuilder().addComponents(button)],
    ephemeral: true,
  });
}

// ─── Bouton : ftocand_continue ────────────────────────────────────────────────

export async function handleFtoCandContinue(interaction) {
  if (!part1Store.has(interaction.user.id)) {
    return interaction.reply({
      content: '❌ Session expirée. Merci de recommencer depuis le bouton "Candidater".',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('ftocand_part2')
    .setTitle('Candidature FTO — Partie 2/2');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('apport')
        .setLabel('👨‍🏫 Apport comme formateur')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Qu\'apporteriez-vous en tant que formateur ?')
        .setRequired(true)
        .setMaxLength(1000)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('formations')
        .setLabel('📚 Formations demandées')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ex: PPA, Radio, Procédures...')
        .setRequired(true)
        .setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('disponibilites')
        .setLabel('🕒 Disponibilités')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ex: Tous les jours de 17h à 4h')
        .setRequired(true)
        .setMaxLength(300)
    ),
  );

  return interaction.showModal(modal);
}

// ─── Modal Part 2 : ftocand_part2 ────────────────────────────────────────────

export async function handleFtoCandPart2(interaction) {
  const part1 = part1Store.get(interaction.user.id);
  if (!part1) {
    return interaction.reply({
      content: '❌ Session expirée. Merci de recommencer depuis le bouton.',
      ephemeral: true,
    });
  }
  part1Store.delete(interaction.user.id);

  const cfg = getFtoConfig(part1.guildId);

  // Re-check blacklist & cooldown
  if (cfg.candCheckBlacklist && isBlacklisted(part1.guildId, interaction.user.id)) {
    return interaction.reply({ content: '⛔ Vous êtes blacklisté.', ephemeral: true });
  }
  const remaining = getCooldownRemaining(COOLDOWN_KEY, interaction.user.id, cfg.candCooldownHours);
  if (remaining > 0) {
    return interaction.reply({ content: '⏳ Cooldown actif, veuillez patienter.', ephemeral: true });
  }

  if (!cfg.candReceptionChannelId) {
    return interaction.reply({ content: '❌ Aucun salon de réception configuré.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const apport        = interaction.fields.getTextInputValue('apport').trim();
    const formations    = interaction.fields.getTextInputValue('formations').trim();
    const disponibilites = interaction.fields.getTextInputValue('disponibilites').trim();

    const receptionCh = await interaction.client.channels.fetch(cfg.candReceptionChannelId).catch(() => null);
    if (!receptionCh?.isTextBased()) {
      return interaction.editReply({ content: '❌ Salon de réception introuvable.' });
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const embed = new EmbedBuilder()
      .setTitle('NOUVELLE CANDIDATURE FTO')
      .setColor(0xe67e22)
      .addFields(
        { name: '🆔 Matricule', value: part1.matricule, inline: true },
        { name: '⭐ Grade',     value: part1.grade,      inline: true },
        { name: '🎯 Motivation',           value: part1.motivation,  inline: false },
        { name: '👨‍🏫 Apport comme formateur', value: apport,         inline: false },
        { name: '📚 Formations demandées',  value: formations,        inline: false },
        { name: '🕒 Disponibilités',        value: disponibilites,    inline: false },
      )
      .setFooter({ text: `Candidature reçue le ${dateStr}` });

    const mentionParts = [`<@${interaction.user.id}>`];
    if (cfg.candExaminerRoleIds.length > 0) {
      mentionParts.push(...cfg.candExaminerRoleIds.map(id => `<@&${id}>`));
    }

    await receptionCh.send({ content: mentionParts.join(' '), embeds: [embed] });

    setCooldown(COOLDOWN_KEY, interaction.user.id);

    return interaction.editReply({ content: '✅ Votre candidature FTO a bien été soumise !' });
  } catch (e) {
    error('[FTOCand] Erreur soumission:', e);
    return interaction.editReply({ content: '❌ Une erreur est survenue lors de la soumission.' });
  }
}
