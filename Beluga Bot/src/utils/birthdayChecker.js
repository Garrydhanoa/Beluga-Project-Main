const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { BirthdayDB, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');
const path = require('path');
const fs = require('fs');

const BIRTHDAY_CHANNEL_ID = '1156814622070935640';
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour
const wishedToday = new Set(); // Track who we've wished today

// Birthday images pool - local files
const BIRTHDAY_IMAGES = [
    'birthday.jpg',
    'birthday1.jpg',
    'birthday2.jpg',
    'birthday3.jpg',
    'birthday5.jpg'
];

/**
 * Check for birthdays and send wishes
 */
async function checkBirthdays(client) {
    try {
        if (!isDatabaseAvailable()) {
            Logger.warning('Database not available for birthday checking');
            return;
        }

        // Get current date in EST/EDT timezone
        const now = new Date();
        const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const currentMonth = estDate.getMonth() + 1; // JavaScript months are 0-indexed
        const currentDay = estDate.getDate();
        const currentDateKey = `${currentMonth}-${currentDay}`;

        // Reset wished list at midnight EST
        const currentHour = estDate.getHours();
        if (currentHour === 0 && wishedToday.size > 0) {
            Logger.info('Resetting birthday wishes for new day (EST)');
            wishedToday.clear();
        }

        Logger.info(`Checking birthdays for EST date: ${currentMonth}/${currentDay} at ${currentHour}:00 EST`);

        // Get birthday channel
        const birthdayChannel = client.channels.cache.get(BIRTHDAY_CHANNEL_ID);
        if (!birthdayChannel) {
            Logger.warning(`Birthday channel ${BIRTHDAY_CHANNEL_ID} not found`);
            return;
        }

        // Get all birthdays for today
        const todaysBirthdays = await BirthdayDB.getByDate(currentMonth, currentDay);

        if (todaysBirthdays.length === 0) {
            return; // No birthdays today
        }

        Logger.info(`Found ${todaysBirthdays.length} birthday(s) today`);

        // Send wishes for each birthday
        for (const birthday of todaysBirthdays) {
            const wishKey = `${birthday.user_id}-${currentDateKey}`;
            
            // Skip if already wished today
            if (wishedToday.has(wishKey)) {
                continue;
            }

            try {
                // Get the guild member
                const guild = birthdayChannel.guild;
                let member = null;
                
                try {
                    member = await guild.members.fetch(birthday.user_id);
                } catch (fetchError) {
                    Logger.warning(`Could not fetch member ${birthday.user_id} for birthday wish`);
                    continue;
                }

                // Calculate age if birth year is provided
                let ageText = '';
                if (birthday.year) {
                    const age = now.getFullYear() - birthday.year;
                    ageText = ` (${age} years old)`;
                }

                // Select a random birthday image
                const randomImage = BIRTHDAY_IMAGES[Math.floor(Math.random() * BIRTHDAY_IMAGES.length)];
                const imagePath = path.join(__dirname, '../../IMAGES', randomImage);

                // Create birthday embed
                const embed = new EmbedBuilder()
                    .setTitle('🎂 HAPPY BIRTHDAY! 🎉')
                    .setDescription(`**${birthday.display_name}**${ageText}`)
                    .addFields([
                        {
                            name: '🎈 Birthday Celebration',
                            value: `Everyone wish <@${birthday.user_id}> a very Happy Birthday! 🎊`,
                            inline: false
                        },
                        {
                            name: '🎁 Special Day',
                            value: 'May your day be filled with joy, laughter, and wonderful memories!',
                            inline: false
                        }
                    ])
                    .setColor(0xFF69B4)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setFooter({ text: '🎂 Beluga League Birthday System' })
                    .setTimestamp();

                // Prepare files array
                const files = [];
                
                // Check if image exists and attach it
                if (fs.existsSync(imagePath)) {
                    const attachment = new AttachmentBuilder(imagePath, { name: randomImage });
                    embed.setImage(`attachment://${randomImage}`);
                    files.push(attachment);
                } else {
                    Logger.warning(`Birthday image not found: ${imagePath}`);
                }

                // Send the birthday message
                await birthdayChannel.send({
                    content: `🎉 <@${birthday.user_id}> 🎉`,
                    embeds: [embed],
                    files: files
                });

                // Mark as wished
                wishedToday.add(wishKey);
                
                Logger.success(`Sent birthday wish to ${birthday.display_name} (${birthday.user_id})`);

            } catch (error) {
                Logger.error(`Failed to send birthday wish to ${birthday.display_name}`, error);
            }
        }

    } catch (error) {
        Logger.error('Error in birthday checker', error);
    }
}

/**
 * Start the birthday checker interval
 */
function startBirthdayChecker(client) {
    Logger.info('Starting birthday checker...');
    
    // Run immediately on start
    setTimeout(() => {
        checkBirthdays(client);
    }, 10000); // Wait 10 seconds after bot starts

    // Then run every hour
    setInterval(() => {
        checkBirthdays(client);
    }, CHECK_INTERVAL);

    Logger.success('Birthday checker started - will check every hour');
}

module.exports = {
    checkBirthdays,
    startBirthdayChecker
};
