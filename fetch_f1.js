const fs = require('fs');
const path = require('path');

// GitHub Bilgilerin
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// Klasör Yolları
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

// ÇOK KRİTİK: Dosyanın yazılacağı tam konumu belirliyoruz
const OUTPUT_FILE = path.join(__dirname, "matches_f1.json");

// f1_stats.json dosyasını oku (Pist rekorları vb.)
const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    console.log("📊 Pist istatistikleri başarıyla yüklendi.");
} catch (err) {
    console.error("⚠️ f1_stats.json dosyası bulunamadı veya hatalı!");
}

async function start() {
    console.log("🏎️ F1 Motoru başlatılıyor... Veriler çekiliyor.");

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response.ok) throw new Error("API hatası: " + response.status);
        
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        const now = new Date();

        // --- TEST MODU ---
        // Miami'yi veya gelecek yarışları görmek istersen alttaki satırı aç:
        // now.setDate(now.getDate() + 35); 
        // -----------------

        // Ülke isimlerini senin f1/logos içindeki 2 haneli dosya adlarına çevirir
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
            
            // Bayrak kodunu belirle (USA gelirse 'us' yapar, diğerleri için listeden bakar)
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";
            
            const stats = circuitStats[circuitId] || circuitStats["default"];

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                
                // -1 gün (geçmiş) ile 35 gün (gelecek) arasını kapsama al
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
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        // Zaman sırasına diz
        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        // JSON'a yaz
        const outputData = {
            success: true,
            lastUpdated: new Date().toISOString(),
            totalSessions: finalEvents.length,
            events: finalEvents
        };

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));

        console.log("-----------------------------------------");
        console.log("✅ JSON GÜNCELLEME BAŞARILI!");
        console.log("📍 Dosya:", OUTPUT_FILE);
        console.log("🏁 İlk Gösterilen Yarış:", finalEvents[0]?.grandPrix);
        console.log("📡 Bayrak Linki Kontrol:", finalEvents[0]?.countryLogo);
        console.log("-----------------------------------------");

    } catch (e) {
        console.error("❌ HATA OLUŞTU:", e.message);
    }
}

start();