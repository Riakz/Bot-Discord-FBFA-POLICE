import { EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import {
  getFtoConfig,
  addFtoRole,
  removeFtoRole,
  setFtoLogChannel,
  setFtoDmAccept,
  setFtoDmRefus,
  setFtoPendingDays,
} from '../utils/ftoConfig.js';
import {
  getFtoPending,
  addFtoPending,
  removeFtoPending,
  isFtoPending,
  getExpiredPending,
} from '../utils/ftoPending.js';

// ─── Log helper ───────────────────────────────────────────────────────────────

async function sendFtoLog(client, guildId, type, userId) {
  const cfg = getFtoConfig(guildId);
  if (!cfg.logChannelId) return;
  try {
    const ch = await client.channels.fetch(cfg.logChannelId);
    if (!ch?.isTextBased()) return;
    const content = type === 'accept'
      ? `# Field Training Opérations <:ftoLogo:1399709276351762554>\n\n- <@${userId}>`
      : `# Field Training Opérations :x:\n\n<@${userId}>`;
    await ch.send({ content });
  } catch (e) {
    error('[FTO] Erreur envoi log:', e);
  }
}

// ─── /fto-ajout ───────────────────────────────────────────────────────────────

export async function handleFtoAjout(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const guildId = interaction.guild.id;
  const cfg = getFtoConfig(guildId);

  if (cfg.roleIds.length === 0) {
    return interaction.reply({ content: '❌ Aucun rôle FTO configuré. Utilisez `/config-fto add-role`.', ephemeral: true });
  }

  const user = interaction.options.getUser('member', true);
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return interaction.reply({ content: '❌ Membre introuvable sur ce serveur.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    for (const roleId of cfg.roleIds) {
      await target.roles.add(roleId).catch(e => error(`[FTO] Ajout rôle ${roleId}:`, e));
    }

    addFtoPending(guildId, target.id, interaction.user.id, cfg.pendingDays);

    if (cfg.dmAccept) {
      try {
        await target.send({ content: cfg.dmAccept.replace('{mention}', `<@${target.id}>`).replace('{username}', target.displayName) });
      } catch { }
    }

    await sendFtoLog(interaction.client, guildId, 'accept', target.id);

    return interaction.editReply({
      content: `✅ <@${target.id}> accepté(e) dans le FTO. Rôles ajoutés, délai de **${cfg.pendingDays} jours** démarré.`,
    });
  } catch (e) {
    error('[FTO] Erreur ajout:', e);
    return interaction.editReply({ content: `❌ Erreur: ${e.message}` });
  }
}

// ─── /fto-refus ───────────────────────────────────────────────────────────────

export async function handleFtoRefus(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const guildId = interaction.guild.id;
  const cfg = getFtoConfig(guildId);

  const user = interaction.options.getUser('member', true);
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return interaction.reply({ content: '❌ Membre introuvable sur ce serveur.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  try {
    for (const roleId of cfg.roleIds) {
      await target.roles.remove(roleId).catch(e => error(`[FTO] Retrait rôle ${roleId}:`, e));
    }

    if (cfg.dmRefus) {
      try {
        await target.send({ content: cfg.dmRefus.replace('{mention}', `<@${target.id}>`).replace('{username}', target.displayName) });
      } catch { }
    }

    await sendFtoLog(interaction.client, guildId, 'refuse', target.id);

    return interaction.editReply({ content: `✅ Rôles retirés et <@${target.id}> notifié(e) du refus.` });
  } catch (e) {
    error('[FTO] Erreur refus:', e);
    return interaction.editReply({ content: `❌ Erreur: ${e.message}` });
  }
}

// ─── /fto-valider ─────────────────────────────────────────────────────────────

export async function handleFtoValider(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const guildId = interaction.guild.id;
  const user = interaction.options.getUser('member', true);
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return interaction.reply({ content: '❌ Membre introuvable sur ce serveur.', ephemeral: true });

  if (!isFtoPending(guildId, target.id)) {
    return interaction.reply({ content: `⚠️ <@${target.id}> n'est pas dans la liste FTO en attente.`, ephemeral: true });
  }

  removeFtoPending(guildId, target.id);
  return interaction.reply({ content: `✅ Intégration de <@${target.id}> confirmée. Timer annulé.`, ephemeral: true });
}

// ─── /fto-liste ───────────────────────────────────────────────────────────────

export async function handleFtoListe(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const guildId = interaction.guild.id;
  const pending = getFtoPending(guildId);
  const entries = Object.entries(pending);

  if (entries.length === 0) {
    return interaction.reply({ content: '📋 Aucun agent en période FTO sur ce serveur.', ephemeral: true });
  }

  const now = Date.now();
  const sorted = entries
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => a.deadline - b.deadline);

  const PAGE = 20;
  const page = interaction.options.getInteger('page') ?? 1;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const slice = sorted.slice((page - 1) * PAGE, page * PAGE);

  const lines = slice.map(entry => {
    const remaining = entry.deadline - now;
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const expired = remaining <= 0;
    const deadline = `<t:${Math.floor(entry.deadline / 1000)}:R>`;
    const status = expired ? '**⚠️ EXPIRÉ**' : `reste ${days}j ${hours}h (échéance ${deadline})`;
    return `<@${entry.userId}> | ${status} | état: ${expired ? 'expiré' : 'pending'}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`Agents en période FTO (${sorted.length}) — page ${page}/${totalPages}`)
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /config-fto ──────────────────────────────────────────────────────────────

export async function handleConfigFto(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const cfg = getFtoConfig(guildId);

  if (sub === 'add-role') {
    const role = interaction.options.getRole('role', true);
    const added = addFtoRole(guildId, role.id);
    return interaction.reply({
      content: added ? `✅ Rôle <@&${role.id}> ajouté aux rôles FTO.` : `⚠️ Ce rôle est déjà dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-role') {
    const role = interaction.options.getRole('role', true);
    const removed = removeFtoRole(guildId, role.id);
    return interaction.reply({
      content: removed ? `✅ Rôle <@&${role.id}> retiré.` : `⚠️ Ce rôle n'est pas dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'set-log') {
    const channelId = interaction.options.getString('channel-id', true).trim();
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return interaction.reply({ content: '❌ Salon invalide.', ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Salon introuvable.', ephemeral: true });
    }
    setFtoLogChannel(guildId, channelId);
    return interaction.reply({ content: `✅ Salon de log FTO défini sur <#${channelId}>.`, ephemeral: true });
  }

  if (sub === 'set-pending-days') {
    const days = interaction.options.getInteger('days', true);
    setFtoPendingDays(guildId, days);
    return interaction.reply({ content: `✅ Délai d'intégration défini à **${days} jours**.`, ephemeral: true });
  }

  if (sub === 'set-dm-accept') {
    const modal = new ModalBuilder()
      .setCustomId('fto_dm_accept_modal')
      .setTitle('Message DM — Acceptation FTO');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dm_text')
          .setLabel('Message envoyé en DM à l\'agent accepté')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(cfg.dmAccept || '')
          .setPlaceholder('Utilisez {mention} pour mentionner l\'agent, {username} pour son pseudo.')
          .setRequired(false)
          .setMaxLength(2000)
      )
    );
    return interaction.showModal(modal);
  }

  if (sub === 'set-dm-refus') {
    const modal = new ModalBuilder()
      .setCustomId('fto_dm_refus_modal')
      .setTitle('Message DM — Refus FTO');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dm_text')
          .setLabel('Message envoyé en DM à l\'agent refusé')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(cfg.dmRefus || '')
          .setPlaceholder('Utilisez {mention} pour mentionner l\'agent, {username} pour son pseudo.')
          .setRequired(false)
          .setMaxLength(2000)
      )
    );
    return interaction.showModal(modal);
  }

  if (sub === 'show') {
    const roles = cfg.roleIds.length > 0 ? cfg.roleIds.map(id => `<@&${id}>`).join(', ') : '_Aucun_';
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuration FTO')
      .setColor(0x3498db)
      .addFields(
        { name: 'Rôles FTO',       value: roles, inline: false },
        { name: 'Salon de log',    value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '❌ Non défini', inline: true },
        { name: 'Délai',           value: `${cfg.pendingDays} jours`, inline: true },
        { name: 'DM Acceptation',  value: cfg.dmAccept ? `\`\`\`${cfg.dmAccept.slice(0, 300)}\`\`\`` : '_Non défini_', inline: false },
        { name: 'DM Refus',        value: cfg.dmRefus  ? `\`\`\`${cfg.dmRefus.slice(0, 300)}\`\`\``  : '_Non défini_', inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

// ─── Modal submit handlers ────────────────────────────────────────────────────

export function handleFtoDmAcceptModal(interaction) {
  const text = interaction.fields.getTextInputValue('dm_text').trim();
  setFtoDmAccept(interaction.guild.id, text);
  return interaction.reply({ content: '✅ Message DM d\'acceptation mis à jour.', ephemeral: true });
}

export function handleFtoDmRefusModal(interaction) {
  const text = interaction.fields.getTextInputValue('dm_text').trim();
  setFtoDmRefus(interaction.guild.id, text);
  return interaction.reply({ content: '✅ Message DM de refus mis à jour.', ephemeral: true });
}

// ─── Auto-kick (toutes les heures) ───────────────────────────────────────────

export async function runFtoAutoKick(client) {
  const expired = getExpiredPending();
  if (expired.length === 0) return;

  for (const entry of expired) {
    try {
      const cfg = getFtoConfig(entry.guildId);
      try {
        const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
        if (!guild) { removeFtoPending(entry.guildId, entry.userId); continue; }
        const member = await guild.members.fetch(entry.userId).catch(() => null);
        if (member) {
          for (const roleId of cfg.roleIds) {
            await member.roles.remove(roleId).catch(() => {});
          }
        }
        await sendFtoLog(client, entry.guildId, 'kick', entry.userId);
      } catch { }
      removeFtoPending(entry.guildId, entry.userId);
    } catch (e) {
      error(`[FTO] Erreur auto-kick ${entry.userId}:`, e);
    }
  }
}
