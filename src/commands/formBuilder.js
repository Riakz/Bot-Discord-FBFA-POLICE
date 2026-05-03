import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import {
  getForm,
  getAllForms,
  createForm,
  updateForm,
  deleteForm,
  addQuestion,
  removeQuestion,
  setCooldown,
  getCooldownRemaining,
} from '../utils/customForms.js';
import { isBlacklisted } from '../utils/blacklistManager.js';

// ─── Admin slash handler ──────────────────────────────────────────────────────

export async function handleFormBuilder(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  // ── create ──
  if (sub === 'create') {
    const modal = new ModalBuilder()
      .setCustomId('cform_create_modal')
      .setTitle('Créer un formulaire');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('form_title')
          .setLabel('Titre du formulaire')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Formulaire de recrutement')
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('form_open_message')
          .setLabel('Message d\'ouverture (affiché sur le panel)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Ex: Remplissez ce formulaire pour postuler.')
          .setRequired(false)
          .setMaxLength(2000)
      ),
    );
    return interaction.showModal(modal);
  }

  // ── add-question ──
  if (sub === 'add-question') {
    const formId = interaction.options.getString('form-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    if (form.questions.length >= 5) return interaction.reply({ content: '❌ Maximum 5 questions par formulaire.', ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId(`cform_add_question:${formId}`)
      .setTitle('Ajouter une question');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q_label')
          .setLabel('Question (label du champ)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Quel est votre nom RP ?')
          .setRequired(true)
          .setMaxLength(45)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q_placeholder')
          .setLabel('Texte indicatif (optionnel)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: Prénom Nom')
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q_long')
          .setLabel('Réponse longue ? (oui / non)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('non')
          .setRequired(false)
          .setMaxLength(3)
      ),
    );
    return interaction.showModal(modal);
  }

  // ── remove-question ──
  if (sub === 'remove-question') {
    const formId = interaction.options.getString('form-id', true).trim();
    const index = interaction.options.getInteger('index', true) - 1;
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    try {
      removeQuestion(formId, index);
      return interaction.reply({ content: `✅ Question #${index + 1} supprimée.`, ephemeral: true });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
  }

  // ── set-reception ──
  if (sub === 'set-reception') {
    const formId = interaction.options.getString('form-id', true).trim();
    const channelId = interaction.options.getString('channel-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    try {
      const ch = await interaction.guild.channels.fetch(channelId);
      if (!ch?.isTextBased()) return interaction.reply({ content: '❌ Salon introuvable ou invalide.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Salon introuvable.', ephemeral: true });
    }
    updateForm(formId, { receptionChannelId: channelId });
    return interaction.reply({ content: `✅ Salon de réception défini sur <#${channelId}>.`, ephemeral: true });
  }

  // ── add-examiner-role ──
  if (sub === 'add-examiner-role') {
    const formId = interaction.options.getString('form-id', true).trim();
    const role = interaction.options.getRole('role', true);
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    if (form.examinerRoleIds.includes(role.id)) return interaction.reply({ content: '⚠️ Ce rôle est déjà examinateur.', ephemeral: true });
    updateForm(formId, { examinerRoleIds: [...form.examinerRoleIds, role.id] });
    return interaction.reply({ content: `✅ Rôle <@&${role.id}> ajouté comme examinateur.`, ephemeral: true });
  }

  // ── remove-examiner-role ──
  if (sub === 'remove-examiner-role') {
    const formId = interaction.options.getString('form-id', true).trim();
    const role = interaction.options.getRole('role', true);
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    const updated = form.examinerRoleIds.filter(id => id !== role.id);
    if (updated.length === form.examinerRoleIds.length) return interaction.reply({ content: '⚠️ Ce rôle n\'est pas examinateur.', ephemeral: true });
    updateForm(formId, { examinerRoleIds: updated });
    return interaction.reply({ content: `✅ Rôle <@&${role.id}> retiré des examinateurs.`, ephemeral: true });
  }

  // ── set-cooldown ──
  if (sub === 'set-cooldown') {
    const formId = interaction.options.getString('form-id', true).trim();
    const hours = interaction.options.getInteger('hours', true);
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    updateForm(formId, { cooldownHours: hours });
    return interaction.reply({ content: `✅ Cooldown défini à **${hours}h** pour ce formulaire.`, ephemeral: true });
  }

  // ── toggle-blacklist ──
  if (sub === 'toggle-blacklist') {
    const formId = interaction.options.getString('form-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    const newVal = !form.checkBlacklist;
    updateForm(formId, { checkBlacklist: newVal });
    return interaction.reply({ content: `✅ Vérification blacklist ${newVal ? '**activée**' : '**désactivée**'}.`, ephemeral: true });
  }

  // ── set-color ──
  if (sub === 'set-color') {
    const formId = interaction.options.getString('form-id', true).trim();
    const hex = interaction.options.getString('color', true).trim().replace(/^#/, '');
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    const color = parseInt(hex, 16);
    if (isNaN(color) || color < 0 || color > 0xFFFFFF) return interaction.reply({ content: '❌ Couleur invalide (ex: `3498db`).', ephemeral: true });
    updateForm(formId, { embedColor: color });
    return interaction.reply({ content: `✅ Couleur de l'embed définie sur \`#${hex}\`.`, ephemeral: true });
  }

  // ── publish ──
  if (sub === 'publish') {
    const formId = interaction.options.getString('form-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });
    if (form.questions.length === 0) return interaction.reply({ content: '❌ Ajoutez au moins une question avant de publier.', ephemeral: true });
    if (!form.receptionChannelId) return interaction.reply({ content: '❌ Définissez d\'abord un salon de réception (`set-reception`).', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(form.title)
      .setDescription(form.openMessage)
      .setColor(form.embedColor);

    const button = new ButtonBuilder()
      .setCustomId(`cform_apply:${formId}`)
      .setLabel('Postuler')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋');

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.deferReply({ ephemeral: true });
    try {
      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
      updateForm(formId, { panelMessageId: msg.id, panelChannelId: interaction.channel.id });
      return interaction.editReply({ content: `✅ Formulaire publié dans ce salon.` });
    } catch (e) {
      error('[FormBuilder] Erreur publication:', e);
      return interaction.editReply({ content: `❌ Erreur lors de la publication: ${e.message}` });
    }
  }

  // ── list ──
  if (sub === 'list') {
    const forms = getAllForms(guildId);
    const entries = Object.values(forms);
    if (entries.length === 0) return interaction.reply({ content: '📋 Aucun formulaire configuré.', ephemeral: true });
    const lines = entries.map(f =>
      `**\`${f.id}\`** — ${f.title}\n` +
      `Questions: ${f.questions.length}/5 | Réception: ${f.receptionChannelId ? `<#${f.receptionChannelId}>` : '❌'} | Cooldown: ${f.cooldownHours}h | BL: ${f.checkBlacklist ? '✅' : '❌'}`
    );
    const embed = new EmbedBuilder()
      .setTitle('📋 Formulaires configurés')
      .setColor(0x3498db)
      .setDescription(lines.join('\n\n'))
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── show ──
  if (sub === 'show') {
    const formId = interaction.options.getString('form-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });

    const qList = form.questions.length > 0
      ? form.questions.map((q, i) => `**${i + 1}.** ${q.label}${q.placeholder ? ` *(${q.placeholder})*` : ''} — ${q.long ? 'Longue' : 'Courte'}`).join('\n')
      : '_Aucune question_';

    const examList = form.examinerRoleIds.length > 0
      ? form.examinerRoleIds.map(id => `<@&${id}>`).join(', ')
      : '_Aucun_';

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${form.title}`)
      .setColor(form.embedColor)
      .addFields(
        { name: 'ID', value: `\`${form.id}\``, inline: true },
        { name: 'Cooldown', value: `${form.cooldownHours}h`, inline: true },
        { name: 'Vérif. Blacklist', value: form.checkBlacklist ? '✅ Oui' : '❌ Non', inline: true },
        { name: 'Réception', value: form.receptionChannelId ? `<#${form.receptionChannelId}>` : '❌ Non défini', inline: true },
        { name: 'Panel publié', value: form.panelChannelId ? `<#${form.panelChannelId}>` : '❌ Non publié', inline: true },
        { name: 'Examinateurs', value: examList, inline: false },
        { name: `Questions (${form.questions.length}/5)`, value: qList, inline: false },
        { name: 'Message d\'ouverture', value: form.openMessage || '_Non défini_', inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── delete ──
  if (sub === 'delete') {
    const formId = interaction.options.getString('form-id', true).trim();
    const form = getForm(formId);
    if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });
    if (form.guildId !== guildId) return interaction.reply({ content: '❌ Ce formulaire appartient à un autre serveur.', ephemeral: true });

    if (form.panelChannelId && form.panelMessageId) {
      try {
        const ch = await interaction.client.channels.fetch(form.panelChannelId);
        const msg = await ch.messages.fetch(form.panelMessageId);
        await msg.delete();
      } catch { }
    }

    deleteForm(formId);
    return interaction.reply({ content: `✅ Formulaire \`${formId}\` supprimé.`, ephemeral: true });
  }
}

// ─── Modal submit: create form ────────────────────────────────────────────────

export async function handleFormCreateModal(interaction) {
  const title = interaction.fields.getTextInputValue('form_title').trim();
  const openMessage = interaction.fields.getTextInputValue('form_open_message').trim();
  const guildId = interaction.guild.id;

  const formId = createForm(guildId, {
    title,
    openMessage: openMessage || 'Remplissez le formulaire ci-dessous.',
    createdBy: interaction.user.id,
  });

  return interaction.reply({
    content: `✅ Formulaire créé !\n**ID :** \`${formId}\`\n\nProchaines étapes :\n1. Ajouter des questions : \`/form-builder add-question form-id:${formId}\`\n2. Définir le salon de réception : \`/form-builder set-reception form-id:${formId}\`\n3. Publier : \`/form-builder publish form-id:${formId}\``,
    ephemeral: true,
  });
}

// ─── Modal submit: add question ───────────────────────────────────────────────

export async function handleFormAddQuestionModal(interaction) {
  const formId = interaction.customId.split(':')[1];
  const form = getForm(formId);
  if (!form) return interaction.reply({ content: '❌ Formulaire introuvable.', ephemeral: true });

  const label = interaction.fields.getTextInputValue('q_label').trim();
  const placeholder = interaction.fields.getTextInputValue('q_placeholder').trim();
  const longRaw = interaction.fields.getTextInputValue('q_long').trim().toLowerCase();
  const long = longRaw === 'oui' || longRaw === 'yes' || longRaw === 'true';

  try {
    const count = addQuestion(formId, { label, placeholder: placeholder || null, long });
    return interaction.reply({ content: `✅ Question ${count}/5 ajoutée : **${label}**`, ephemeral: true });
  } catch (e) {
    return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
  }
}

// ─── Button: cform_apply:formId ───────────────────────────────────────────────

export async function handleFormApply(interaction) {
  const formId = interaction.customId.split(':')[1];
  const form = getForm(formId);

  if (!form) {
    return interaction.reply({ content: '❌ Ce formulaire n\'existe plus.', ephemeral: true });
  }
  if (form.questions.length === 0) {
    return interaction.reply({ content: '❌ Ce formulaire n\'a pas encore de questions configurées.', ephemeral: true });
  }

  // Blacklist check
  if (form.checkBlacklist && isBlacklisted(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: '⛔ Vous êtes blacklisté et ne pouvez pas soumettre ce formulaire.', ephemeral: true });
  }

  // Cooldown check
  const remaining = getCooldownRemaining(formId, interaction.user.id, form.cooldownHours);
  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return interaction.reply({
      content: `⏳ Vous devez attendre encore **${hours}h ${minutes}min** avant de soumettre à nouveau ce formulaire.`,
      ephemeral: true,
    });
  }

  // Build modal with questions
  const modal = new ModalBuilder()
    .setCustomId(`cform_modal:${formId}`)
    .setTitle(form.title.slice(0, 45));

  for (const q of form.questions) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label.slice(0, 45))
          .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setPlaceholder(q.placeholder ? q.placeholder.slice(0, 100) : '')
          .setRequired(true)
          .setMaxLength(q.long ? 1000 : 256)
      )
    );
  }

  return interaction.showModal(modal);
}

// ─── Modal submit: cform_modal:formId ────────────────────────────────────────

export async function handleFormSubmit(interaction) {
  const formId = interaction.customId.split(':')[1];
  const form = getForm(formId);

  if (!form) {
    return interaction.reply({ content: '❌ Ce formulaire n\'existe plus.', ephemeral: true });
  }

  // Re-check blacklist/cooldown at submit time (prevent race)
  if (form.checkBlacklist && isBlacklisted(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: '⛔ Vous êtes blacklisté et ne pouvez pas soumettre ce formulaire.', ephemeral: true });
  }
  const remaining = getCooldownRemaining(formId, interaction.user.id, form.cooldownHours);
  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return interaction.reply({
      content: `⏳ Vous devez attendre encore **${hours}h ${minutes}min** avant de soumettre à nouveau ce formulaire.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!form.receptionChannelId) {
      return interaction.editReply({ content: '❌ Aucun salon de réception configuré pour ce formulaire.' });
    }

    const receptionChannel = await interaction.client.channels.fetch(form.receptionChannelId).catch(() => null);
    if (!receptionChannel?.isTextBased()) {
      return interaction.editReply({ content: '❌ Le salon de réception est introuvable ou invalide.' });
    }

    // Collect answers
    const answers = form.questions.map(q => ({
      label: q.label,
      value: interaction.fields.getTextInputValue(q.id) || '—',
    }));

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const displayName = member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
    const candidatLine = `<@${interaction.user.id}> — ${displayName} (\`${interaction.user.username}\`)`;

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${form.title}`)
      .setColor(form.embedColor)
      .addFields(
        ...answers.map(a => ({ name: a.label, value: a.value.slice(0, 1024), inline: false })),
        { name: 'Candidat', value: candidatLine, inline: false },
      )
      .setFooter({ text: `User ID: ${interaction.user.id}` })
      .setTimestamp();

    const mentionParts = [`<@${interaction.user.id}>`];
    if (form.examinerRoleIds.length > 0) mentionParts.push(...form.examinerRoleIds.map(id => `<@&${id}>`));

    await receptionChannel.send({
      content: mentionParts.join(' '),
      embeds: [embed],
    });

    // Set cooldown after successful send
    setCooldown(formId, interaction.user.id);

    return interaction.editReply({ content: `✅ Votre formulaire a bien été soumis !` });
  } catch (e) {
    error('[FormBuilder] Erreur soumission:', e);
    return interaction.editReply({ content: `❌ Une erreur est survenue lors de la soumission.` });
  }
}
