import { addAdmin, removeAdmin, getAdmins, isAdmin } from '../utils/perms.js';

export async function handleAdminSlash(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildOwnerId = interaction.guild.ownerId;

  const callerIsAllowed = isAdmin(interaction.user.id) || interaction.user.id === guildOwnerId;
  if (!callerIsAllowed) {
    return interaction.reply({ content: '❌ Vous devez être admin du bot pour faire ça.', ephemeral: true });
  }

  if (sub === 'list') {
    const list = getAdmins();
    if (!list.length) return interaction.reply({ content: 'Aucun admin enregistré.', ephemeral: true });
    return interaction.reply({ content: `Admins: ${list.map((id) => `<@${id}>`).join(', ')}`, ephemeral: true });
  }

  const user = interaction.options.getUser('utilisateur');
  if (!user) return interaction.reply({ content: 'Utilisateur requis.', ephemeral: true });

  if (sub === 'add') {
    addAdmin(user.id);
    return interaction.reply({ content: `✅ ${user} est maintenant admin du bot.`, ephemeral: true });
  }
  if (sub === 'remove') {
    removeAdmin(user.id);
    return interaction.reply({ content: `✅ ${user} n'est plus admin du bot.`, ephemeral: true });
  }
}
