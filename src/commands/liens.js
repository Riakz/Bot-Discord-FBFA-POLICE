import { EmbedBuilder } from 'discord.js';

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
  const districtKey = interaction.options.getString('district', true);
  const district    = DISTRICT_LINKS[districtKey];

  const fixedLines    = FIXED_LINKS.map(l => `- [${l.name}](${l.url})`).join('\n');
  const districtLine  = `- [Discord ${district.name}](${district.url})`;

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
