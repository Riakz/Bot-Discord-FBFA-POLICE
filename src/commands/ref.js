import { EmbedBuilder } from 'discord.js';
import { isAdmin } from '../utils/perms.js';
import { error, log } from '../utils/logger.js';
import {
  getRefConfig,
  getAllRefConfigs,
  addRefRole,
  removeRefRole,
  addRefAllowedUser,
  removeRefAllowedUser,
  addRefAllowedRole,
  removeRefAllowedRole,
} from '../utils/refConfig.js';

function parseId(str) {
  return str?.replace(/[<@&!>]/g, '').trim() ?? null;
}

function isAuthorized(message) {
  if (isAdmin(message.author.id)) return true;
  const cfg = getRefConfig(message.guild.id);
  if (cfg.allowedUserIds.includes(message.author.id)) return true;
  if (message.member?.roles?.cache.some(r => cfg.allowedRoleIds.includes(r.id))) return true;
  return false;
}

export async function handleRefCommand(message) {
  if (!message.guild) return;

  const content = message.content.trim();
  const args    = content.slice(1).trim().split(/\s+/);
  const cmd     = args[0]?.toLowerCase();

  if (!['config', 'allow', 'refadd', 'refdel', 'refliens'].includes(cmd)) return;

  if (!isAuthorized(message)) {
    return message.reply('❌ Vous n\'êtes pas autorisé à utiliser ces commandes.');
  }

  const guildId = message.guild.id;

  // ── +refliens ────────────────────────────────────────────────────────────────

  if (cmd === 'refliens') {
    const liens = [
      'https://discord.gg/UNAWdXVAub',
      'https://discord.gg/GDTVBTf9hX',
      'https://discord.gg/xyGFzFYATa',
      'https://discord.gg/YZm4Rt2sy5',
      'https://discord.gg/b39mURFh4b',
      'https://discord.gg/me6kAEuVNy',
      'https://discord.gg/szCtKhDFKs',
      'https://discord.gg/9nKyEVJpse',
      'https://discord.gg/ee5Q9MKnXP',
    ];
    const embed = new EmbedBuilder()
      .setTitle('🔗 Liens des serveurs')
      .setColor(0x3498db)
      .setDescription(liens.map((l, i) => `**${i + 1}.** ${l}`).join('\n'))
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── +config ──────────────────────────────────────────────────────────────────

  if (cmd === 'config') {
    const sub = args[1]?.toLowerCase();

    if (sub === 'add') {
      const roleId = parseId(args[2]);
      if (!roleId) return message.reply('❌ Usage : `+config add <roleId>`');
      const added = addRefRole(guildId, roleId);
      return message.reply(added ? `✅ Rôle \`${roleId}\` ajouté à la config.` : `⚠️ Ce rôle est déjà dans la config.`);
    }

    if (sub === 'remove') {
      const roleId = parseId(args[2]);
      if (!roleId) return message.reply('❌ Usage : `+config remove <roleId>`');
      const removed = removeRefRole(guildId, roleId);
      return message.reply(removed ? `✅ Rôle \`${roleId}\` retiré de la config.` : `⚠️ Ce rôle n\'est pas dans la config.`);
    }

    if (sub === 'list') {
      const cfg = getRefConfig(guildId);
      const roles   = cfg.roleIds.length        ? cfg.roleIds.map(id => `<@&${id}>`).join(', ')        : '_Aucun_';
      const users   = cfg.allowedUserIds.length  ? cfg.allowedUserIds.map(id => `<@${id}>`).join(', ')  : '_Aucun_';
      const aRoles  = cfg.allowedRoleIds.length  ? cfg.allowedRoleIds.map(id => `<@&${id}>`).join(', ') : '_Aucun_';
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Config Ref — Ce serveur')
        .setColor(0x3498db)
        .addFields(
          { name: 'Rôles gérés',         value: roles,  inline: false },
          { name: 'Utilisateurs autorisés', value: users,  inline: false },
          { name: 'Rôles autorisés',       value: aRoles, inline: false },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Sous-commandes : `add`, `remove`, `list`');
  }

  // ── +allow ───────────────────────────────────────────────────────────────────

  if (cmd === 'allow') {
    const sub = args[1]?.toLowerCase();

    if (sub === 'add') {
      const userId = parseId(args[2]);
      if (!userId) return message.reply('❌ Usage : `+allow add <userId>`');
      const added = addRefAllowedUser(guildId, userId);
      return message.reply(added ? `✅ <@${userId}> peut désormais utiliser les commandes ref.` : `⚠️ Déjà autorisé.`);
    }

    if (sub === 'remove') {
      const userId = parseId(args[2]);
      if (!userId) return message.reply('❌ Usage : `+allow remove <userId>`');
      const removed = removeRefAllowedUser(guildId, userId);
      return message.reply(removed ? `✅ <@${userId}> retiré des autorisations.` : `⚠️ Pas dans la liste.`);
    }

    if (sub === 'addrole') {
      const roleId = parseId(args[2]);
      if (!roleId) return message.reply('❌ Usage : `+allow addrole <roleId>`');
      const added = addRefAllowedRole(guildId, roleId);
      return message.reply(added ? `✅ Rôle <@&${roleId}> autorisé.` : `⚠️ Déjà autorisé.`);
    }

    if (sub === 'removerole') {
      const roleId = parseId(args[2]);
      if (!roleId) return message.reply('❌ Usage : `+allow removerole <roleId>`');
      const removed = removeRefAllowedRole(guildId, roleId);
      return message.reply(removed ? `✅ Rôle <@&${roleId}> retiré.` : `⚠️ Pas dans la liste.`);
    }

    if (sub === 'list') {
      const cfg = getRefConfig(guildId);
      const users  = cfg.allowedUserIds.length  ? cfg.allowedUserIds.map(id => `<@${id}> (\`${id}\`)`).join('\n')  : '_Aucun_';
      const roles  = cfg.allowedRoleIds.length  ? cfg.allowedRoleIds.map(id => `<@&${id}> (\`${id}\`)`).join('\n') : '_Aucun_';
      const embed = new EmbedBuilder()
        .setTitle('👮 Autorisations Ref')
        .setColor(0x9b59b6)
        .addFields(
          { name: 'Utilisateurs', value: users, inline: false },
          { name: 'Rôles',        value: roles, inline: false },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Sous-commandes : `add`, `remove`, `addrole`, `removerole`, `list`');
  }

  // ── +refadd / +refdel ────────────────────────────────────────────────────────

  if (cmd === 'refadd' || cmd === 'refdel') {
    const targetId = parseId(args[1]);
    if (!targetId) return message.reply(`❌ Usage : \`+${cmd} <userId>\``);

    const adding = cmd === 'refadd';
    const allConfigs = getAllRefConfigs();
    const results = [];

    for (const [gId, cfg] of Object.entries(allConfigs)) {
      if (!cfg.roleIds?.length) continue;
      try {
        const guild = await message.client.guilds.fetch(gId).catch(() => null);
        if (!guild) continue;
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (!member) {
          results.push(`⚠️ **${guild.name}** — membre introuvable`);
          continue;
        }
        for (const roleId of cfg.roleIds) {
          if (adding) {
            await member.roles.add(roleId).catch(() => {});
          } else {
            await member.roles.remove(roleId).catch(() => {});
          }
        }
        const rolesStr = cfg.roleIds.map(id => `\`${id}\``).join(', ');
        results.push(`✅ **${guild.name}** — ${cfg.roleIds.length} rôle(s) ${adding ? 'ajouté(s)' : 'retiré(s)'} : ${rolesStr}`);
      } catch (e) {
        error(`[Ref] Erreur ${gId}:`, e);
        results.push(`❌ **${gId}** — erreur`);
      }
    }

    log(`[Ref] ${cmd} ${targetId} par ${message.author.id}`);

    if (!results.length) {
      return message.reply('⚠️ Aucun serveur n\'a de rôles configurés.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`${adding ? '➕' : '➖'} Ref — <@${targetId}>`)
      .setColor(adding ? 0x2ecc71 : 0xe74c3c)
      .setDescription(results.join('\n'))
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
}
