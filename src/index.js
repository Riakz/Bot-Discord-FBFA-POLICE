import { loadEnv } from './utils/loadEnv.js';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } from 'discord.js';
import { log, error } from './utils/logger.js';
import { registerPermsStore } from './utils/perms.js';
import { handleAdminSlash } from './commands/admin.js';
import { handleCreateSlash, handleTicketButtons, buildPublicPanel, openTicketFromPublicPanel } from './commands/create.js';
import { isAdmin } from './utils/perms.js';
import * as ficheCommand from './commands/fiche.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as PanelManager from './utils/panels.js';
import * as GuildManager from './utils/guildConfig.js';
import { buildTranscript, extractMeta, setMeta } from './utils/ticketUtils.js';
import { rateLimiter } from './utils/rateLimit.js';
import { addToWhitelist, removeFromWhitelist, isWhitelisted, getWhitelist } from './utils/whitelist.js';
import { handleReserverPA, handleAnnulerPA, handlePlanningPA } from './commands/planning.js';
import { handleDepartWatcher, hasDepartureKeyword, forwardDepartureMessage } from './commands/watcher.js';
import { handleMirror, forwardMirrorMessage } from './commands/mirror.js';
import { getWatcherConfig } from './utils/watcherConfig.js';
import { handleAntidouble, handleAntidoubleButton, handleAntidoubleModal } from './commands/antidouble.js';
import { loadBlacklist, saveBlacklist, getBlacklist, addBlacklistEntry, removeBlacklistEntry } from './utils/blacklistManager.js';
import { getMirrorConfig } from './utils/mirrorConfig.js';
import {
  handleCandidaturePanel,
  handleConfigCandidature,
  handleDistrictButton,
  handleFormPart1,
  handleFormPart2,
  handleAcceptButton,
  handleRefuseButton,
  handleRefuseModal,
  handleViewReasonButton,
  handleRevertButton,
  handleCandidaturePanelModal,
  handlePart2Button
} from './commands/candidature.js';
import {
  handleConfigEntretien,
  processEntretienWebhook,
  handleEntretienButton,
  handleEntretienModal,
  handleEntretienViewReason,
  handleEntretienRevert,
} from './commands/entretien.js';
import { handleLiens, handleConfigLiens } from './commands/liens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadedFrom = loadEnv();
log(`ENV loaded from: ${loadedFrom}`);

const {
  DISCORD_TOKEN,
  GUILD_ID,
} = process.env;

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN in .env');
if (!GUILD_ID) log('Note: GUILD_ID not set, bot running in multi-guild global mode.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const alertWatch = new Map();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function banUserFromAllGuilds(client, userId, reason) {
  const results = [];
  for (const [gid, guild] of client.guilds.cache) {
    try {
      const g = await client.guilds.fetch(gid);
      await g.members.ban(userId, { reason, deleteMessageSeconds: 0 }).catch(async () => {
        await g.bans.create(userId, { reason });
      });
      results.push({ guild: g, ok: true });
    } catch (e) {
      results.push({ guild, ok: false, reason: e?.message || String(e) });
    }
  }
  return results;
}

async function unbanUserFromAllGuilds(client, userId) {
  const results = [];
  for (const [gid, guild] of client.guilds.cache) {
    try {
      const g = await client.guilds.fetch(gid);
      await g.members.unban(userId, 'Retiré de la blacklist');
      results.push({ guild: g, ok: true });
    } catch (e) {
      results.push({ guild, ok: false, reason: e?.message || String(e) });
    }
  }
  return results;
}

async function getUsernameById(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.username;
  } catch {
    return 'Utilisateur inconnu';
  }
}

const PAGE_SIZE = 10;
async function buildBlEmbed(client, page = 0) {
  const bl = getBlacklist();
  const total = bl.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p * PAGE_SIZE;
  const slice = bl.slice(start, start + PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setTitle('Blacklist Police')
    .setColor(0x2ecc71)
    .setFooter({ text: `Page ${p + 1}/${pages} • Total: ${total}` })
    .setTimestamp(new Date());
  if (slice.length === 0) {
    embed.setDescription('Aucune entrée.');
  } else {
    const lines = await Promise.all(slice.map(async (e, i) => {
      const idx = start + i + 1;
      const when = new Date(e.addedAt).toLocaleString('fr-FR');
      const username = await getUsernameById(client, e.id);
      const uniqueId = e.uniqueId ? `\nID Unique: \`${e.uniqueId}\`` : '';
      return `**#${idx}** • @${username} (ID: \`${e.id}\`)${uniqueId}\nMotif: ${e.motif || '—'}\nDate: ${when}`;
    }));
    embed.setDescription(lines.join('\n\n'));
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bl_prev:${p}`).setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
    new ButtonBuilder().setCustomId(`bl_next:${p}`).setLabel('Suivant ▶️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1),
    new ButtonBuilder().setCustomId('bl_refresh').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
  return { embed, row, page: p, pages };
}

registerPermsStore();

client.once('ready', () => {
  log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    const context = interaction.isChatInputCommand() ? `Command: /${interaction.commandName}` :
      interaction.isButton() ? `Button: ${interaction.customId}` :
        interaction.isModalSubmit() ? `Modal: ${interaction.customId}` : 'Interaction';

    const { blocked, remainingMs, justBlocked, history } = rateLimiter.check(interaction.user.id, 'interaction', context);

    if (blocked) {
      if (justBlocked) {
        const guildId = interaction.guild?.id;
        const securityLogId = guildId ? GuildManager.getGuildConfig(guildId).logs?.securityLogs : null;

        if (securityLogId) {
          try {
            const logCh = await client.channels.fetch(securityLogId);
            if (logCh) {
              const embed = new EmbedBuilder()
                .setTitle('🛡️ Sécurité : Utilisateur Bloqué (Rate Limit)')
                .setColor(0xff0000)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                  { name: 'Utilisateur', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                  { name: 'Raison', value: 'Spam d\'interactions (5 actions / 10s)', inline: true },
                  { name: 'Durée', value: '2 minutes', inline: true },
                  { name: 'Dernières Actions', value: history.map(h => `\`${new Date(h.timestamp).toLocaleTimeString()}\` ${h.detail}`).join('\n') || 'Aucune' }
                )
                .setTimestamp();
              await logCh.send({ embeds: [embed] });
            }
          } catch (e) { error('Failed to send security log', e); }
        }
      }

      const seconds = Math.ceil(remainingMs / 1000);
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: `⛔ **Anti-Spam** : Vous envoyez trop de requêtes.\nVeuillez patienter ${seconds} secondes avant de réessayer.`,
          ephemeral: true
        });
      }
      return;
    }

    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'antidouble') return handleAntidouble(interaction);
      if (interaction.commandName === 'depart-watcher') return handleDepartWatcher(interaction);
      if (interaction.commandName === 'mirror') return handleMirror(interaction);

      if (interaction.commandName === 'reserver-pa') return handleReserverPA(interaction);
      if (interaction.commandName === 'annuler-pa') return handleAnnulerPA(interaction);
      if (interaction.commandName === 'planning-pa') return handlePlanningPA(interaction);

      if (interaction.commandName === 'candidature-panel') {
        return handleCandidaturePanel(interaction);
      }
      if (interaction.commandName === 'config-candidature') {
        return handleConfigCandidature(interaction);
      }
      if (interaction.commandName === 'config-entretien') {
        return handleConfigEntretien(interaction);
      }
      if (interaction.commandName === 'liens') {
        return handleLiens(interaction);
      }
      if (interaction.commandName === 'config-liens') {
        return handleConfigLiens(interaction);
      }

      if (interaction.commandName === 'whitelist') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'add-role') {
          const role = interaction.options.getRole('role', true);
          const added = addToWhitelist(guildId, role.id, 'role');
          if (added) {
            return interaction.reply({ content: `✅ Rôle <@&${role.id}> ajouté à la whitelist.`, ephemeral: true });
          } else {
            return interaction.reply({ content: `⚠️ Ce rôle est déjà dans la whitelist.`, ephemeral: true });
          }
        }

        if (sub === 'remove-role') {
          const role = interaction.options.getRole('role', true);
          const removed = removeFromWhitelist(guildId, role.id);
          if (removed) {
            return interaction.reply({ content: `✅ Rôle <@&${role.id}> retiré de la whitelist.`, ephemeral: true });
          } else {
            return interaction.reply({ content: `⚠️ Ce rôle n'est pas dans la whitelist.`, ephemeral: true });
          }
        }

        if (sub === 'add-user') {
          const user = interaction.options.getUser('user', true);
          const added = addToWhitelist(guildId, user.id, 'user');
          if (added) {
            return interaction.reply({ content: `✅ Utilisateur <@${user.id}> ajouté à la whitelist.`, ephemeral: true });
          } else {
            return interaction.reply({ content: `⚠️ Cet utilisateur est déjà dans la whitelist.`, ephemeral: true });
          }
        }

        if (sub === 'remove-user') {
          const user = interaction.options.getUser('user', true);
          const removed = removeFromWhitelist(guildId, user.id);
          if (removed) {
            return interaction.reply({ content: `✅ Utilisateur <@${user.id}> retiré de la whitelist.`, ephemeral: true });
          } else {
            return interaction.reply({ content: `⚠️ Cet utilisateur n'est pas dans la whitelist.`, ephemeral: true });
          }
        }

        if (sub === 'show') {
          const wl = getWhitelist(guildId);
          const userList = wl.users.length > 0
            ? wl.users.map(id => `<@${id}> (\`${id}\`)`).join('\n')
            : '_Aucun utilisateur_';
          const roleList = wl.roles.length > 0
            ? wl.roles.map(id => `<@&${id}> (\`${id}\`)`).join('\n')
            : '_Aucun rôle_';

          const embed = new EmbedBuilder()
            .setTitle('Whitelist du serveur')
            .setColor(0x2ecc71)
            .addFields(
              { name: `Rôles whitelistés (${wl.roles.length})`, value: roleList, inline: false },
              { name: `Utilisateurs whitelistés (${wl.users.length})`, value: userList, inline: false },
            )
            .setDescription('Les membres possédant un rôle whitelist **ou** listés individuellement peuvent utiliser `/search-bl`, `/add`, `/remove`, `/rename` et `!alert`.')
            .setFooter({ text: `Server ID: ${guildId}` })
            .setTimestamp();

          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        return;
      }

      if (interaction.commandName === 'admin') {
        return handleAdminSlash(interaction);
      }

      if (interaction.commandName === 'config-server') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'show') {
          const config = GuildManager.getGuildConfig(guildId);
          const paRoles = config.paRoleIds ?? (config.paRoleId ? [config.paRoleId] : []);
          const embed = new EmbedBuilder()
            .setTitle(`Configuration du serveur: ${interaction.guild.name}`)
            .setColor(0x9b59b6)
            .addFields(
              { name: 'Rôle Staff', value: config.staffRoleId ? `<@&${config.staffRoleId}>` : '❌ Non défini', inline: true },
              { name: 'Catégorie Tickets', value: config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : '❌ Non défini', inline: true },
              {
                name: 'Rôles PA (réservations)',
                value: paRoles.length > 0 ? paRoles.map(id => `<@&${id}>`).join(', ') : '*(aucun — tout le monde peut réserver)*',
                inline: false,
              },
            )
            .setTimestamp();
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'add-pa-role') {
          const role = interaction.options.getRole('role', true);
          const config = GuildManager.getGuildConfig(guildId);
          const paRoles = config.paRoleIds ?? (config.paRoleId ? [config.paRoleId] : []);
          if (paRoles.includes(role.id)) {
            return interaction.reply({ content: `⚠️ ${role} est déjà dans la liste.`, ephemeral: true });
          }
          paRoles.push(role.id);
          GuildManager.updateGuildConfig(guildId, { paRoleIds: paRoles, paRoleId: null });
          return interaction.reply({ content: `✅ ${role} ajouté — seuls les membres avec un rôle PA pourront réserver.`, ephemeral: true });
        }

        if (sub === 'remove-pa-role') {
          const role = interaction.options.getRole('role', true);
          const config = GuildManager.getGuildConfig(guildId);
          const paRoles = (config.paRoleIds ?? (config.paRoleId ? [config.paRoleId] : [])).filter(id => id !== role.id);
          GuildManager.updateGuildConfig(guildId, { paRoleIds: paRoles, paRoleId: null });
          return interaction.reply({
            content: `✅ ${role} retiré.${paRoles.length === 0 ? ' Aucun rôle PA — tout le monde peut réserver.' : ''}`,
            ephemeral: true,
          });
        }

        if (sub === 'clear-pa-roles') {
          GuildManager.updateGuildConfig(guildId, { paRoleIds: [], paRoleId: null });
          return interaction.reply({ content: '✅ Tous les rôles PA retirés — tout le monde peut réserver.', ephemeral: true });
        }

        if (sub === 'setup') {
          const role = interaction.options.getRole('staff-role');
          const category = interaction.options.getChannel('ticket-category');

          if (category.type !== 4) {
            return interaction.reply({ content: '❌ Le canal spécifié pour les tickets doit être une **Catégorie**.', ephemeral: true });
          }

          GuildManager.updateGuildConfig(guildId, {
            staffRoleId: role.id,
            ticketCategoryId: category.id
          });

          return interaction.reply({
            content: `✅ Configuration mise à jour pour **${interaction.guild.name}**:\n- **Rôle Staff**: ${role}\n- **Catégorie Tickets**: ${category}`,
            ephemeral: true
          });
        }
      }

      if (interaction.commandName === 'create') {
        return handleCreateSlash(interaction);
      }
      if (interaction.commandName === 'ar') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const text = interaction.options.getString('message', true);
        const ch = interaction.channel;
        const isText = !!ch && ch.type === 0;
        const looksLikeTicket = isText && (
          (typeof ch.name === 'string' && ch.name.startsWith('ticket-')) ||
          (typeof ch.topic === 'string' && ch.topic.includes('OPENED_BY:'))
        );
        if (!looksLikeTicket) {
          return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un ticket.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await interaction.channel.send(text);

        const guildId = interaction.guild.id;
        const logId = GuildManager.getGuildConfig(guildId).logs?.auditLogs || process.env.AR_AUDIT_CHANNEL_ID;

        try {
          if (logId) {
            const auditCh = await interaction.client.channels.fetch(logId);
            const embed = new EmbedBuilder()
              .setTitle('Message anonyme envoyé')
              .setColor(0x5b9bd5)
              .addFields(
                { name: 'Auteur', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                { name: 'Salon', value: `${interaction.channel} (${interaction.channel.id})`, inline: false },
                { name: 'Message', value: text.slice(0, 1024), inline: false },
              )
              .setTimestamp(new Date());
            await auditCh.send({ embeds: [embed] });
          }
        } catch { }
        return interaction.editReply({ content: 'Message envoyé anonymement.' });
      }
      if (interaction.commandName === 'panel-ticket') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        await buildPublicPanel(interaction);
        return;
      }

      if (interaction.commandName === 'fiche') {
        return ficheCommand.execute(interaction);
      }

      if (interaction.commandName === 'config-logs') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
        }
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'show') {
          const cfg = GuildManager.getGuildConfig(guildId).logs || {};
          const embed = new EmbedBuilder()
            .setTitle('Configuration des logs')
            .setColor(0x95a5a6)
            .addFields(
              { name: 'ticketLogs', value: cfg.ticketLogs ? `<#${cfg.ticketLogs}> (${cfg.ticketLogs})` : '—', inline: false },
              { name: 'policeLogs', value: cfg.policeLogs ? `<#${cfg.policeLogs}> (${cfg.policeLogs})` : '—', inline: false },
              { name: 'auditLogs', value: cfg.auditLogs ? `<#${cfg.auditLogs}> (${cfg.auditLogs})` : '—', inline: false },
            )
            .setTimestamp(new Date());
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const setChannel = async (key) => {
          const channelId = interaction.options.getString('channel-id', true).trim();
          try {
            const ch = await interaction.client.channels.fetch(channelId);
            if (!ch) throw new Error('Canal introuvable');
          } catch (e) {
            return interaction.reply({ content: '❌ ID de canal invalide ou introuvable.', ephemeral: true });
          }

          GuildManager.updateGuildConfig(guildId, {
            logs: { [key]: channelId }
          });

          return interaction.reply({ content: `✅ Canal de logs mis à jour pour ${key}: <#${channelId}>`, ephemeral: true });
        };

        if (sub === 'ticket-logs') return setChannel('ticketLogs');
        if (sub === 'police-logs') return setChannel('policeLogs');
        if (sub === 'audit-logs') return setChannel('auditLogs');
        if (sub === 'security-logs') return setChannel('securityLogs');
      }

      if (interaction.commandName === 'panel-custom') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
          const modal = new ModalBuilder()
            .setCustomId('modal_panel_create')
            .setTitle('Créer un Panel Personnalisé');

          const titleInput = new TextInputBuilder()
            .setCustomId('panel_title')
            .setLabel('Titre de l\'embed')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Centre de Support')
            .setRequired(true);

          const descInput = new TextInputBuilder()
            .setCustomId('panel_description')
            .setLabel('Description de l\'embed')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex: Choisissez le type de ticket à ouvrir')
            .setRequired(true);

          const colorInput = new TextInputBuilder()
            .setCustomId('panel_color')
            .setLabel('Couleur (hex sans #)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 3498db')
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('panel_log_channel')
                .setLabel('ID Salon Logs (Optionnel)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Laissez vide pour logs par défaut')
                .setRequired(false)
            )
          );

          return interaction.showModal(modal);
        }

        if (subcommand === 'add-button') {
          const panelId = interaction.options.getString('panel-id');
          const panel = PanelManager.getPanel(panelId);

          if (!panel) {
            return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          }
          if (panel.guildId && panel.guildId !== guildId) {
            return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          }

          if (panel.buttons.length >= 25) {
            return interaction.reply({ content: '❌ Maximum 25 boutons par panel atteint.', ephemeral: true });
          }

          const modal = new ModalBuilder()
            .setCustomId(`modal_panel_add_button:${panelId}`)
            .setTitle('Ajouter un Bouton');

          const labelInput = new TextInputBuilder()
            .setCustomId('button_label')
            .setLabel('Label du bouton')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Support Technique')
            .setRequired(true);

          const emojiInput = new TextInputBuilder()
            .setCustomId('button_emoji')
            .setLabel('Emoji (Unicode ou :name: ou <:name:id>)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 🎫 ou :ticket:')
            .setRequired(false);

          const categoryInput = new TextInputBuilder()
            .setCustomId('button_category')
            .setLabel('ID de la catégorie pour les tickets')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 123456789012345678')
            .setRequired(true);

          const rolesInput = new TextInputBuilder()
            .setCustomId('button_roles')
            .setLabel('IDs des rôles (séparés par des virgules)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ex: 111111111,222222222,333333333')
            .setRequired(true);

          const prefixInput = new TextInputBuilder()
            .setCustomId('button_prefix')
            .setLabel('Préfixe du nom du ticket')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: support')
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(labelInput),
            new ActionRowBuilder().addComponents(emojiInput),
            new ActionRowBuilder().addComponents(categoryInput),
            new ActionRowBuilder().addComponents(rolesInput),
            new ActionRowBuilder().addComponents(prefixInput)
          );

          return interaction.showModal(modal);
        }

        if (subcommand === 'publish') {
          const panelId = interaction.options.getString('panel-id');
          const panel = PanelManager.getPanel(panelId);

          if (!panel) {
            return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          }
          if (panel.guildId && panel.guildId !== guildId) {
            return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          }

          if (panel.buttons.length === 0) {
            return interaction.reply({ content: '❌ Le panel doit avoir au moins 1 bouton.', ephemeral: true });
          }

          await interaction.deferReply({ ephemeral: true });

          try {
            const embed = new EmbedBuilder()
              .setTitle(panel.embedTitle)
              .setDescription(panel.embedDescription)
              .setColor(panel.embedColor)
              .setTimestamp(new Date());

            const rows = [];
            let currentRow = new ActionRowBuilder();

            panel.buttons.forEach((btn, index) => {
              const button = new ButtonBuilder()
                .setCustomId(`custom_panel_btn:${btn.id}`)
                .setLabel(btn.label)
                .setStyle(ButtonStyle.Primary);

              if (btn.emoji) {
                button.setEmoji(btn.emoji);
              }

              currentRow.addComponents(button);

              if ((index + 1) % 5 === 0 || index === panel.buttons.length - 1) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
              }
            });

            const message = await interaction.channel.send({
              embeds: [embed],
              components: rows
            });

            PanelManager.updatePanelMessage(panelId, message.id, interaction.channel.id);

            return interaction.editReply({ content: `✅ Panel publié avec succès!\nID: \`${panelId}\`\nMessage ID: \`${message.id}\`` });
          } catch (e) {
            error('Error publishing panel:', e);
            return interaction.editReply({ content: `❌ Erreur lors de la publication: ${e.message}` });
          }
        }

        if (subcommand === 'list') {
          const allPanels = PanelManager.getAllPanels(guildId);
          const panelList = Object.values(allPanels);

          if (panelList.length === 0) {
            return interaction.reply({ content: 'Aucun panel créé sur ce serveur.', ephemeral: true });
          }

          const embed = new EmbedBuilder()
            .setTitle(`Panels Personnalisés - ${interaction.guild.name}`)
            .setColor(0x3498db)
            .setTimestamp(new Date());

          panelList.forEach(panel => {
            const published = panel.messageId ? '✅ Publié' : '⏳ Non publié';
            const buttonCount = panel.buttons.length;
            embed.addFields({
              name: panel.embedTitle,
              value: `ID: \`${panel.id}\`\n${published} • ${buttonCount} bouton(s)\nCréé: <t:${Math.floor(panel.createdAt / 1000)}:R>`,
              inline: false
            });
          });

          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (subcommand === 'delete') {
          const panelId = interaction.options.getString('panel-id');
          const panel = PanelManager.getPanel(panelId);

          if (!panel) {
            return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          }
          if (panel.guildId && panel.guildId !== guildId) {
            return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          }

          await interaction.deferReply({ ephemeral: true });

          try {
            if (panel.messageId && panel.channelId) {
              try {
                const channel = await interaction.client.channels.fetch(panel.channelId);
                const message = await channel.messages.fetch(panel.messageId);
                await message.delete();
              } catch (e) { }
            }

            PanelManager.deletePanel(panelId);
            return interaction.editReply({ content: `✅ Panel \`${panelId}\` supprimé avec succès.` });
          } catch (e) {
            error('Error deleting panel:', e);
            return interaction.editReply({ content: `❌ Erreur lors de la suppression: ${e.message}` });
          }
        }

        if (subcommand === 'set-log') {
          const panelId = interaction.options.getString('panel-id');
          const channelId = interaction.options.getString('channel-id');
          const panel = PanelManager.getPanel(panelId);

          if (!panel) {
            return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          }
          if (panel.guildId && panel.guildId !== guildId) {
            return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          }

          let finalChannelId = null;
          if (channelId.toLowerCase() !== 'none') {
            try {
              const ch = await interaction.guild.channels.fetch(channelId);
              if (!ch || !ch.isTextBased()) {
                return interaction.reply({ content: '❌ Canal invalide ou introuvable (doit être un salon textuel).', ephemeral: true });
              }
              finalChannelId = ch.id;
            } catch (e) {
              return interaction.reply({ content: '❌ Canal introuvable.', ephemeral: true });
            }
          }

          try {
            PanelManager.updatePanelLogChannel(panelId, finalChannelId);
            const msg = finalChannelId
              ? `✅ Canal de logs pour le panel \`${panelId}\` défini sur <#${finalChannelId}>.`
              : `✅ Canal de logs désactivé pour le panel \`${panelId}\` (retour aux logs par défaut).`;
            return interaction.reply({ content: msg, ephemeral: true });
          } catch (e) {
            error('Error updating panel log channel:', e);
            return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
          }
        }

        if (subcommand === 'set-button-log') {
          const panelId  = interaction.options.getString('panel-id', true);
          const buttonId = interaction.options.getString('button-id', true);
          const channelId = interaction.options.getString('channel-id', true).trim();
          const panel = PanelManager.getPanel(panelId);
          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          const btn = panel.buttons.find(b => b.id === buttonId);
          if (!btn) return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });

          let finalChannelId = null;
          if (channelId.toLowerCase() !== 'none') {
            try {
              const ch = await interaction.guild.channels.fetch(channelId);
              if (!ch || !ch.isTextBased()) return interaction.reply({ content: '❌ Canal invalide.', ephemeral: true });
              finalChannelId = ch.id;
            } catch { return interaction.reply({ content: '❌ Canal introuvable.', ephemeral: true }); }
          }
          PanelManager.updateButtonLogChannel(panelId, buttonId, finalChannelId);
          return interaction.reply({
            content: finalChannelId
              ? `✅ Logs pour le bouton **${btn.label}** → <#${finalChannelId}> (prioritaire sur le panel).`
              : `✅ Logs du bouton **${btn.label}** retirés (retour aux logs du panel).`,
            ephemeral: true,
          });
        }

        if (subcommand === 'set-button-welcome') {
          const panelId  = interaction.options.getString('panel-id', true);
          const buttonId = interaction.options.getString('button-id', true);
          const panel = PanelManager.getPanel(panelId);
          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });
          const btn = panel.buttons.find(b => b.id === buttonId);
          if (!btn) return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`modal_button_welcome:${panelId}:${buttonId}`)
            .setTitle(`Message d'ouverture — ${btn.label}`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('welcome_title')
                .setLabel('Titre du message')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`Ticket: ${btn.label}`)
                .setValue(btn.welcomeTitle || '')
                .setRequired(false)
                .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('welcome_message')
                .setLabel('Contenu du message')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Votre ticket a été créé. L'équipe vous répondra bientôt.")
                .setValue(btn.welcomeMessage || '')
                .setRequired(false)
                .setMaxLength(2000)
            ),
          );
          return interaction.showModal(modal);
        }

        if (subcommand === 'edit') {
          const panelId = interaction.options.getString('panel-id');
          const panel = PanelManager.getPanel(panelId);

          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`modal_panel_edit:${panelId}`)
            .setTitle('Modifier Panel');

          const titleInput = new TextInputBuilder()
            .setCustomId('panel_title')
            .setLabel('Titre (laisser vide pour ne pas changer)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(panel.embedTitle)
            .setRequired(false);

          const descInput = new TextInputBuilder()
            .setCustomId('panel_description')
            .setLabel('Description (vide = inchangé)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(panel.embedDescription.slice(0, 100))
            .setRequired(false);

          const colorInput = new TextInputBuilder()
            .setCustomId('panel_color')
            .setLabel('Couleur (vide = inchangé)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(panel.embedColor.toString(16))
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(colorInput)
          );

          return interaction.showModal(modal);
        }

        if (subcommand === 'list-buttons') {
          const panelId = interaction.options.getString('panel-id');
          const panel = PanelManager.getPanel(panelId);
          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });

          if (panel.buttons.length === 0) return interaction.reply({ content: 'Aucun bouton sur ce panel.', ephemeral: true });

          const embed = new EmbedBuilder()
            .setTitle(`Boutons du panel: ${panel.embedTitle}`)
            .setColor(0x3498db);

          const description = panel.buttons.map((b, i) => {
            return `**${i + 1}. ${b.label}**\nID: \`${b.id}\`\nEmoji: ${b.emoji || 'Aucun'}`;
          }).join('\n\n');

          embed.setDescription(description.slice(0, 4096));
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (subcommand === 'edit-button') {
          const panelId = interaction.options.getString('panel-id');
          const buttonId = interaction.options.getString('button-id');
          const panel = PanelManager.getPanel(panelId);
          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });

          const btn = panel.buttons.find(b => b.id === buttonId);
          if (!btn) return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });

          const modal = new ModalBuilder()
            .setCustomId(`modal_panel_edit_button:${panelId}:${buttonId}`)
            .setTitle('Modifier Bouton');

          const labelInput = new TextInputBuilder()
            .setCustomId('button_label')
            .setLabel('Label (vide = inchangé)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(btn.label)
            .setRequired(false);

          const emojiInput = new TextInputBuilder()
            .setCustomId('button_emoji')
            .setLabel('Emoji (vide = inchangé)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(btn.emoji || 'Aucun')
            .setRequired(false);

          const categoryInput = new TextInputBuilder()
            .setCustomId('button_category')
            .setLabel('ID Catégorie (vide = inchangé)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(btn.categoryId)
            .setRequired(false);

          const rolesInput = new TextInputBuilder()
            .setCustomId('button_roles')
            .setLabel('IDs Rôles (vide = inchangé)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(btn.roleIds.join(','))
            .setRequired(false);

          const prefixInput = new TextInputBuilder()
            .setCustomId('button_prefix')
            .setLabel('Préfixe (vide = inchangé)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(btn.ticketNamePrefix)
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(labelInput),
            new ActionRowBuilder().addComponents(emojiInput),
            new ActionRowBuilder().addComponents(categoryInput),
            new ActionRowBuilder().addComponents(rolesInput),
            new ActionRowBuilder().addComponents(prefixInput)
          );

          return interaction.showModal(modal);
        }

        if (subcommand === 'remove-button') {
          const panelId = interaction.options.getString('panel-id');
          const buttonId = interaction.options.getString('button-id');
          const panel = PanelManager.getPanel(panelId);
          if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
          if (panel.guildId && panel.guildId !== guildId) return interaction.reply({ content: '❌ Ce panel appartient à un autre serveur.', ephemeral: true });

          try {
            PanelManager.removeButton(panelId, buttonId);
            await refreshPublishedPanel(interaction.client, panelId);
            return interaction.reply({ content: `✅ Bouton supprimé et panel mis à jour.`, ephemeral: true });
          } catch (e) {
            return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
          }
        }
      }

      if (interaction.commandName === 'add-bl') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const modal = new ModalBuilder()
          .setCustomId('modal_add_bl')
          .setTitle('Ajouter à la blacklist');
        const idInput = new TextInputBuilder()
          .setCustomId('bl_id')
          .setLabel('ID Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 123456789012345678')
          .setRequired(true);
        const motifInput = new TextInputBuilder()
          .setCustomId('bl_motif')
          .setLabel('Motif')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Raison de la blacklist')
          .setRequired(true);
        const uniqueIdInput = new TextInputBuilder()
          .setCustomId('bl_unique_id')
          .setLabel('ID Unique (Optionnel)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 4404')
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(uniqueIdInput),
          new ActionRowBuilder().addComponents(motifInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.commandName === 'search-bl') {
        const allowed = isWhitelisted(interaction.guild.id, interaction.user.id, interaction.member) || isAdmin(interaction.user.id);
        if (!allowed) {
          return interaction.reply({ content: '❌ Vous n\'êtes pas dans la whitelist pour utiliser cette commande.', ephemeral: true });
        }

        const targetId = interaction.options.getString('id', true).trim();
        const entry = getBlacklist().find(e => e.id === targetId);

        if (entry) {
          const embed = new EmbedBuilder()
            .setTitle('Résultat Recherche Blacklist')
            .setColor(0xe74c3c)
            .addFields(
              { name: 'Statut', value: '⛔ **BLACKLIST DÉTECTÉE**', inline: false },
              { name: 'ID', value: `\`${entry.id}\``, inline: true },
              ...(entry.uniqueId ? [{ name: 'ID Unique', value: `\`${entry.uniqueId}\``, inline: true }] : []),
              { name: 'Motif', value: entry.motif || 'Aucun motif', inline: false },
              { name: 'Ajouté par', value: `<@${entry.addedBy}> (${entry.addedBy})`, inline: false },
              { name: 'Date', value: `<t:${Math.floor(entry.addedAt / 1000)}:F>`, inline: false }
            )
            .setTimestamp();
          return interaction.reply({ embeds: [embed] });
        } else {
          return interaction.reply({ content: `✅ Aucun résultat pour l'ID \`${targetId}\`. Cet utilisateur n'est pas blacklisté.`, ephemeral: true });
        }
      }

      if (interaction.commandName === 'bl-list') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const { embed, row } = await buildBlEmbed(interaction.client, 0);
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      }

      if (interaction.commandName === 'remove-bl') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const modal = new ModalBuilder()
          .setCustomId('modal_remove_bl')
          .setTitle('Retirer de la blacklist');
        const idInput = new TextInputBuilder()
          .setCustomId('bl_id_remove')
          .setLabel('ID Discord à retirer')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 123456789012345678')
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(idInput)
        );
        return interaction.showModal(modal);
      }
      if (interaction.commandName === 'add' || interaction.commandName === 'remove') {
        const guildId = interaction.guild.id;

        const hasChannelManage = interaction.channel?.permissionsFor(interaction.member)?.has(PermissionsBitField.Flags.ManageChannels);
        const allowed = isWhitelisted(guildId, interaction.user.id, interaction.member) || isAdmin(interaction.user.id) || hasChannelManage;
        if (!allowed) {
          return interaction.reply({ content: '❌ Vous n\'êtes pas dans la whitelist pour utiliser cette commande.', ephemeral: true });
        }

        const ch = interaction.channel;
        const isText = !!ch && ch.type === 0;
        const looksLikeTicket = isText && (
          (typeof ch.name === 'string' && ch.name.startsWith('ticket-')) ||
          (typeof ch.topic === 'string' && ch.topic.includes('OPENED_BY:'))
        );
        if (!looksLikeTicket) {
          return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un ticket.', ephemeral: true });
        }
        const targetId = interaction.options.getString('id', true).trim();
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!member) {
            return interaction.reply({ content: `❌ Utilisateur introuvable dans ce serveur (ID: ${targetId}).`, ephemeral: true });
          }
          const uid = member.id;
          if (interaction.commandName === 'add') {
            await ch.permissionOverwrites.create(uid, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              AttachFiles: true,
              EmbedLinks: true,
            }).catch(async () => {
              await ch.permissionOverwrites.edit(uid, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
                EmbedLinks: true,
              });
            });
            const canView = ch.permissionsFor(uid)?.has(PermissionsBitField.Flags.ViewChannel) || false;
            if (!canView) {
              const current = ch.permissionOverwrites.cache.map(ow => ({ id: ow.id, allow: ow.allow, deny: ow.deny, type: ow.type }));
              const allowBits = PermissionsBitField.resolve([
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks,
              ]);
              const withoutUser = current.filter(ow => ow.id !== uid);
              await ch.permissionOverwrites.set([
                ...withoutUser,
                { id: uid, allow: allowBits, deny: 0n },
              ]);
            }
            const canViewAfter = ch.permissionsFor(uid)?.has(PermissionsBitField.Flags.ViewChannel) || false;
            const note = canViewAfter ? '' : "\n⚠️ L'utilisateur ne semble toujours pas voir le salon (héritage catégorie ?). Vérifie les permissions de la catégorie et que le bot a 'Gérer les salons'.";
            return interaction.reply({ content: `✅ Accès accordé à <@${uid}>.${note}`, ephemeral: true });
          } else {
            const existing = ch.permissionOverwrites.cache.get(uid);
            if (existing) {
              await ch.permissionOverwrites.delete(uid).catch(async () => {
                await existing.delete('Access removed via /remove');
              });
            } else {
              await ch.permissionOverwrites.edit(uid, {
                ViewChannel: false,
                SendMessages: false,
              });
            }
            const canView = ch.permissionsFor(uid)?.has(PermissionsBitField.Flags.ViewChannel) || false;
            const note = canView ? '' : '';
            return interaction.reply({ content: `✅ Accès retiré à <@${uid}>.${note}`, ephemeral: true });
          }
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          return interaction.reply({ content: `❌ Erreur permissions: ${msg}`, ephemeral: true });
        }
      }
      if (interaction.commandName === 'rename') {
        const guildId = interaction.guild.id;

        const hasChannelManage = interaction.channel?.permissionsFor(interaction.member)?.has(PermissionsBitField.Flags.ManageChannels);
        const allowed = isWhitelisted(guildId, interaction.user.id, interaction.member) || isAdmin(interaction.user.id) || hasChannelManage;
        if (!allowed) {
          return interaction.reply({ content: '❌ Vous n\'êtes pas dans la whitelist pour utiliser cette commande.', ephemeral: true });
        }
        const ch = interaction.channel;
        const isText = !!ch && ch.type === 0;
        const looksLikeTicket = isText && (
          (typeof ch.name === 'string' && ch.name.startsWith('ticket-')) ||
          (typeof ch.topic === 'string' && ch.topic.includes('OPENED_BY:'))
        );
        if (!looksLikeTicket) {
          return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un ticket.', ephemeral: true });
        }
        const desired = interaction.options.getString('name', true);
        const norm = desired
          .replace(/\s+/g, '-')
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .replace(/[^a-z0-9-_]/gi, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase()
          .slice(0, 90);
        const finalName = norm || 'ticket';
        await ch.setName(finalName);
        return interaction.reply({ content: `✅ Ticket renommé en ${finalName}`, ephemeral: true });
      }
      if (interaction.commandName === 'kickpol' || interaction.commandName === 'banpol') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const targetId = interaction.options.getString('id', true).trim();
        const motif = interaction.commandName === 'banpol' ? interaction.options.getString('motif', true) : null;
        await interaction.deferReply({ ephemeral: true });
        const results = [];
        for (const [gid, guild] of interaction.client.guilds.cache) {
          try {
            const g = await interaction.client.guilds.fetch(gid);
            if (interaction.commandName === 'kickpol') {
              const member = await g.members.fetch(targetId).catch(() => null);
              if (!member) {
                results.push({ guild: g, ok: false, reason: 'Utilisateur introuvable' });
              } else {
                await member.kick(`kickpol by ${interaction.user.tag}`);
                results.push({ guild: g, ok: true });
              }
            } else {
              await g.members.ban(targetId, { reason: motif, deleteMessageSeconds: 0 }).catch(async (e) => {
                try {
                  await g.bans.create(targetId, { reason: motif });
                } catch (e2) {
                  throw e2;
                }
              });
              results.push({ guild: g, ok: true });
            }
          } catch (e) {
            results.push({ guild: guild, ok: false, reason: e?.message || String(e) });
          }
        }
        const okCount = results.filter(r => r.ok).length;
        const fail = results.filter(r => !r.ok);
        await interaction.editReply({ content: `Terminé: ${okCount}/${results.length} serveurs.` });

        const guildId = interaction.guild.id;
        const logId = GuildManager.getGuildConfig(guildId).logs?.policeLogs || process.env.POLICE_LOG_CHANNEL_ID;

        try {
          if (logId) {
            const logCh = await interaction.client.channels.fetch(logId);
            const embed = new EmbedBuilder()
              .setTitle(interaction.commandName === 'kickpol' ? 'Kick global' : 'Ban global')
              .setColor(interaction.commandName === 'kickpol' ? 0xf1c40f : 0xe74c3c)
              .addFields(
                { name: 'Cible', value: `<@${targetId}> (${targetId})`, inline: false },
                { name: 'Exécuté par', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                ...(motif ? [{ name: 'Motif', value: motif.slice(0, 1024), inline: false }] : []),
                { name: 'Succès', value: String(okCount), inline: true },
                { name: 'Échecs', value: String(fail.length), inline: true },
              )
              .setTimestamp(new Date());
            if (fail.length) {
              const lines = fail.slice(0, 20).map(r => `- ${r.guild?.name || r.guild?.id}: ${r.reason || 'erreur'}`).join('\n');
              embed.addFields({ name: 'Détails échecs (max 20)', value: lines.slice(0, 1024) || '—', inline: false });
            }
            await logCh.send({ embeds: [embed] });
          }
        } catch { }
        return;
      }
    } else if (interaction.isButton()) {
      if (interaction.customId === 'public_open_ticket') {
        return openTicketFromPublicPanel(interaction, process.env);
      }

      if (interaction.customId.startsWith('antidbl_ok:') || interaction.customId.startsWith('antidbl_bl:')) {
        return handleAntidoubleButton(interaction);
      }

      if (interaction.customId.startsWith('entretien_pass:') || interaction.customId.startsWith('entretien_fail:')) {
        return handleEntretienButton(interaction);
      }
      if (interaction.customId.startsWith('entretien_viewreason:')) return handleEntretienViewReason(interaction);
      if (interaction.customId.startsWith('entretien_revert:'))     return handleEntretienRevert(interaction);

      if (interaction.customId.startsWith('cand_district:')) return handleDistrictButton(interaction);
      if (interaction.customId.startsWith('cand_part2_btn:')) return handlePart2Button(interaction);
      if (interaction.customId.startsWith('cand_accept:')) return handleAcceptButton(interaction);
      if (interaction.customId.startsWith('cand_refuse:')) return handleRefuseButton(interaction);
      if (interaction.customId.startsWith('cand_viewreason:')) return handleViewReasonButton(interaction);
      if (interaction.customId.startsWith('cand_revert:')) return handleRevertButton(interaction);

      if (interaction.customId.startsWith('bl_prev:') || interaction.customId.startsWith('bl_next:') || interaction.customId === 'bl_refresh') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        let page = 0;
        if (interaction.customId.startsWith('bl_prev:')) {
          const curr = Number(interaction.customId.split(':')[1] || '0');
          page = Math.max(0, curr - 1);
        } else if (interaction.customId.startsWith('bl_next:')) {
          const curr = Number(interaction.customId.split(':')[1] || '0');
          page = curr + 1;
        } else {
          const footer = interaction.message.embeds?.[0]?.footer?.text || '';
          const match = footer.match(/Page (\d+)\/(\d+)/);
          if (match) page = Number(match[1]) - 1;
        }
        const { embed, row } = await buildBlEmbed(interaction.client, page);
        return interaction.update({ embeds: [embed], components: [row] });
      }
      if (interaction.customId.startsWith('custom_panel_btn:')) return;
      if (interaction.customId.startsWith('ticket_close:')) return;
      if (interaction.customId.startsWith('ticket_close_confirm:')) return;
      if (interaction.customId === 'ticket_close_cancel_custom') return;
      if (interaction.customId.startsWith('ticket_claim:')) return;
      return handleTicketButtons(interaction, process.env);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_antidbl_bl:')) return handleAntidoubleModal(interaction);

      if (interaction.customId.startsWith('modal_entretien_pass:') || interaction.customId.startsWith('modal_entretien_fail:')) {
        return handleEntretienModal(interaction);
      }

      if (interaction.customId === 'modal_cand_panel_setup') return handleCandidaturePanelModal(interaction);
      if (interaction.customId.startsWith('modal_cand_part1:')) return handleFormPart1(interaction);
      if (interaction.customId.startsWith('modal_cand_part2:')) return handleFormPart2(interaction);
      if (interaction.customId.startsWith('modal_cand_refuse:')) return handleRefuseModal(interaction);

      if (interaction.customId === 'modal_add_bl') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const id = interaction.fields.getTextInputValue('bl_id').trim();
        const uniqueId = interaction.fields.getTextInputValue('bl_unique_id').trim();
        const motif = interaction.fields.getTextInputValue('bl_motif').trim();
        if (!/^\d{16,20}$/.test(id)) {
          return interaction.reply({ content: '❌ ID Discord invalide.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const entry = { id, uniqueId: uniqueId || null, motif: motif.slice(0, 1000), addedBy: interaction.user.id, addedAt: Date.now() };
        addBlacklistEntry(entry);

        const banResults = await banUserFromAllGuilds(interaction.client, id, motif);
        const okCount = banResults.filter(r => r.ok).length;

        const guildId = interaction.guild.id;
        const logId = GuildManager.getGuildConfig(guildId).logs?.policeLogs || process.env.POLICE_LOG_CHANNEL_ID;
        try {
          if (logId) {
            const logCh = await interaction.client.channels.fetch(logId);
            const embed = new EmbedBuilder()
              .setTitle('Ajout Blacklist')
              .setColor(0xe67e22)
              .addFields(
                { name: 'ID', value: `\`${id}\``, inline: true },
                ...(uniqueId ? [{ name: 'ID Unique', value: `\`${uniqueId}\``, inline: true }] : []),
                { name: 'Ajouté par', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                { name: 'Motif', value: motif.slice(0, 1024) || '—', inline: false },
                { name: 'Bans appliqués', value: `${okCount}/${banResults.length} serveurs`, inline: false },
              )
              .setTimestamp(new Date());
            await logCh.send({ embeds: [embed] });
          }
        } catch { }

        return interaction.editReply({ content: `✅ Ajouté à la blacklist et banni de ${okCount}/${banResults.length} serveurs: ${id}` });
      }

      if (interaction.customId === 'modal_remove_bl') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }
        const id = interaction.fields.getTextInputValue('bl_id_remove').trim();
        if (!/^\d{16,20}$/.test(id)) {
          return interaction.reply({ content: '❌ ID Discord invalide.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const removed = getBlacklist().find(e => e.id === id);
        if (!removed) {
          return interaction.editReply({ content: `❌ ID ${id} non trouvé dans la blacklist.` });
        }
        removeBlacklistEntry(id);

        const unbanResults = await unbanUserFromAllGuilds(interaction.client, id);
        const okCount = unbanResults.filter(r => r.ok).length;

        const guildId = interaction.guild.id;
        const logId = GuildManager.getGuildConfig(guildId).logs?.policeLogs || process.env.POLICE_LOG_CHANNEL_ID;
        try {
          if (logId) {
            const logCh = await interaction.client.channels.fetch(logId);
            const embed = new EmbedBuilder()
              .setTitle('Retrait Blacklist')
              .setColor(0x3498db)
              .addFields(
                { name: 'ID', value: `\`${id}\``, inline: true },
                { name: 'Retiré par', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                { name: 'Motif initial', value: removed.motif.slice(0, 1024) || '—', inline: false },
                { name: 'Unbans appliqués', value: `${okCount}/${unbanResults.length} serveurs`, inline: false },
              )
              .setTimestamp(new Date());
            await logCh.send({ embeds: [embed] });
          }
        } catch { }

        return interaction.editReply({ content: `✅ Retiré de la blacklist et débanni de ${okCount}/${unbanResults.length} serveurs: ${id}` });
      }

      if (interaction.customId === 'modal_panel_create') {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }

        const title = interaction.fields.getTextInputValue('panel_title').trim();
        const description = interaction.fields.getTextInputValue('panel_description').trim();
        const colorHex = interaction.fields.getTextInputValue('panel_color').trim() || '3498db';
        const logChannelId = interaction.fields.getTextInputValue('panel_log_channel')?.trim() || null;

        let color = 0x3498db;
        try {
          color = parseInt(colorHex.replace(/^#/, ''), 16);
          if (isNaN(color) || color < 0 || color > 0xFFFFFF) {
            color = 0x3498db;
          }
        } catch (e) {
          color = 0x3498db;
        }

        try {
          const panelId = PanelManager.createPanel({
            embedTitle: title,
            embedDescription: description,
            embedColor: color,
            logChannelId: logChannelId,
            createdBy: interaction.user.id,
          }, interaction.guild.id);

          return interaction.reply({
            content: `✅ Panel créé avec succès!\n\n**ID du panel:** \`${panelId}\`\n\nUtilisez \`/panel-custom add-button ${panelId}\` pour ajouter des boutons (max 3).`,
            ephemeral: true
          });
        } catch (e) {
          error('Error creating panel:', e);
          return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
        }
      }

      if (interaction.customId.startsWith('modal_panel_add_button:')) {
        if (!isAdmin(interaction.user.id)) {
          return interaction.reply({ content: '❌ Réservé aux admins du bot.', ephemeral: true });
        }

        const panelId = interaction.customId.split(':')[1];
        const label = interaction.fields.getTextInputValue('button_label').trim();
        const emoji = interaction.fields.getTextInputValue('button_emoji').trim() || null;
        const categoryId = interaction.fields.getTextInputValue('button_category').trim();
        const rolesInput = interaction.fields.getTextInputValue('button_roles').trim();
        const prefix = interaction.fields.getTextInputValue('button_prefix').trim() || 'ticket';

        const roleIds = rolesInput.split(',').map(id => id.trim()).filter(id => id.length > 0);

        if (roleIds.length === 0) {
          return interaction.reply({ content: '❌ Vous devez spécifier au moins un rôle.', ephemeral: true });
        }

        try {
          const category = await interaction.guild.channels.fetch(categoryId);
          if (!category || category.type !== 4) {
            return interaction.reply({ content: '❌ Catégorie invalide ou introuvable.', ephemeral: true });
          }
        } catch (e) {
          return interaction.reply({ content: '❌ Catégorie invalide ou introuvable.', ephemeral: true });
        }

        for (const roleId of roleIds) {
          try {
            const role = await interaction.guild.roles.fetch(roleId);
            if (!role) {
              return interaction.reply({ content: `❌ Rôle \`${roleId}\` introuvable.`, ephemeral: true });
            }
          } catch (e) {
            return interaction.reply({ content: `❌ Rôle \`${roleId}\` invalide.`, ephemeral: true });
          }
        }

        try {
          const buttonId = PanelManager.addButtonToPanel(panelId, {
            label,
            emoji,
            categoryId,
            roleIds,
            ticketNamePrefix: prefix,
          });

          const panel = PanelManager.getPanel(panelId);
          const remaining = 25 - panel.buttons.length;

          return interaction.reply({
            content: `✅ Bouton ajouté avec succès!\n\n**Boutons:** ${panel.buttons.length}/25\n${remaining > 0 ? `Vous pouvez encore ajouter ${remaining} bouton(s).` : 'Maximum atteint!'}\n\nUtilisez \`/panel-custom publish ${panelId}\` pour publier le panel.`,
            ephemeral: true
          });
        } catch (e) {
          error('Error adding button:', e);
          return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
        }
      }

      if (interaction.customId.startsWith('modal_panel_edit:')) {
        const panelId = interaction.customId.split(':')[1];
        const title = interaction.fields.getTextInputValue('panel_title').trim();
        const description = interaction.fields.getTextInputValue('panel_description').trim();
        const colorHex = interaction.fields.getTextInputValue('panel_color').trim();

        const updates = {};
        if (title) updates.embedTitle = title;
        if (description) updates.embedDescription = description;
        if (colorHex) {
          let color = parseInt(colorHex.replace(/^#/, ''), 16);
          if (!isNaN(color) && color >= 0 && color <= 0xFFFFFF) {
            updates.embedColor = color;
          }
        }

        try {
          PanelManager.updatePanel(panelId, updates);
          await refreshPublishedPanel(interaction.client, panelId);
          return interaction.reply({ content: `✅ Panel modifié avec succès et mis à jour.`, ephemeral: true });
        } catch (e) {
          return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
        }
      }

      if (interaction.customId.startsWith('modal_panel_edit_button:')) {
        const parts = interaction.customId.split(':');
        const panelId = parts[1];
        const buttonId = parts[2];

        const label = interaction.fields.getTextInputValue('button_label').trim();
        const emoji = interaction.fields.getTextInputValue('button_emoji').trim();
        const categoryId = interaction.fields.getTextInputValue('button_category').trim();
        const rolesInput = interaction.fields.getTextInputValue('button_roles').trim();
        const prefix = interaction.fields.getTextInputValue('button_prefix').trim();

        const updates = {};
        if (label) updates.label = label;
        if (emoji) updates.emoji = emoji;
        if (categoryId) {
          try {
            const cat = await interaction.guild.channels.fetch(categoryId);
            if (!cat || cat.type !== 4) throw new Error('Catégorie invalide');
            updates.categoryId = categoryId;
          } catch (e) {
            return interaction.reply({ content: '❌ ID Catégorie invalide.', ephemeral: true });
          }
        }
        if (rolesInput) {
          const rIds = rolesInput.split(',').map(id => id.trim()).filter(id => id.length > 0);
          for (const rid of rIds) {
            try { await interaction.guild.roles.fetch(rid); } catch { return interaction.reply({ content: `❌ Rôle ${rid} introuvable.`, ephemeral: true }); }
          }
          updates.roleIds = rIds;
        }
        if (prefix) updates.ticketNamePrefix = prefix;

        try {
          PanelManager.updateButton(panelId, buttonId, updates);
          await refreshPublishedPanel(interaction.client, panelId);
          return interaction.reply({ content: `✅ Bouton modifié avec succès et panel mis à jour.`, ephemeral: true });
        } catch (e) {
          return interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
        }
      }

      if (interaction.customId.startsWith('modal_button_welcome:')) {
        const parts    = interaction.customId.split(':');
        const panelId  = parts[1];
        const buttonId = parts[2];
        const panel = PanelManager.getPanel(panelId);
        if (!panel) return interaction.reply({ content: '❌ Panel introuvable.', ephemeral: true });
        const btn = panel.buttons.find(b => b.id === buttonId);
        if (!btn) return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });

        const title   = interaction.fields.getTextInputValue('welcome_title').trim();
        const message = interaction.fields.getTextInputValue('welcome_message').trim();
        PanelManager.updateButtonWelcome(panelId, buttonId, title || null, message || null);
        return interaction.reply({ content: `✅ Message d'ouverture mis à jour pour le bouton **${btn.label}**.`, ephemeral: true });
      }
    }
  } catch (err) {
    error('interactionCreate error:', err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }); } catch { }
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('custom_panel_btn:')) return;

    const buttonId = interaction.customId.split(':')[1];
    const result = PanelManager.findPanelByButtonId(buttonId);

    if (!result) {
      return interaction.reply({ content: '❌ Configuration du bouton introuvable.', ephemeral: true });
    }

    const { panel, button } = result;

    await interaction.deferReply({ ephemeral: true });

    try {
      const category = await interaction.guild.channels.fetch(button.categoryId);
      if (!category || category.type !== 4) {
        return interaction.editReply({ content: '❌ Catégorie configurée invalide.' });
      }

      const ticketName = `${button.ticketNamePrefix}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

      const permissionOverwrites = [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
      ];

      for (const roleId of button.roleIds) {
        permissionOverwrites.push({
          id: roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        });
      }

      const effectiveLogId = button.logChannelId || panel.logChannelId || null;

      const ticketChannel = await interaction.guild.channels.create({
        name: ticketName,
        type: 0,
        parent: category.id,
        topic: `OPENED_BY:${interaction.user.id}${effectiveLogId ? ` LOG_CHANNEL_ID:${effectiveLogId}` : ''}`,
        permissionOverwrites,
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(button.welcomeTitle || `Ticket: ${button.label}`)
        .setDescription(button.welcomeMessage || 'Votre ticket a été créé. L\'équipe vous répondra bientôt.')
        .setColor(panel.embedColor)
        .setFooter({ text: `Ticket ID: ${ticketChannel.id}` })
        .setTimestamp(new Date());

      const managementRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_close:${ticketChannel.id}`)
          .setLabel('Fermer')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket_claim:${ticketChannel.id}`)
          .setLabel('Claim')
          .setEmoji('✋')
          .setStyle(ButtonStyle.Primary),
      );

      await ticketChannel.send({
        content: `${interaction.user}`,
        embeds: [welcomeEmbed],
        components: [managementRow]
      });

      return interaction.editReply({ content: `✅ Ticket créé: ${ticketChannel}` });
    } catch (e) {
      error('Error creating custom ticket:', e);
      return interaction.editReply({ content: `❌ Erreur lors de la création du ticket: ${e.message}` });
    }
  } catch (err) {
    error('Custom panel button error:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('ticket_close:')) {
      const channelId = interaction.customId.split(':')[1];

      if (interaction.channel.id !== channelId) {
        return interaction.reply({ content: '❌ Erreur: ID de canal invalide.', ephemeral: true });
      }

      const hasManage = interaction.channel.permissionsFor(interaction.member)?.has(PermissionsBitField.Flags.ManageChannels);
      if (!hasManage && !isAdmin(interaction.user.id)) {
        return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé à fermer ce ticket.', ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close_confirm:${channelId}`).setLabel('Confirmer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_close_cancel_custom').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({ content: 'Confirmer la fermeture du ticket ?', components: [row], ephemeral: true });
    }

    if (interaction.customId.startsWith('ticket_close_confirm:')) {
      const channelId = interaction.customId.split(':')[1];

      if (interaction.channel.id !== channelId) {
        return interaction.reply({ content: '❌ Erreur: ID de canal invalide.', ephemeral: true });
      }

      await interaction.deferUpdate();

      const channel = interaction.channel;
      const closerId = interaction.user.id;
      const topic = channel.topic || '';
      const openedBy = extractMeta(topic, 'OPENED_BY');
      const claimedBy = extractMeta(topic, 'CLAIMED_BY');

      const transcript = await buildTranscript(channel);
      const bomPlusContent = '﻿' + transcript;
      const file = new AttachmentBuilder(Buffer.from(bomPlusContent, 'utf8'), { name: `${channel.name}_transcript.txt` });

      try {
        const guildId = interaction.guild.id;
        const topic = channel.topic || '';
        const customLogId = extractMeta(topic, 'LOG_CHANNEL_ID');
        const logChannelId = customLogId || GuildManager.getGuildConfig(guildId).logs?.ticketLogs;

        if (logChannelId) {
          const logChannel = await interaction.client.channels.fetch(logChannelId);
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
      } catch (e) {
        error('Error sending transcript to log channel:', e);
      }

      await channel.delete('Ticket fermé');
      return;
    }

    if (interaction.customId === 'ticket_close_cancel_custom') {
      return interaction.update({ content: 'Fermeture annulée.', components: [] });
    }

    if (interaction.customId.startsWith('ticket_claim:')) {
      const channelId = interaction.customId.split(':')[1];

      if (interaction.channel.id !== channelId) {
        return interaction.reply({ content: '❌ Erreur: ID de canal invalide.', ephemeral: true });
      }

      const hasManage = interaction.channel.permissionsFor(interaction.member)?.has(PermissionsBitField.Flags.ManageChannels);
      if (!hasManage && !isAdmin(interaction.user.id)) {
        return interaction.reply({ content: '❌ Vous n\'êtes pas autorisé à claim ce ticket.', ephemeral: true });
      }

      const topic = interaction.channel.topic || '';
      const claimedBy = extractMeta(topic, 'CLAIMED_BY');

      if (claimedBy) {
        return interaction.reply({ content: `Ticket déjà pris en charge par <@${claimedBy}>.`, ephemeral: true });
      }

      await interaction.channel.setTopic(setMeta(topic, 'CLAIMED_BY', interaction.user.id));

      const claimEmbed = new EmbedBuilder()
        .setDescription(`✋ Ticket pris en charge par ${interaction.user}`)
        .setColor(0x3498db)
        .setTimestamp(new Date());

      await interaction.reply({ embeds: [claimEmbed] });
    }
  } catch (err) {
    error('Ticket management button error:', err);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author?.bot) return;

    const contentSnippet = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    const { blocked, justBlocked, history } = rateLimiter.check(message.author.id, 'message', `Message: ${contentSnippet}`);

    if (blocked) {
      if (justBlocked) {
        const guildId = message.guild.id;
        const securityLogId = GuildManager.getGuildConfig(guildId).logs?.securityLogs;

        if (securityLogId) {
          try {
            const logCh = await message.client.channels.fetch(securityLogId);
            if (logCh) {
              const embed = new EmbedBuilder()
                .setTitle('🛡️ Sécurité : Utilisateur Bloqué (Rate Limit)')
                .setColor(0xff0000)
                .setThumbnail(message.author.displayAvatarURL())
                .addFields(
                  { name: 'Utilisateur', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
                  { name: 'Raison', value: 'Spam de messages (5 msgs / 10s)', inline: true },
                  { name: 'Durée', value: '2 minutes', inline: true },
                  { name: 'Dernières Actions', value: history.map(h => `\`${new Date(h.timestamp).toLocaleTimeString()}\` ${h.detail}`).join('\n') || 'Aucune' }
                )
                .setTimestamp();
              await logCh.send({ embeds: [embed] });
            }
          } catch (e) { error('Failed to send security log', e); }
        }
      }
      return;
    }

    const ch = message.channel;
    const isText = !!ch && ch.type === 0;
    const looksLikeTicket = isText && (
      (typeof ch.name === 'string' && ch.name.startsWith('ticket-')) ||
      (typeof ch.topic === 'string' && ch.topic.includes('OPENED_BY:'))
    );

    const content = (message.content || '').trim();

    if (content.toLowerCase() === '!alert') {
      if (!looksLikeTicket) {
        await message.reply({ content: '❌ Cette commande ne peut être utilisée que dans un ticket.' });
        return;
      }

      const allowed = isWhitelisted(message.guild.id, message.author.id, message.member) || isAdmin(message.author.id);
      if (!allowed) {
        await message.reply({ content: '❌ Réservé aux utilisateurs whitelistés.' });
        return;
      }

      const set = alertWatch.get(ch.id) || new Set();
      set.add(message.author.id);
      alertWatch.set(ch.id, set);
      await message.reply({ content: '✅ Alerte activée : je vous mentionnerai au prochain message dans ce ticket.' });
      return;
    }

    if (content.startsWith('+')) {
      const args = content.slice(1).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      if (command === 'wl') {
        if (!isAdmin(message.author.id)) {
          return message.reply('❌ Réservé aux administrateurs du bot.');
        }
        if (args.length < 1) return message.reply('❌ Usage: `+wl <@role|@user|id>`');
        const raw = args[0].trim();

        // Parse mention formats: <@&roleId> or <@userId> or <@!userId>
        const roleMentionMatch = raw.match(/^<@&(\d{17,20})>$/);
        const userMentionMatch = raw.match(/^<@!?(\d{17,20})>$/);
        const rawId = roleMentionMatch?.[1] ?? userMentionMatch?.[1] ?? raw;

        if (!/^\d{17,20}$/.test(rawId)) return message.reply('❌ ID invalide. Utilisez une mention ou un ID Discord.');

        let type = 'user';
        if (roleMentionMatch) {
          type = 'role';
        } else if (!userMentionMatch) {
          const fetchedRole = await message.guild.roles.fetch(rawId).catch(() => null);
          if (fetchedRole) type = 'role';
        }

        const added = addToWhitelist(message.guild.id, rawId, type);
        if (added) {
          message.reply(`✅ **${type === 'role' ? 'Rôle' : 'Utilisateur'}** ajouté à la whitelist pour ce serveur : \`${rawId}\``);
        } else {
          message.reply(`⚠️ Cet ID est déjà dans la whitelist de ce serveur.`);
        }
        return;
      }

      if (command === 'unwl') {
        if (!isAdmin(message.author.id)) {
          return message.reply('❌ Réservé aux administrateurs du bot.');
        }
        if (args.length < 1) return message.reply('❌ Usage: `+unwl <@role|@user|id>`');
        const raw = args[0].trim();

        const roleMentionMatch = raw.match(/^<@&(\d{17,20})>$/);
        const userMentionMatch = raw.match(/^<@!?(\d{17,20})>$/);
        const rawId = roleMentionMatch?.[1] ?? userMentionMatch?.[1] ?? raw;

        if (!/^\d{17,20}$/.test(rawId)) return message.reply('❌ ID invalide. Utilisez une mention ou un ID Discord.');

        const removed = removeFromWhitelist(message.guild.id, rawId);
        if (removed) {
          message.reply(`✅ ID retiré de la whitelist pour ce serveur : \`${rawId}\``);
        } else {
          message.reply(`⚠️ ID non trouvé dans la whitelist de ce serveur.`);
        }
        return;
      }

      if (command === 'wllist') {
        if (!isAdmin(message.author.id)) {
          return message.reply('❌ Réservé aux administrateurs du bot.');
        }

        const wl = getWhitelist(message.guild.id);
        const userList = wl.users.length > 0 ? wl.users.map(id => `<@${id}> (\`${id}\`)`).join('\n') : '_Aucun utilisateur_';
        const roleList = wl.roles.length > 0 ? wl.roles.map(id => `<@&${id}> (\`${id}\`)`).join('\n') : '_Aucun rôle_';

        const embed = new EmbedBuilder()
          .setTitle(`Whitelist du serveur`)
          .setColor(0x2ecc71)
          .addFields(
            { name: `Utilisateurs (${wl.users.length})`, value: userList, inline: false },
            { name: `Rôles (${wl.roles.length})`, value: roleList, inline: false }
          )
          .setFooter({ text: `Server ID: ${message.guild.id}` })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    }

    const armed = alertWatch.get(ch.id);
    if (looksLikeTicket && armed && armed.size > 0) {
      const mentions = Array.from(armed).map(id => `<@${id}>`).join(' ');
      alertWatch.delete(ch.id);
      await ch.send({ content: `🔔 Nouveau message dans ce ticket. ${mentions}` });
    }
  } catch (e) {
    error('messageCreate error:', e);
  }
});

import { loadUserSheets, saveUserSheets } from './utils/sheetData.js';
import { parseSheetUrl } from './utils/googleUtils.js';

client.on('messageCreate', async (message) => {
  if (message.content.startsWith('LINK_ME')) {
    try {
      const args = message.content.split(' ');
      if (args.length < 3) return;

      const targetUserId = args[1];
      const sheetUrlOrId = args[2];

      let parsed = parseSheetUrl(sheetUrlOrId);
      if (!parsed && !sheetUrlOrId.includes('http')) {
        parsed = { spreadsheetId: sheetUrlOrId, gid: '0' };
      }
      if (!parsed && sheetUrlOrId.includes('http')) {
        parsed = parseSheetUrl(sheetUrlOrId);
      }

      if (parsed) {
        const sheets = loadUserSheets();
        sheets[targetUserId] = parsed;
        saveUserSheets(sheets);

        console.log(`[AUTO-LINK] Linked user ${targetUserId} to Sheet ${parsed.spreadsheetId}`);
        await message.react('✅');
      }
    } catch (e) {
      console.error('[AUTO-LINK ERROR]', e);
    }
  }
});

setInterval(async () => {
  const now = Date.now();
  const expired = getBlacklist().filter(e => e.expiresAt && e.expiresAt <= now);
  if (!expired.length) return;

  for (const entry of expired) {
    removeBlacklistEntry(entry.id);
    for (const [, guild] of client.guilds.cache) {
      try {
        const g = await client.guilds.fetch(guild.id);
        await g.members.unban(entry.id, 'Blacklist expirée').catch(() => { });
      } catch { }
    }
    log(`[AutoUnban] ${entry.id} débanni — blacklist expirée`);
  }
}, 10 * 60 * 1000);

client.on('messageCreate', async (message) => {
  if (message.author.bot && !message.webhookId) return;

  if (message.webhookId) {
    if (message.content?.startsWith('ENTRETIEN_DATA:') && message.guild) {
      await processEntretienWebhook(client, message).catch(e => error('[Entretien] Webhook error:', e));
    }
    return;
  }

  const channelId = message.channel.id;

  const watcherCfg = getWatcherConfig();
  if (watcherCfg.sourceChannelIds.includes(channelId)) {
    if (hasDepartureKeyword(message.content)) {
      await forwardDepartureMessage(client, message).catch(e => error('[Watcher] forward error:', e));
    }
  }

  const mirrorCfg = getMirrorConfig();
  if (mirrorCfg.mirrors[channelId]) {
    await forwardMirrorMessage(client, message).catch(e => error('[Mirror] forward error:', e));
  }
});

client.login(DISCORD_TOKEN).catch((e) => {
  error('Failed to login:', e);
  process.exit(1);
});

async function refreshPublishedPanel(client, panelId) {
  const panel = PanelManager.getPanel(panelId);
  if (!panel || !panel.messageId || !panel.channelId) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    const embed = new EmbedBuilder()
      .setTitle(panel.embedTitle)
      .setDescription(panel.embedDescription)
      .setColor(panel.embedColor)
      .setTimestamp(new Date());

    const rows = [];
    let currentRow = new ActionRowBuilder();

    panel.buttons.forEach((btn, index) => {
      const button = new ButtonBuilder()
        .setCustomId(`custom_panel_btn:${btn.id}`)
        .setLabel(btn.label)
        .setStyle(ButtonStyle.Primary);

      if (btn.emoji) {
        button.setEmoji(btn.emoji);
      }

      currentRow.addComponents(button);

      if ((index + 1) % 5 === 0 || index === panel.buttons.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
    });

    await message.edit({ embeds: [embed], components: rows });
  } catch (e) {
    error(`Failed to refresh panel ${panelId}:`, e);
  }
}
