const fs = require('fs');
const path = require('path');

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const OUTPUT_FILE = path.join(__dirname, "matches_f1.json"); // KESİN YOL

const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
} catch (err) {
    console.error("⚠️ f1_stats.json dosyası okunurken hata oluştu!");
}

async function start() {
    console.log("🏎️ F1 Motoru Çalışıyor... Lütfen bekleyin.");

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response.ok) throw new Error("API yanıt vermiyor: " + response.status);
        
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        const now = new Date();
        // TEST İÇİN: now.setDate(now.getDate() + 20); // Miami testi için burayı açabilirsin

        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "United States": "us", "Italy": "it", 
            "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at", 
            "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl", 
            "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br", 
            "Qatar": "qa", "UAE": "ae"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            const flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            const stats = circuitStats[circuitId] || circuitStats["default"];

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                
                const diffDays = (dateObj - now) / (1000 * 60 * 60 * 24);
                if (diffDays >= -1 && diffDays <= 35) { 
                    
                    const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
                    const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

                    finalEvents.push({
                        id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                        fixedDate: `${dayAndMonth} ${dayName}`,
                        fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                        timestamp: dateObj.getTime(),
                        broadcaster: "beIN Sports / F1 TV",
                        grandPrix: race.raceName,
                        sessionName: sessionName,
                        trackName: race.Circuit.circuitName,
                        countryLogo: F1_LOGO_BASE + flagCode + ".png", 
                        tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png",
                        circuitStats: stats 
                    });
                }
            };

            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            addSession("Yarış", race.date, race.time);
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        
        // --- DOSYA YAZMA İŞLEMİ VE KONTROLÜ ---
        const jsonOutput = JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), events: finalEvents }, null, 2);
        fs.writeFileSync(OUTPUT_FILE, jsonOutput);

        console.log("-----------------------------------------");
        console.log("✅ JSON BAŞARIYLA GÜNCELLENDİ!");
        console.log("📍 Dosya Yolu:", OUTPUT_FILE);
        console.log("🏎️ İlk Yarış:", finalEvents[0]?.grandPrix);
        console.log("🏁 Toplam Seans:", finalEvents.length);
        console.log("-----------------------------------------");

    } catch (e) { 
        console.error("❌ HATA OLUŞTU:", e.message); 
    }
}
start();