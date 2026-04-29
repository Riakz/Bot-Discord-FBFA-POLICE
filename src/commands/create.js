import { ChannelType, PermissionFlagsBits, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import * as GuildManager from '../utils/guildConfig.js';

export async function handleCreateSlash(interaction) {
  const guildId = interaction.guild.id;
  const config = GuildManager.getGuildConfig(guildId);
  const { ticketCategoryId: TICKET_CATEGORY_ID, staffRoleId: STAFF_ROLE_ID } = config;

  if (!TICKET_CATEGORY_ID || !STAFF_ROLE_ID) {
    return interaction.reply({ content: 'Le bot n\'est pas configuré pour ce serveur (Catégorie Ticket ou Rôle Staff manquants). Demandez à un admin de lancer `/config-server setup`.', ephemeral: true });
  }

  const guild = interaction.guild;
  const member = interaction.member;

  const hasStaffRole = member?.roles?.cache?.has(STAFF_ROLE_ID);
  const callerIsAdmin = isAdmin(interaction.user.id) || member.permissions.has(PermissionFlagsBits.Administrator);
  if (!hasStaffRole && !callerIsAdmin) {
    return interaction.reply({ content: '❌ Vous n\'avez pas l\'autorisation d\'utiliser cette commande.', ephemeral: true });
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: STAFF_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  const openerBase = normalizeName(interaction.user.username);
  const channelName = `ticket-${openerBase}`.toLowerCase();

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: overwrites,
    topic: `OPENED_BY:${interaction.user.id}`,
  });

  const panel = buildPanel({ claimed: false });
  await channel.send({
    content: `Ticket ouvert par ${interaction.user}. Utilisez les boutons ci-dessous pour gérer le ticket.`,
    components: [panel],
  });
  return interaction.reply({ content: `🎟️ Ticket créé: ${channel}`, ephemeral: true });
}

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function buildPanel({ claimed }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Fermer le ticket')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Claim le ticket')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(claimed)),
  );
}

export async function handleTicketButtons(interaction) {
  if (!interaction.isButton()) return;

  const guildId = interaction.guild.id;
  const config = GuildManager.getGuildConfig(guildId);
  const STAFF_ROLE_ID = config.staffRoleId;
  const LOG_CHANNEL_ID = config.logs?.ticketLogs || process.env.LOG_CHANNEL_ID;

  const channel = interaction.channel;
  const member = interaction.member;

  const hasStaffRole = STAFF_ROLE_ID && member?.roles?.cache?.has(STAFF_ROLE_ID);
  const callerIsAdmin = isAdmin(interaction.user.id) || member?.permissions?.has(PermissionFlagsBits.Administrator);
  const hasChannelManage = channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ManageChannels);

  if (!hasStaffRole && !callerIsAdmin && !hasChannelManage) {
    return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé à utiliser ce panneau.', ephemeral: true });
  }

  const topic = channel.topic || '';
  const openedBy = extractMeta(topic, 'OPENED_BY');
  const claimedBy = extractMeta(topic, 'CLAIMED_BY');

  if (interaction.customId === 'ticket_claim') {
    if (claimedBy) {
      return interaction.reply({ content: `Ticket déjà pris en charge par <@${claimedBy}>.`, ephemeral: true });
    }

    if (STAFF_ROLE_ID) {
      await channel.permissionOverwrites.edit(STAFF_ROLE_ID, {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true,
      });
    }
    await channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });

    await channel.setTopic(setMeta(topic, 'CLAIMED_BY', interaction.user.id));

    try {
      if (interaction.message?.components?.length) {
        const row = buildPanel({ claimed: true });
        await interaction.message.edit({ components: [row] });
      }
    } catch { }

    await interaction.reply({ content: `✅ ${interaction.user} a pris en charge le ticket.`, ephemeral: false });
    return;
  }

  if (interaction.customId === 'ticket_close') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({ content: 'Confirmer la fermeture du ticket ?', components: [row], ephemeral: true });
  }

  if (interaction.customId === 'ticket_close_confirm') {
    await interaction.deferUpdate();
    const closerId = interaction.user.id;
    const transcript = await buildTranscript(channel);
    const bomPlusContent = '﻿' + transcript;
    const file = new AttachmentBuilder(Buffer.from(bomPlusContent, 'utf8'), { name: `${channel.name}_transcript.txt` });
    try {
      if (LOG_CHANNEL_ID) {
        const logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID);
        const embed = new EmbedBuilder()
          .setTitle(`Ticket fermé: ${channel.name}`)
          .addFields(
            { name: 'Ouvert par', value: openedBy ? `<@${openedBy}>` : 'Inconnu', inline: true },
            { name: 'Claim par', value: claimedBy ? `<@${claimedBy}>` : 'Non réclamé', inline: true },
            { name: 'Fermé par', value: `<@${closerId}>`, inline: true },
          )
          .setTimestamp(new Date())
          .setColor(0xff5555);
        await logChannel.send({ embeds: [embed], files: [file] });
      }
    } catch { }
    await channel.delete('Ticket fermé');
    return;
  }

  if (interaction.customId === 'ticket_close_cancel') {
    return interaction.update({ content: 'Fermeture annulée.', components: [] });
  }
}

function extractMeta(topic, key) {
  const m = topic.match(new RegExp(`${key}:([0-9]{10,20})`));
  return m ? m[1] : null;
}

function setMeta(topic, key, value) {
  if (topic.includes(`${key}:`)) {
    return topic.replace(new RegExp(`${key}:[0-9]{10,20}`), `${key}:${value}`);
  }
  return `${topic || ''} ${key}:${value}`.trim();
}

async function buildTranscript(channel) {
  let lastId;
  const all = [];
  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!fetched || fetched.size === 0) break;
    for (const msg of Array.from(fetched.values())) all.push(msg);
    lastId = fetched.last().id;
    if (all.length > 1000) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = all.map((m) => formatLine(m));
  return lines.join('\r\n');
}

function formatLine(m) {
  const ts = new Date(m.createdTimestamp).toISOString();
  const author = m.author?.tag || m.author?.id || 'unknown';
  let content = (m.content || '').normalize('NFC');
  if (m.attachments?.size) {
    const files = Array.from(m.attachments.values()).map((a) => a.url).join(' ');
    content += (content ? ' ' : '') + files;
  }
  return `[${ts}] ${author}: ${content}`;
}

export async function buildPublicPanel(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('public_open_ticket').setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Success)
  );
  await interaction.reply({ content: "Si vous avez des questions ou des remontés à faire uniquement aux Référents Police. Nous vous invitons à ouvrir un ticket afin d'être mis en relation avec eux.", components: [row] });
}

export async function openTicketFromPublicPanel(interaction) {
  const guildId = interaction.guild.id;
  const config = GuildManager.getGuildConfig(guildId);
  const { ticketCategoryId: TICKET_CATEGORY_ID, staffRoleId: STAFF_ROLE_ID } = config;

  if (!TICKET_CATEGORY_ID || !STAFF_ROLE_ID) {
    return interaction.reply({ content: "Le bot n'est pas configuré pour ce serveur (manque Catégorie Ticket ou Rôle Staff).", ephemeral: true });
  }

  const guild = interaction.guild;
  const user = interaction.user;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: STAFF_ROLE_ID, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ]
    },
    {
      id: user.id, allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ]
    }
  ];

  const channel = await guild.channels.create({
    name: `ticket-${normalizeName(user.username)}`,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: overwrites,
    topic: `OPENED_BY:${user.id}`,
  });

  const panel = buildPanel({ claimed: false });
  await channel.send({ content: `Ticket ouvert par ${user}. Un membre du staff va vous prendre en charge.`, components: [panel] });
  return interaction.reply({ content: `🎟️ Ticket créé: ${channel}`, ephemeral: true });
}
