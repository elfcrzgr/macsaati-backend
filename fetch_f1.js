const fs = require('fs');
const path = require('path');

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const OUTPUT_FILE = "matches_f1.json";

const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
} catch (err) {
    console.error("⚠️ f1_stats.json bulunamadı!");
}

async function start() {
    console.log("🏎️ F1 Motoru (35 Günlük Geniş Takvim) başlatılıyor...");

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        //const now = new Date();
const now = new Date();
now.setDate(now.getDate() + 10); // Sistemi 10 gün ileri aldık

        const getTRTime = (dateStr, timeStr) => {
            if (!dateStr || !timeStr) return null;
            return new Date(`${dateStr}T${timeStr}`);
        };

        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "Italy": "it", "Monaco": "mc", "Canada": "ca",
            "Spain": "es", "Austria": "at", "UK": "gb", "Hungary": "hu", "Belgium": "be",
            "Netherlands": "nl", "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx",
            "Brazil": "br", "Qatar": "qa", "UAE": "ae", "United States": "us"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            const flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            const stats = circuitStats[circuitId] || circuitStats["default"];

            const addSession = (sessionName, dateObj) => {
                if (!dateObj) return;
                
                // --- ARALIK 35 GÜNE ÇIKARILDI ---
                const diffDays = (dateObj - now) / (1000 * 60 * 60 * 24);
                if (diffDays >= -1 && diffDays <= 35) { 
                    
                    // Android'de "27 Mart Cuma" gibi görünmesi için format
                    const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
                    const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

                    finalEvents.push({
                        id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                        fixedDate: `${dayAndMonth} ${dayName}`, // Örn: 27 Mart Cuma
                        fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                        timestamp: dateObj.getTime(),
                        broadcaster: "beIN Sports / F1 TV",
                        grandPrix: race.raceName,
                        sessionName: sessionName,
                        trackName: race.Circuit.circuitName,
                        matchStatus: {
                            type: (now > dateObj) ? "finished" : "notstarted",
                            description: (now > dateObj) ? "Tamamlandı" : "-",
                            code: (now > dateObj) ? 100 : 0
                        },
                        countryLogo: F1_LOGO_BASE + flagCode + ".png", 
                        tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png",
                        circuitStats: stats 
                    });
                }
            };

            if (race.FirstPractice) addSession("1. Antrenman", getTRTime(race.FirstPractice.date, race.FirstPractice.time));
            if (race.SecondPractice) addSession("2. Antrenman", getTRTime(race.SecondPractice.date, race.SecondPractice.time));
            if (race.ThirdPractice) addSession("3. Antrenman", getTRTime(race.ThirdPractice.date, race.ThirdPractice.time));
            if (race.Qualifying) addSession("Sıralama", getTRTime(race.Qualifying.date, race.Qualifying.time));
            if (race.Sprint) addSession("Sprint", getTRTime(race.Sprint.date, race.Sprint.time));
            addSession("Yarış", getTRTime(race.date, race.time));
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, events: finalEvents }, null, 2));

        console.log(`\n✅ F1 JSON 35 günlük takvimle güncellendi.`);
    } catch (e) { console.error(e); }
}
start();