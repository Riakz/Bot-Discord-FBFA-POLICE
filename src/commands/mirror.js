import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error } from '../utils/logger.js';
import {
  getMirrorConfig,
  addMirror,
  removeMirror,
  clearMirror,
} from '../utils/mirrorConfig.js';

export async function forwardMirrorMessage(client, message) {
  const cfg = getMirrorConfig();
  const targets = cfg.mirrors[message.channel.id];
  if (!targets?.length) return;

  const displayName = message.member?.displayName ?? message.author.displayName;
  const content = message.content || '';
  const text = `**${displayName}** : ${content}`;

  const files = message.attachments.size > 0
    ? [...message.attachments.values()].map(a => new AttachmentBuilder(a.url, { name: a.name }))
    : [];

  for (const targetId of targets) {
    try {
      const ch = await client.channels.fetch(targetId);
      if (!ch?.isTextBased()) continue;
      await ch.send({ content: text, files });
    } catch (e) {
      error(`[Mirror] Erreur envoi vers ${targetId}:`, e);
    }
  }
}

export async function handleMirror(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const sourceId = interaction.options.getString('source-id', true).trim();
    const rawTargets = interaction.options.getString('target-id', true);
    const targetIds = rawTargets.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

    const results = targetIds.map(id => ({ id, added: addMirror(sourceId, id) }));
    const added   = results.filter(r => r.added).map(r => `\`${r.id}\``);
    const skipped = results.filter(r => !r.added).map(r => `\`${r.id}\``);

    const lines = [];
    if (added.length)   lines.push(`✅ Ajouté${added.length > 1 ? 's' : ''} : ${added.join(', ')}`);
    if (skipped.length) lines.push(`⚠️ Déjà présent${skipped.length > 1 ? 's' : ''} : ${skipped.join(', ')}`);

    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'remove') {
    const sourceId = interaction.options.getString('source-id', true).trim();
    const rawTargets = interaction.options.getString('target-id', true);
    const targetIds = rawTargets.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

    const results  = targetIds.map(id => ({ id, removed: removeMirror(sourceId, id) }));
    const removed  = results.filter(r => r.removed).map(r => `\`${r.id}\``);
    const notFound = results.filter(r => !r.removed).map(r => `\`${r.id}\``);

    const lines = [];
    if (removed.length)  lines.push(`✅ Supprimé${removed.length > 1 ? 's' : ''} : ${removed.join(', ')}`);
    if (notFound.length) lines.push(`⚠️ Introuvable${notFound.length > 1 ? 's' : ''} : ${notFound.join(', ')}`);

    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'clear') {
    const sourceId = interaction.options.getString('source-id', true).trim();
    const cleared = clearMirror(sourceId);
    return interaction.reply({
      content: cleared
        ? `✅ Toutes les destinations du salon \`${sourceId}\` supprimées.`
        : `⚠️ Aucun miroir trouvé pour ce salon source.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const cfg = getMirrorConfig();
    const entries = Object.entries(cfg.mirrors);

    if (entries.length === 0) {
      return interaction.reply({ content: 'Aucun miroir configuré.', ephemeral: true });
    }

    const lines = [];
    for (const [srcId, tgtIds] of entries) {
      lines.push(`**Source** <#${srcId}> (\`${srcId}\`) → **${tgtIds.length} cible(s)**`);
      for (const id of tgtIds) {
        lines.push(`  ↳ <#${id}> \`${id}\``);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`🪞 Miroirs configurés (${entries.length} source(s))`)
      .setColor(0x3498db)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
