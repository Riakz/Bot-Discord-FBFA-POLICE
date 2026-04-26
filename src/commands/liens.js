import { EmbedBuilder } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { getLiensConfig, addLiensRole, removeLiensRole } from '../utils/liensConfig.js';

const DISTRICT_LINKS = {
  mission_row:  { name: 'Mission Row',  url: 'https://discord.gg/y9QPuHEeHP' },
  vespucci:     { name: 'Vespucci',     url: 'https://discord.gg/ZbnxV9P5vZ' },
  alta:         { name: 'Alta',         url: 'https://discord.gg/tpvZwPkfje' },
  sandy_shores: { name: 'Sandy Shores', url: 'https://discord.gg/8Rvm3ePsup' },
  roxwood:      { name: 'Roxwood',      url: 'https://discord.gg/7DKb9eYxWZ' },
};

const FIXED_LINKS = [
  { name: 'Discord Com Police X Pôle Illégal', url: 'https://discord.gg/rCcJKH2dUn' },
  { name: 'Discord Metropolitan Division',     url: 'https://discord.gg/rY9n86Yg5X' },
  { name: 'Discord MDT',                       url: 'https://discord.gg/b3EDry3tAQ' },
];

export async function handleLiens(interaction) {
  const cfg = getLiensConfig(interaction.guild.id);

  if (cfg.allowedRoleIds.length > 0 && !isAdmin(interaction.user.id)) {
    const hasRole = cfg.allowedRoleIds.some(id => interaction.member.roles.cache.has(id));
    if (!hasRole) {
      return interaction.reply({
        content: '❌ Vous n\'avez pas le rôle requis pour utiliser cette commande.',
        ephemeral: true,
      });
    }
  }

  const districtKey = interaction.options.getString('district', true);
  const district    = DISTRICT_LINKS[districtKey];

  const fixedLines   = FIXED_LINKS.map(l => `- [${l.name}](${l.url})`).join('\n');
  const districtLine = `- [Discord ${district.name}](${district.url})`;

  const embed = new EmbedBuilder()
    .setTitle('🔗 Liens Discord — Police Academy')
    .setColor(0x2c3e50)
    .addFields(
      { name: '📌 Liens généraux',              value: fixedLines,   inline: false },
      { name: `🏙️ District — ${district.name}`, value: districtLine, inline: false },
    )
    .setFooter({ text: 'FlashBack FA • Police Academy' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

export async function handleConfigLiens(interaction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs du bot.', ephemeral: true });
  }

  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'add-role') {
    const role  = interaction.options.getRole('role', true);
    const added = addLiensRole(guildId, role.id);
    return interaction.reply({
      content: added
        ? `✅ ${role} ajouté — seuls les membres avec ce rôle (ou admin bot) pourront utiliser \`/liens\`.`
        : `⚠️ ${role} est déjà dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'remove-role') {
    const role    = interaction.options.getRole('role', true);
    const removed = removeLiensRole(guildId, role.id);
    return interaction.reply({
      content: removed
        ? `✅ ${role} retiré. ${getLiensConfig(guildId).allowedRoleIds.length === 0 ? 'Aucun rôle configuré — tout le monde peut utiliser `/liens`.' : ''}`
        : `⚠️ ${role} n'était pas dans la liste.`,
      ephemeral: true,
    });
  }

  if (sub === 'show') {
    const cfg  = getLiensConfig(guildId);
    const list = cfg.allowedRoleIds.length > 0
      ? cfg.allowedRoleIds.map(id => `<@&${id}>`).join(', ')
      : '*(aucun — tout le monde peut utiliser `/liens`)*';

    const embed = new EmbedBuilder()
      .setTitle('🔗 Configuration — /liens')
      .setColor(0x2c3e50)
      .addFields({ name: 'Rôles autorisés', value: list, inline: false })
      .setFooter({ text: 'Les admins du bot peuvent toujours utiliser la commande.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
