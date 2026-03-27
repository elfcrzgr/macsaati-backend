const fs = require('fs');
const path = require('path');

// GitHub Bilgilerin
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// Klasör Yolları
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

// Dosyanın yazılacağı konum
const OUTPUT_FILE = path.join(__dirname, "matches_f1.json");

// f1_stats.json dosyasını oku (Pist rekorları vb.)
const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    console.log("📊 Pist istatistikleri başarıyla yüklendi.");
} catch (err) {
    console.log("⚠️ f1_stats.json bulunamadı, varsayılan değerler kullanılacak.");
}

async function start() {
    console.log("🏎️ F1 Motoru başlatılıyor... Tüm sezon takvimi çekiliyor.");

    try {
        // Ergast/Jolpi API'den güncel sezonu çekiyoruz
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response.ok) throw new Error("API hatası: " + response.status);
        
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];

        // Ülke isimlerini 2 haneli dosya adlarına çeviren mapping
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
            
            // Bayrak kodunu belirle
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";
            
            // Stats dosyasından pist bilgilerini al (yoksa default'u al)
            const stats = circuitStats[circuitId] || circuitStats["default"] || {};

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                
                // API'den gelen tarih ve saati birleştirip Date objesi yapıyoruz
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                
                // NOT: Artık tarih filtresi (diffDays) yok! Tüm sezonu ekliyoruz.
                // Filtreleme işini Android tarafındaki adaptör yapacak.
                
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
            };

            // Seansları ekle
            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        // Tüm sezonu zaman sırasına diz
        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        // JSON Formatı
        const outputData = {
            success: true,
            lastUpdated: new Date().toISOString(),
            totalSessions: finalEvents.length,
            events: finalEvents
        };

        // Dosyayı yaz
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));

        console.log("-----------------------------------------");
        console.log("✅ JSON GÜNCELLEME BAŞARILI!");
        console.log("🏁 Toplam Seans Sayısı:", finalEvents.length);
        console.log("📍 Dosya Kaydedildi:", OUTPUT_FILE);
        console.log("-----------------------------------------");

    } catch (e) {
        console.error("❌ HATA OLUŞTU:", e.message);
    }
}

start();