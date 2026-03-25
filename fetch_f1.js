const fs = require('fs');
const path = require('path');

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const OUTPUT_FILE = "matches_f1.json";

// f1_stats.json dosyasını oku
const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
} catch (err) {
    console.error("⚠️ f1_stats.json okunamadı.");
}

async function start() {
    console.log("🏎️ Formula 1 motoru (Bayrak & Pist & Rekor Revize) başlatılıyor...");

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        const now = new Date();

        // ISO formatına göre TR saati yardımcı fonksiyonu
        const getTRTime = (dateStr, timeStr) => {
            if (!dateStr || !timeStr) return null;
            return new Date(`${dateStr}T${timeStr}`);
        };

        // Ülke isimlerini Tenis'teki gibi 2 haneli kodlara çeviren küçük bir eşleştirici
        // API'den gelen ülke isimlerine göre burayı genişletebilirsin
        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "Italy": "it", "Monaco": "mc", "Canada": "ca",
            "Spain": "es", "Austria": "at", "UK": "gb", "Hungary": "hu", "Belgium": "be",
            "Netherlands": "nl", "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx",
            "Brazil": "br", "Qatar": "qa", "UAE": "ae"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            
            // Bayrak kodu (Eğer listede yoksa ismi küçük harfe çevirip dene)
            const flagCode = countryToCode[countryName] || countryName.toLowerCase();
            
            const stats = circuitStats[circuitId] || circuitStats["default"];

            const addSession = (sessionName, dateObj) => {
                if (!dateObj) return;
                const diffDays = (dateObj - now) / (1000 * 60 * 60 * 24);
                
                if (diffDays >= -2 && diffDays <= 15) {
                    const dayStr = dateObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    const timeStr = dateObj.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

                    let statusType = "notstarted";
                    if (now > dateObj) {
                        statusType = "finished";
                        if ((now - dateObj) < (2 * 60 * 60 * 1000)) statusType = "inprogress";
                    }

                    finalEvents.push({
                        id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                        fixedDate: dayStr,
                        fixedTime: timeStr,
                        timestamp: dateObj.getTime(),
                        broadcaster: "beIN Sports / F1 TV",
                        grandPrix: race.raceName,
                        sessionName: sessionName,
                        trackName: race.Circuit.circuitName,
                        matchStatus: {
                            type: statusType,
                            description: statusType === "finished" ? "Tamamlandı" : (statusType === "inprogress" ? "Canlı" : "-"),
                            code: statusType === "finished" ? 100 : 0
                        },
                        // Bayrak linkini tenisteki gibi oluşturuyoruz
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
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
            success: true, 
            lastUpdated: new Date().toISOString(), 
            events: finalEvents 
        }, null, 2));

        console.log(`\n✅ F1 JSON hazır. Bayrak linki: ${finalEvents[0]?.countryLogo}`);
    } catch (e) { console.error(e); }
}
start();