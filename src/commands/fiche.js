import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { parseSheetUrl, exportSheetToPdf, convertPdfToImage, fetchSheetValues } from '../utils/googleUtils.js';
import { loadUserSheets, saveUserSheets } from '../utils/sheetData.js';

export const data = new SlashCommandBuilder()
    .setName('fiche')
    .setDescription('Commandes pour la fiche Google Sheet')
    .addSubcommand(sub =>
        sub.setName('get')
            .setDescription('Afficher votre fiche (Cellules B2:R26)')
            .addAttachmentOption(option =>
                option.setName('photo_individu')
                    .setDescription('Photo de l\'individu')
                    .setRequired(false)
            )
            .addAttachmentOption(option =>
                option.setName('photo_identite')
                    .setDescription('Photo de la pièce d\'identité')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('nom_feuille')
                    .setDescription('Nom précis de l\'onglet (ex: Formulaire 2)')
                    .setRequired(false)
            )
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'get') {
        const sheets = loadUserSheets();
        const userSheet = sheets[userId];
        const photoIndividu = interaction.options.getAttachment('photo_individu');
        const photoIdentite = interaction.options.getAttachment('photo_identite');
        const targetSheetName = interaction.options.getString('nom_feuille');

        if (!userSheet) {
            return interaction.reply({
                content: '❌ Aucune fiche liée found. Utilisez le bouton "Lier la fiche" dans votre Google Sheet (Extensions > Flashback).',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            console.log(`[FICHE] Fetching for ${userId} (ID: ${userSheet.spreadsheetId}, GID: ${userSheet.gid})...`);

            const [pdfBuffer, dataValues] = await Promise.all([
                exportSheetToPdf(userSheet.spreadsheetId, userSheet.gid, "B2:R26", targetSheetName),
                fetchSheetValues(userSheet.spreadsheetId, userSheet.gid, [
                    'Q5',
                    'F5:J5',
                    'D6',
                    'D21:E21',
                    'O5',
                    'C23:H23',
                    'E25'
                ], targetSheetName)
            ]);

            console.log(`[FICHE] PDF Fetched. Rendering Image...`);
            const imageBuffer = await convertPdfToImage(pdfBuffer);

            const { values: rowData, sheetName } = dataValues;

            const val_ID = rowData[0] || "N/A";
            const val_Nom = rowData[1] || "Inconnu";
            const val_Tel = rowData[2] || "N/A";
            const val_Info1 = rowData[3] || "Aucune";
            const val_Agents = rowData[4] || "Aucun";
            let val_Prison1 = rowData[5] || "";
            const val_Prison2 = rowData[6] || "";

            if (val_Prison1.toLowerCase().includes("non")) {
                val_Prison1 = "Pas de prison";
            }

            const infoParts = [val_Info1, val_Prison1, val_Prison2]
                .filter(s => s && s.trim().length > 0)
                .join(". ");

            const messageContent =
                `⛔ **𝐈𝐃 𝐮𝐧𝐢𝐪𝐮𝐞** : ${val_ID}
📜 **𝐍𝐎𝐌 𝐏𝐫𝐞𝐧𝐨𝐦** : ${val_Nom}
📞 **𝐍𝐮𝐦𝐞́𝐫𝐨 𝐝𝐞 𝐭𝐞𝐥𝐞𝐩𝐡𝐨𝐧𝐞** : ${val_Tel}
📌 **𝐈𝐧𝐟𝐨𝐫𝐦𝐚𝐭𝐢𝐨𝐧𝐬 𝐬𝐮𝐩𝐩𝐥𝐞́𝐦𝐞𝐧𝐭𝐚𝐢𝐫𝐞𝐬** : ${infoParts} | Agents participant : ${val_Agents}
📸📋 **𝐏𝐡𝐨𝐭𝐨𝐬 𝐢𝐧𝐝𝐢𝐯𝐢𝐝𝐮 + 𝐝𝐞 𝐥𝐚 𝐩𝐢𝐞̀𝐜𝐞 𝐝'𝐢𝐝𝐞𝐧𝐭𝐢𝐭𝐞́ + 𝐅𝐞𝐮𝐢𝐥𝐥𝐞 𝐝𝐞 𝐜𝐚𝐥𝐜𝐮𝐥** :`;

            const files = [new AttachmentBuilder(imageBuffer, { name: 'fiche.png' })];
            if (photoIndividu) files.push(photoIndividu);
            if (photoIdentite) files.push(photoIdentite);

            return interaction.editReply({
                content: messageContent,
                files: files
            });

        } catch (error) {
            console.error('[FICHE ERROR]', error);
            try {
                return await interaction.editReply({
                    content: `❌ Erreur technique : ${error.message}\n`
                });
            } catch (e) {
                console.error('[FICHE ERROR] Could not send error message to user:', e);
            }
        }
    }
}
