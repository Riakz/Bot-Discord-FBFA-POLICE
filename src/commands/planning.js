import { EmbedBuilder } from 'discord.js';
import { DISTRICTS } from '../utils/candidatureConfig.js';
import { getAllPlannings, addPlanning, removePlanning } from '../utils/planningData.js';
import * as GuildManager from '../utils/guildConfig.js';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function getCurrentWeekDates() {
  const now = new Date();
  let dayOfWeek = now.getDay();
  if (dayOfWeek === 0) dayOfWeek = 7;

  const dates = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - dayOfWeek + 1 + i);
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
  if (!config.paRoleId) return true;
  return interaction.member.roles.cache.has(config.paRoleId);
}

export async function handleReserverPA(interaction) {
  if (!hasPARole(interaction)) {
    return interaction.reply({ content: '❌ Vous n\'avez pas le rôle requis pour réserver un créneau Police Academy.', ephemeral: true });
  }

  const districtKey = interaction.options.getString('district', true);
  const jour        = interaction.options.getString('jour', true);
  const creneau     = interaction.options.getString('creneau', true).trim();

  if (isDayPastThisWeek(jour)) {
    return interaction.reply({ content: `❌ **${jour}** est déjà passé cette semaine. Choisissez un jour à venir.`, ephemeral: true });
  }

  const id = Math.random().toString(36).substring(2, 6).toUpperCase();
  const dates = getCurrentWeekDates();
  const dateStr = dates[jour];

  const entry = {
    id,
    districtKey,
    jour,
    dateStr,
    creneau,
    userId: interaction.user.id,
    createdAt: Date.now()
  };

  addPlanning(entry);

  const districtName = DISTRICTS[districtKey] ?? districtKey;

  const embed = new EmbedBuilder()
    .setTitle('✅ Réservation Confirmée')
    .setColor(0x2ecc71)
    .setDescription(`Votre créneau a bien été enregistré.`)
    .addFields(
      { name: 'District', value: districtName, inline: true },
      { name: 'Jour', value: `${jour} (${dateStr})`, inline: true },
      { name: 'Créneau', value: creneau, inline: false },
      { name: 'ID d\'annulation', value: `\`${id}\``, inline: false }
    )
    .setFooter({ text: 'FlashBack FA • Police Academy' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

export async function handleAnnulerPA(interaction) {
  const code = interaction.options.getString('id', true).trim().toUpperCase();

  const plannings = getAllPlannings();
  const target = plannings.find(p => p.id === code);

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
  const plannings = getAllPlannings();
  const dates = getCurrentWeekDates();

  const currentWeekDateStrs = Object.values(dates);
  const activePlannings = plannings.filter(p => currentWeekDateStrs.includes(p.dateStr));

  const embed = new EmbedBuilder()
    .setTitle('📅 Planning Police Academy de la Semaine')
    .setColor(0x3498db)
    .setDescription('Voici les créneaux programmés pour les sessions Police Academy cette semaine.')
    .setFooter({ text: 'FlashBack FA • Police Academy' })
    .setTimestamp();

  for (const day of DAYS) {
    const dayDate = dates[day];
    const dayPlannings = activePlannings.filter(p => p.jour === day);

    let fieldValue = '';
    if (dayPlannings.length === 0) {
      fieldValue = '*Aucune session*';
    } else {
      fieldValue = dayPlannings.map(p => {
        const dName = DISTRICTS[p.districtKey] ?? p.districtKey;
        return `> **${dName}** — 🕒 ${p.creneau}\n> 👤 <@${p.userId}> (ID: \`${p.id}\`)`;
      }).join('\n\n');
    }

    embed.addFields({
      name: `🗓️ ${day} (${dayDate})`,
      value: fieldValue,
      inline: false
    });
  }

  return interaction.reply({ embeds: [embed] });
}
