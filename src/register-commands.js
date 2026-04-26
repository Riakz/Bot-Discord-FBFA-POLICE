import { loadEnv } from './utils/loadEnv.js';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { data as ficheData } from './commands/fiche.js';

const loadedFrom = loadEnv({ verbose: true });
console.log('[ENV] Source:', loadedFrom);

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
} = process.env;

const mask = (v) => (v ? `${v.length} chars` : 'missing');
console.log('[ENV] Vars:', {
  DISCORD_TOKEN: mask(DISCORD_TOKEN),
  CLIENT_ID: mask(CLIENT_ID),
  GUILD_ID: mask(GUILD_ID),
});

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

if (process.argv.includes('--clear-global')) {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log('Clearing global slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
  console.log('✅ Global slash commands cleared.');
  process.exit(0);
}

const commands = [
  new SlashCommandBuilder()
    .setName('config-server')
    .setDescription('Configuration générale du serveur (staff, catégories)')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Définir le rôle staff et la catégorie tickets')
        .addRoleOption((opt) => opt.setName('staff-role').setDescription('Rôle Staff').setRequired(true))
        .addChannelOption((opt) => opt.setName('ticket-category').setDescription('Catégorie pour les tickets').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('show').setDescription('Afficher la configuration actuelle'))
    .addSubcommand((sub) =>
      sub
        .setName('set-pa-role')
        .setDescription('Définir le rôle autorisé pour les réservations Police Academy')
        .addRoleOption((opt) =>
          opt.setName('role')
             .setDescription('Rôle autorisé (laisser vide = tout le monde peut réserver)')
             .setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Gérer les administrateurs du bot')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription("Ajouter un admin du bot")
        .addUserOption((opt) => opt.setName('utilisateur').setDescription('Utilisateur à ajouter').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription("Retirer un admin du bot")
        .addUserOption((opt) => opt.setName('utilisateur').setDescription('Utilisateur à retirer').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lister les admins du bot')),

  new SlashCommandBuilder()
    .setName('create')
    .setDescription('Créer un ticket modmail'),

  new SlashCommandBuilder()
    .setName('ar')
    .setDescription('Répondre anonymement en tant que bot (admins du bot uniquement)')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Message à envoyer anonymement').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('panel-ticket')
    .setDescription('Publier un panneau pour ouvrir un ticket (Admins uniquement)'),

  new SlashCommandBuilder()
    .setName('panel-custom')
    .setDescription('Gérer les panels de tickets personnalisés (Admins uniquement)')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Créer un nouveau panel personnalisé')
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-button')
        .setDescription('Ajouter un bouton à un panel')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('publish')
        .setDescription('Publier un panel dans ce canal')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lister tous les panels'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Supprimer un panel')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Modifier le titre/description/couleur d\'un panel')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list-buttons')
        .setDescription('Lister les boutons d\'un panel (pour obtenir les IDs)')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit-button')
        .setDescription('Modifier un bouton existant')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('button-id').setDescription('ID du bouton').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-button')
        .setDescription('Supprimer un bouton d\'un panel')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('button-id').setDescription('ID du bouton').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-log')
        .setDescription('Définir le canal de logs pour un panel existant')
        .addStringOption((opt) =>
          opt.setName('panel-id').setDescription('ID du panel').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal de logs (ou "none" pour désactiver)').setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription("Ajouter l'accès au ticket à un utilisateur via son ID")
    .addStringOption((opt) =>
      opt.setName('id').setDescription("ID de l'utilisateur").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription("Retirer l'accès au ticket à un utilisateur via son ID")
    .addStringOption((opt) =>
      opt.setName('id').setDescription("ID de l'utilisateur").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Renommer le ticket courant')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Nouveau nom du ticket').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('add-bl')
    .setDescription('Ajouter une entrée à la blacklist (ouvre une pop-up)'),

  new SlashCommandBuilder()
    .setName('bl-list')
    .setDescription('Afficher la liste blacklist avec pagination'),

  new SlashCommandBuilder()
    .setName('remove-bl')
    .setDescription('Retirer une entrée de la blacklist (ouvre une pop-up)'),

  new SlashCommandBuilder()
    .setName('kickpol')
    .setDescription("[Admins] Kick l'utilisateur par ID sur tous les serveurs du bot")
    .addStringOption((opt) =>
      opt.setName('id').setDescription("ID de l'utilisateur").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('banpol')
    .setDescription("[Admins] Ban l'utilisateur par ID avec motif sur tous les serveurs du bot")
    .addStringOption((opt) =>
      opt.setName('id').setDescription("ID de l'utilisateur").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('motif').setDescription('Motif du bannissement').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('search-bl')
    .setDescription('Vérifier si un utilisateur est dans la blacklist')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('ID de l\'utilisateur à vérifier').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('config-logs')
    .setDescription('Configurer les canaux de logs du bot')
    .addSubcommand((sub) =>
      sub
        .setName('ticket-logs')
        .setDescription('Définir le canal pour les logs de tickets')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('police-logs')
        .setDescription('Définir le canal pour les logs police (kick/ban/blacklist)')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('audit-logs')
        .setDescription('Définir le canal pour les logs audit (AR, admin)')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('security-logs')
        .setDescription('Définir le canal pour les alertes de sécurité (anti-spam, rate-limit)')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('show').setDescription('Afficher la configuration actuelle')),

  new SlashCommandBuilder()
    .setName('candidature-panel')
    .setDescription('Publier un panneau pour postuler dans la police (Admins uniquement)'),

  new SlashCommandBuilder()
    .setName('config-candidature')
    .setDescription('Configurer les canaux de candidature par district')
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Afficher la configuration actuelle')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-application')
        .setDescription('Définir le canal de réception des candidatures pour un district')
        .addStringOption((opt) =>
          opt.setName('district')
             .setDescription('Le district concerné')
             .setRequired(true)
             .addChoices(
               { name: 'Mission Row',  value: 'mission_row' },
               { name: 'Vespucci',     value: 'vespucci' },
               { name: 'Alta',         value: 'alta' },
               { name: 'Sandy Shores', value: 'sandy_shores' },
               { name: 'Roxwood',      value: 'roxwood' }
             )
        )
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-result')
        .setDescription('Définir le canal de résultats (Accepté/Refusé) pour un district')
        .addStringOption((opt) =>
          opt.setName('district')
             .setDescription('Le district concerné')
             .setRequired(true)
             .addChoices(
               { name: 'Mission Row',  value: 'mission_row' },
               { name: 'Vespucci',     value: 'vespucci' },
               { name: 'Alta',         value: 'alta' },
               { name: 'Sandy Shores', value: 'sandy_shores' },
               { name: 'Roxwood',      value: 'roxwood' }
             )
        )
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du canal').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-role-refused')
        .setDescription('Définir le rôle global attribué lors d\'un refus')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle à attribuer').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-role-accepted')
        .setDescription('Définir le rôle validation attribué lors d\'une acceptation pour un district')
        .addStringOption((opt) =>
          opt.setName('district')
             .setDescription('Le district concerné')
             .setRequired(true)
             .addChoices(
               { name: 'Mission Row',  value: 'mission_row' },
               { name: 'Vespucci',     value: 'vespucci' },
               { name: 'Alta',         value: 'alta' },
               { name: 'Sandy Shores', value: 'sandy_shores' },
               { name: 'Roxwood',      value: 'roxwood' }
             )
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle à attribuer').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-reviewer-role')
        .setDescription('Ajouter un rôle autorisé à valider/refuser les candidatures')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle recruteur à ajouter').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-reviewer-role')
        .setDescription('Retirer un rôle recruteur')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle recruteur à retirer').setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('reserver-pa')
    .setDescription('Réserver un créneau Police Academy pour la semaine en cours')
    .addStringOption((opt) =>
      opt.setName('district')
         .setDescription('Le district concerné')
         .setRequired(true)
         .addChoices(
           { name: 'Mission Row',  value: 'mission_row' },
           { name: 'Vespucci',     value: 'vespucci' },
           { name: 'Alta',         value: 'alta' },
           { name: 'Sandy Shores', value: 'sandy_shores' },
           { name: 'Roxwood',      value: 'roxwood' }
         )
    )
    .addStringOption((opt) =>
      opt.setName('jour')
         .setDescription('Le jour de cette semaine')
         .setRequired(true)
         .addChoices(
           { name: 'Lundi',    value: 'Lundi' },
           { name: 'Mardi',    value: 'Mardi' },
           { name: 'Mercredi', value: 'Mercredi' },
           { name: 'Jeudi',    value: 'Jeudi' },
           { name: 'Vendredi', value: 'Vendredi' },
           { name: 'Samedi',   value: 'Samedi' },
           { name: 'Dimanche', value: 'Dimanche' }
         )
    )
    .addStringOption((opt) =>
      opt.setName('creneau')
         .setDescription('L\'heure ou la plage horaire (ex: 21h00 - 23h00)')
         .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('annuler-pa')
    .setDescription('Annuler une réservation de créneau Police Academy')
    .addStringOption((opt) =>
      opt.setName('id')
         .setDescription('L\'ID de la réservation (ex: A7F2)')
         .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('planning-pa')
    .setDescription('Afficher le planning Police Academy de la semaine en cours'),

  new SlashCommandBuilder()
    .setName('antidouble')
    .setDescription('Système de détection de doubles comptes')
    .addSubcommandGroup(group =>
      group.setName('config')
        .setDescription('Configuration du système')
        .addSubcommand(sub =>
          sub.setName('set-alert-channel')
            .setDescription('Salon de réception des alertes')
            .addStringOption(opt => opt.setName('channel-id').setDescription('ID du salon').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('set-bl-channel')
            .setDescription('Salon de réception des logs blacklist')
            .addStringOption(opt => opt.setName('channel-id').setDescription('ID du salon').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('set-banned-role')
            .setDescription('Rôle qui interdit de postuler (contournement détecté si double compte)')
            .addRoleOption(opt => opt.setName('role').setDescription('Rôle banni (laisser vide = désactiver)').setRequired(false))
        )
        .addSubcommand(sub => sub.setName('show').setDescription('Afficher la configuration'))
    )
    .addSubcommandGroup(group =>
      group.setName('allow')
        .setDescription('Gérer la liste des opérateurs autorisés')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Autoriser un utilisateur à gérer les alertes')
            .addUserOption(opt => opt.setName('user').setDescription('Utilisateur à autoriser').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Retirer un opérateur')
            .addUserOption(opt => opt.setName('user').setDescription('Utilisateur à retirer').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('Voir la liste des opérateurs'))
    ),

  new SlashCommandBuilder()
    .setName('depart-watcher')
    .setDescription('Configurer la détection automatique des messages de départ')
    .addSubcommand((sub) =>
      sub.setName('add-source')
         .setDescription('Ajouter un salon à surveiller')
         .addStringOption((opt) => opt.setName('channel-id').setDescription('ID du salon source').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove-source')
         .setDescription('Retirer un salon surveillé')
         .addStringOption((opt) => opt.setName('channel-id').setDescription('ID du salon source').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('add-target')
         .setDescription('Ajouter un salon de destination')
         .addStringOption((opt) => opt.setName('channel-id').setDescription('ID du salon cible').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove-target')
         .setDescription('Retirer un salon de destination')
         .addStringOption((opt) => opt.setName('channel-id').setDescription('ID du salon cible').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Afficher la configuration actuelle')
    ),

  new SlashCommandBuilder()
    .setName('mirror')
    .setDescription('Copier tous les messages d\'un salon vers d\'autres salons')
    .addSubcommand((sub) =>
      sub.setName('add')
         .setDescription('Lier un salon source à un salon cible')
         .addStringOption((opt) => opt.setName('source-id').setDescription('ID du salon source').setRequired(true))
         .addStringOption((opt) => opt.setName('target-id').setDescription('ID du salon cible').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove')
         .setDescription('Supprimer un lien source → cible')
         .addStringOption((opt) => opt.setName('source-id').setDescription('ID du salon source').setRequired(true))
         .addStringOption((opt) => opt.setName('target-id').setDescription('ID du salon cible').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('clear')
         .setDescription('Supprimer toutes les destinations d\'un salon source')
         .addStringOption((opt) => opt.setName('source-id').setDescription('ID du salon source').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lister tous les miroirs actifs')
    ),

  new SlashCommandBuilder()
    .setName('config-entretien')
    .setDescription('Configurer le système d\'entretien Police Academy')
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Afficher la configuration actuelle')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-result-channel')
        .setDescription('Définir le salon où les résultats d\'entretien seront publiés')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du salon').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-notif-channel')
        .setDescription('Définir le salon où les messages Validé/Refusé sont envoyés au candidat')
        .addStringOption((opt) =>
          opt.setName('channel-id').setDescription('ID du salon').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-sheet-url')
        .setDescription('Enregistrer l\'URL de la feuille Google Sheet (référence)')
        .addStringOption((opt) =>
          opt.setName('url').setDescription('URL de la feuille').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-role-passed')
        .setDescription('Définir le rôle attribué si l\'entretien est réussi (par district)')
        .addStringOption((opt) =>
          opt.setName('district')
             .setDescription('Le district concerné')
             .setRequired(true)
             .addChoices(
               { name: 'Mission Row',  value: 'mission_row' },
               { name: 'Vespucci',     value: 'vespucci' },
               { name: 'Alta',         value: 'alta' },
               { name: 'Sandy Shores', value: 'sandy_shores' },
               { name: 'Roxwood',      value: 'roxwood' }
             )
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle à attribuer').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-role-failed')
        .setDescription('Définir le rôle global attribué si l\'entretien est échoué')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Le rôle à attribuer').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-reviewer-role')
        .setDescription('Ajouter un rôle autorisé à attribuer les résultats d\'entretien')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle examinateur à ajouter').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-reviewer-role')
        .setDescription('Retirer un rôle examinateur')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle examinateur à retirer').setRequired(true)
        )
    ),

  ficheData,
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function main() {
  try {
    console.log('Registering slash commands...');
    const guildArg = process.argv.find(a => a.startsWith('--guild'));
    const targetGuildId = guildArg?.includes('=')
      ? guildArg.split('=')[1].trim()
      : (guildArg ? GUILD_ID : null);

    if (targetGuildId) {
      console.log(`Targeting specific guild: ${targetGuildId}`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, targetGuildId), { body: commands });
      console.log(`✅ Slash commands registered for guild ${targetGuildId}`);
    } else {
      console.log('Targeting global (all guilds)... this may take up to 1 hour to propagate.');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Slash commands registered GLOBALLY.');
    }
  } catch (err) {
    console.error('Register error:', err);
    process.exit(1);
  }
}

main();
