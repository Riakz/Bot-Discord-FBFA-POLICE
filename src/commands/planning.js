import { EmbedBuilder } from 'discord.js';
import { DISTRICTS } from '../utils/candidatureConfig.js';
import { getAllPlannings, addPlanning, removePlanning } from '../utils/planningData.js';
import * as GuildManager from '../utils/guildConfig.js';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function getWeekDates(weekOffset = 0) {
  const now = new Date();
  let dayOfWeek = now.getDay();
  if (dayOfWeek === 0) dayOfWeek = 7;

  const dates = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - dayOfWeek + 1 + i + weekOffset * 7);
    dates[DAYS[i]] = d.toLocaleDateString('fr-FR');
  }
  return dates;
}

function isDayPastThisWeek(jour) {
  const now = new Date();
  let todayDow = now.getDay();
  if (todayDow === 0) todayDow = 7;
  const jourIndex = DAYS.indexOf(jour) + 1;
  return jourIndex < todayDow;
}

function hasPARole(interaction) {
  const config = GuildManager.getGuildConfig(interaction.guild.id);
  const paRoles = config.paRoleIds ?? (config.paRoleId ? [config.paRoleId] : []);
  if (paRoles.length === 0) return true;
  return paRoles.some(id => interaction.member.roles.cache.has(id));
}

export async function handleReserverPA(interaction) {
  if (!hasPARole(interaction)) {
    return interaction.reply({ content: '❌ Vous n\'avez pas le rôle requis pour réserver un créneau Police Academy.', ephemeral: true });
  }

  const districtKey  = interaction.options.getString('district', true);
  const jour         = interaction.options.getString('jour', true);
  const creneau      = interaction.options.getString('creneau', true).trim();
  const semaineOpt   = interaction.options.getString('semaine') ?? 'cette_semaine';
  const weekOffset   = semaineOpt === 'semaine_prochaine' ? 1 : 0;

  if (weekOffset === 0 && isDayPastThisWeek(jour)) {
    return interaction.reply({
      content: `❌ **${jour}** est déjà passé cette semaine. Choisissez un jour à venir ou réservez pour la semaine prochaine.`,
      ephemeral: true,
    });
  }

  const id      = Math.random().toString(36).substring(2, 6).toUpperCase();
  const dates   = getWeekDates(weekOffset);
  const dateStr = dates[jour];

  const entry = {
    id,
    districtKey,
    jour,
    dateStr,
    creneau,
    userId:    interaction.user.id,
    createdAt: Date.now(),
  };

  addPlanning(entry);

  const districtName  = DISTRICTS[districtKey] ?? districtKey;
  const semaineLabel  = weekOffset === 1 ? 'Semaine prochaine' : 'Cette semaine';

  const embed = new EmbedBuilder()
    .setTitle('✅ Réservation Confirmée')
    .setColor(0x2ecc71)
    .setDescription(`Votre créneau a bien été enregistré.`)
    .addFields(
      { name: 'Semaine',            value: semaineLabel,          inline: true  },
      { name: 'District',           value: districtName,          inline: true  },
      { name: 'Jour',               value: `${jour} (${dateStr})`, inline: false },
      { name: 'Créneau',            value: creneau,               inline: false },
      { name: 'ID d\'annulation',   value: `\`${id}\``,           inline: false },
    )
    .setFooter({ text: 'FlashBack FA • Police Academy' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

export async function handleAnnulerPA(interaction) {
  const code = interaction.options.getString('id', true).trim().toUpperCase();

  const plannings = getAllPlannings();
  const target    = plannings.find(p => p.id === code);

  if (!target) {
    return interaction.reply({ content: `❌ Aucune réservation trouvée avec l'ID \`${code}\`.`, ephemeral: true });
  }

  const success = removePlanning(code);
  if (success) {
    return interaction.reply({ content: `✅ La réservation \`${code}\` a été annulée avec succès.` });
  } else {
    return interaction.reply({ content: `❌ Erreur lors de l'annulation.`, ephemeral: true });
  }
}

export async function handlePlanningPA(interaction) {
  const semaineOpt = interaction.options.getString('semaine') ?? 'cette_semaine';
  const weekOffset = semaineOpt === 'semaine_prochaine' ? 1 : 0;

  const plannings  = getAllPlannings();
  const dates      = getWeekDates(weekOffset);

  const weekDateStrs  = Object.values(dates);
  const activePlannings = plannings.filter(p => weekDateStrs.includes(p.dateStr));

  const semaineLabel = weekOffset === 1 ? 'Semaine Prochaine' : 'de la Semaine';

  const embed = new EmbedBuilder()
    .setTitle(`📅 Planning Police Academy — ${semaineLabel}`)
    .setColor(weekOffset === 1 ? 0x9b59b6 : 0x3498db)
    .setDescription(`Créneaux programmés pour les sessions Police Academy ${weekOffset === 1 ? 'la semaine prochaine' : 'cette semaine'}.`)
    .setFooter({ text: 'FlashBack FA • Police Academy' })
    .setTimestamp();

  for (const day of DAYS) {
    const dayDate    = dates[day];
    const dayEntries = activePlannings.filter(p => p.jour === day);

    let fieldValue;
    if (dayEntries.length === 0) {
      fieldValue = '*Aucune session*';
    } else {
      fieldValue = dayEntries.map(p => {
        const dName = DISTRICTS[p.districtKey] ?? p.districtKey;
        return `> **${dName}** — 🕒 ${p.creneau}\n> 👤 <@${p.userId}> (ID: \`${p.id}\`)`;
      }).join('\n\n');
    }

    embed.addFields({
      name:  `🗓️ ${day} (${dayDate})`,
      value: fieldValue,
      inline: false,
    });
  }

  return interaction.reply({ embeds: [embed] });
}
