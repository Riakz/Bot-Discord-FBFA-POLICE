import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import {
  getWatcherConfig,
  addWatcherSource,
  removeWatcherSource,
  addWatcherTarget,
  removeWatcherTarget,
} from '../utils/watcherConfig.js';

function normalize(str) {
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const DEPARTURE_WORDS = [
  'licenciement', 'licencie', 'licencier',
  'demission', 'demissionne', 'demissionner', 'demis',
  'depart',
  'quitte', 'quitter',
  'resignation',
  'congedie', 'congediement',
  'renvoye', 'renvoyer',
  'vire',
  'exclu', 'exclusion',
  'degage', 'degager',
];

const DEPARTURE_PHRASES = [
  'je pars', 'je me tire', 'je me barre', 'je quitte',
  'fin de contrat', 'fin du contrat',
  'mise a la porte',
];

export function hasDepartureKeyword(text) {
  if (!text) return false;
  const norm = normalize(text);
  if (DEPARTURE_PHRASES.some(p => norm.includes(p))) return true;
  return DEPARTURE_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(norm));
}

export async function forwardDepartureMessage(client, message) {
  const cfg = getWatcherConfig();
  if (!cfg.targetChannelIds.length) return;

  const content = message.content || '';
  const text = (content ? content + '\n' : '') + `-# <@${message.author.id}>`;

  const files = message.attachments.size > 0
    ? [...message.attachments.values()].map(a => new AttachmentBuilder(a.url, { name: a.name }))
    : [];

  for (const targetId of cfg.targetChannelIds) {
    try {
      const ch = await client.channels.fetch(targetId);
      if (!ch?.isTextBased()) continue;
      await ch.send({ content: text, files });
    } catch (e) {
      error(`[Watcher] Erreur envoi vers ${targetId}:`, e);
    }
  }
}

export async function handleDepartWatcher(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const channelId = interaction.options.getString('channel-id')?.trim();

  if (sub === 'add-source') {
    const added = addWatcherSource(channelId);
    return interaction.reply({
      content: added
        ? `✅ Salon \`${channelId}\` ajouté aux sources surveillées.`
        : `⚠️ Ce salon est déjà surveillé.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-source') {
    const removed = removeWatcherSource(channelId);
    return interaction.reply({
      content: removed
        ? `✅ Salon \`${channelId}\` retiré des sources.`
        : `⚠️ Salon introuvable dans les sources.`,
      ephemeral: true,
    });
  }

  if (sub === 'add-target') {
    const added = addWatcherTarget(channelId);
    return interaction.reply({
      content: added
        ? `✅ Salon \`${channelId}\` ajouté aux destinations.`
        : `⚠️ Ce salon est déjà dans les destinations.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-target') {
    const removed = removeWatcherTarget(channelId);
    return interaction.reply({
      content: removed
        ? `✅ Salon \`${channelId}\` retiré des destinations.`
        : `⚠️ Salon introuvable dans les destinations.`,
      ephemeral: true,
    });
  }

  if (sub === 'show') {
    const cfg = getWatcherConfig();
    const sources = cfg.sourceChannelIds.length > 0
      ? cfg.sourceChannelIds.map(id => `<#${id}> (\`${id}\`)`).join('\n')
      : '_Aucun salon surveillé_';
    const targets = cfg.targetChannelIds.length > 0
      ? cfg.targetChannelIds.map(id => `<#${id}> (\`${id}\`)`).join('\n')
      : '_Aucune destination configurée_';

    const embed = new EmbedBuilder()
      .setTitle('📡 Watcher Départs')
      .setColor(0xe74c3c)
      .addFields(
        { name: '🔍 Salons surveillés (sources)', value: sources, inline: false },
        { name: '📤 Destinations', value: targets, inline: false },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
