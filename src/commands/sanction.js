import { EmbedBuilder, PermissionsBitField, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import {
  getSanctionConfig,
  setSourceChannel,
  setCategory,
  setContestationText,
  setFooterText,
  addStaffRole,
  removeStaffRole,
  addStaffUser,
  removeStaffUser,
  getAllSanctionConfigs,
} from '../utils/sanctionConfig.js';

// ─── Config slash handler ─────────────────────────────────────────────────────

export async function handleConfigSanction(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'set-source') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      const ch = await interaction.guild.channels.fetch(channelId);
      if (!ch?.isTextBased()) return interaction.reply({ content: '❌ Salon invalide.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Salon introuvable.', ephemeral: true });
    }
    setSourceChannel(guildId, channelId);
    return interaction.reply({ content: `✅ Salon source défini sur <#${channelId}>.`, ephemeral: true });
  }

  if (sub === 'set-category') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      const cat = await interaction.guild.channels.fetch(channelId);
      if (!cat || cat.type !== 4) return interaction.reply({ content: '❌ Ce salon n\'est pas une catégorie.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Catégorie introuvable.', ephemeral: true });
    }
    setCategory(guildId, channelId);
    return interaction.reply({ content: `✅ Catégorie définie sur \`${channelId}\`.`, ephemeral: true });
  }

  if (sub === 'add-staff-role') {
    const role = interaction.options.getRole('role', true);
    const added = addStaffRole(guildId, role.id);
    return interaction.reply({
      content: added ? `✅ Rôle <@&${role.id}> ajouté au staff.` : `⚠️ Ce rôle est déjà dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-staff-role') {
    const role = interaction.options.getRole('role', true);
    const removed = removeStaffRole(guildId, role.id);
    return interaction.reply({
      content: removed ? `✅ Rôle <@&${role.id}> retiré.` : `⚠️ Ce rôle n'est pas dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'add-staff-user') {
    const userId = interaction.options.getString('user-id', true).trim();
    const added = addStaffUser(guildId, userId);
    return interaction.reply({
      content: added ? `✅ Utilisateur \`${userId}\` ajouté.` : `⚠️ Déjà dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-staff-user') {
    const userId = interaction.options.getString('user-id', true).trim();
    const removed = removeStaffUser(guildId, userId);
    return interaction.reply({
      content: removed ? `✅ Utilisateur \`${userId}\` retiré.` : `⚠️ Pas dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-contestation') {
    const cfg = getSanctionConfig(guildId);
    const modal = new ModalBuilder()
      .setCustomId('sanction_set_contestation')
      .setTitle('Texte de contestation');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('contestation_text')
          .setLabel('Bloc contestation (markdown supporté)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(cfg.contestationText || '')
          .setPlaceholder('Ex: Si vous souhaitez contester, ouvrez un ticket Capitaine : https://...')
          .setRequired(false)
          .setMaxLength(2000)
      )
    );
    return interaction.showModal(modal);
  }

  if (sub === 'set-footer') {
    const cfg = getSanctionConfig(guildId);
    const modal = new ModalBuilder()
      .setCustomId('sanction_set_footer')
      .setTitle('Texte de pied de message');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('footer_text')
          .setLabel('Pied de message (markdown supporté)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(cfg.footerText || '')
          .setPlaceholder('Ex: Le Corps des gradés\nPoste de Sandy Shores')
          .setRequired(false)
          .setMaxLength(1000)
      )
    );
    return interaction.showModal(modal);
  }

  if (sub === 'show') {
    const cfg = getSanctionConfig(guildId);
    const roles = cfg.staffRoleIds.length > 0 ? cfg.staffRoleIds.map(id => `<@&${id}>`).join(', ') : '_Aucun_';
    const users = cfg.staffUserIds.length > 0 ? cfg.staffUserIds.map(id => `<@${id}> (\`${id}\`)`).join('\n') : '_Aucun_';
    const embed = new EmbedBuilder()
      .setTitle('⚖️ Configuration Sanctions')
      .setColor(0xe74c3c)
      .addFields(
        { name: 'Salon source',     value: cfg.sourceChannelId ? `<#${cfg.sourceChannelId}>` : '❌ Non défini', inline: true },
        { name: 'Catégorie',        value: cfg.categoryId ? `\`${cfg.categoryId}\`` : '❌ Non défini', inline: true },
        { name: 'Rôles staff',      value: roles, inline: false },
        { name: 'Utilisateurs staff', value: users, inline: false },
        { name: 'Contestation',     value: cfg.contestationText ? `\`\`\`${cfg.contestationText.slice(0, 400)}\`\`\`` : '_Non défini_', inline: false },
        { name: 'Footer',           value: cfg.footerText ? `\`\`\`${cfg.footerText.slice(0, 300)}\`\`\`` : '_Non défini_', inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

// ─── Modal submit handlers ────────────────────────────────────────────────────

export function handleSanctionSetContestationModal(interaction) {
  const text = interaction.fields.getTextInputValue('contestation_text').trim();
  setContestationText(interaction.guild.id, text);
  return interaction.reply({ content: '✅ Bloc contestation mis à jour.', ephemeral: true });
}

export function handleSanctionSetFooterModal(interaction) {
  const text = interaction.fields.getTextInputValue('footer_text').trim();
  setFooterText(interaction.guild.id, text);
  return interaction.reply({ content: '✅ Footer mis à jour.', ephemeral: true });
}

// ─── Message listener ─────────────────────────────────────────────────────────

const USER_MENTION_RE = /<@!?(\d{16,20})>/g;

function extractAgentIds(content) {
  const line = content.split('\n').find(l => l.includes('Agent(s) concerné(s) :'));
  if (!line) return [];
  const afterColon = line.split('Agent(s) concerné(s) :')[1] || '';
  const ids = [];
  let m;
  USER_MENTION_RE.lastIndex = 0;
  while ((m = USER_MENTION_RE.exec(afterColon)) !== null) ids.push(m[1]);
  return [...new Set(ids)];
}

function normalizeName(name) {
  return name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]/gi, '-')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'agent';
}

function buildTicketMessage(agentIds, sourceContent, cfg) {
  const mentions = agentIds.map(id => `<@${id}>`).join(' ');
  const parts = [mentions, '', '📌 **NOTIFICATION SANCTION DISCIPLINAIRE**', '', sourceContent.trim()];
  if (cfg.contestationText) parts.push('', '📩 **Contestation**', '', cfg.contestationText.trim());
  if (cfg.footerText) parts.push('', '---', '', cfg.footerText.trim());
  else parts.push('', '-# Ce ticket restera ouvert **48h**. Passé ce délai, il est possible qu\'il soit supprimé.');
  return parts.join('\n');
}

export async function processSanctionMessage(client, message) {
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  if (!guildId) return;

  const cfg = getSanctionConfig(guildId);
  if (!cfg.sourceChannelId || message.channel.id !== cfg.sourceChannelId) return;
  if (!cfg.categoryId) return;

  const agentIds = extractAgentIds(message.content);
  if (agentIds.length === 0) return;

  try {
    // Nom du ticket : premier agent + nombre si plusieurs
    const firstMember = await message.guild.members.fetch(agentIds[0]).catch(() => null);
    const firstName = firstMember?.displayName ?? firstMember?.user.username ?? agentIds[0];
    const suffix = agentIds.length > 1 ? `+${agentIds.length - 1}` : '';
    const ticketName = `sanction-${normalizeName(firstName)}${suffix}`;

    const permissionOverwrites = [
      { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    ];

    // Accès pour chaque agent mentionné
    for (const agentId of agentIds) {
      permissionOverwrites.push({
        id: agentId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    for (const roleId of cfg.staffRoleIds) {
      permissionOverwrites.push({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageRoles,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    for (const userId of cfg.staffUserIds) {
      permissionOverwrites.push({
        id: userId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageRoles,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      });
    }

    const ticketChannel = await message.guild.channels.create({
      name: ticketName,
      type: 0,
      parent: cfg.categoryId,
      permissionOverwrites,
    });

    await ticketChannel.send({ content: buildTicketMessage(agentIds, message.content, cfg) });
  } catch (e) {
    error('[Sanction] Erreur création ticket:', e);
  }
}
