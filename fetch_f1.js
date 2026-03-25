const fs = require('fs');
const path = require('path');

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// F1 logoları için klasör yolları
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const OUTPUT_FILE = "matches_f1.json";

// --- YENİ EKLENEN KISIM: İstatistikleri dışarıdan okuyoruz ---
const statsFilePath = path.join(__dirname, 'f1_stats.json');
let circuitStats = {};
try {
    circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
} catch (err) {
    console.error("⚠️ f1_stats.json okunamadı, boş veriler kullanılacak.", err.message);
}
// -------------------------------------------------------------

async function start() {
    console.log("🏎️ Formula 1 motoru başlatılıyor (Jolpi API + Pist İstatistikleri Destekli)...");

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        const now = new Date();

        // API'den gelen UTC saatleri Türkiye saatine çeviren yardımcı fonksiyon
        const getTRTime = (dateStr, timeStr) => {
            if (!dateStr || !timeStr) return null;
            return new Date(`${dateStr}T${timeStr}`);
        };

        races.forEach(race => {
            // Temel F1 Verileri
            const circuitId = race.Circuit.circuitId; // Örn: "suzuka", "bahrain"
            const gpName = race.raceName; // Örn: "Japanese Grand Prix"
            const trackName = race.Circuit.circuitName; // Örn: "Suzuka Circuit"
            const countryName = race.Circuit.Location.country; // Örn: "Japan"
            
            // Ülke adını bayrak URL'si için formata sokuyoruz
            const countryFormatted = countryName.toLowerCase().replace(/\s/g, '_');

            // --- YENİ: JSON'dan ilgili pistin istatistiklerini buluyoruz ---
            const stats = circuitStats[circuitId] || circuitStats["default"] || {};

            const addSession = (sessionName, dateObj) => {
                if (!dateObj) return;
                
                // Bugünden 2 gün öncesi ile 15 gün sonrası arasındaki seansları göster
                const diffDays = (dateObj - now) / (1000 * 60 * 60 * 24);
                if (diffDays >= -2 && diffDays <= 15) {
                    const dayStr = dateObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    const timeStr = dateObj.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

                    // Maç Durumu (Geçti mi, Canlı mı, Bekliyor mu?)
                    let statusType = "notstarted";
                    if (now > dateObj) {
                        statusType = "finished";
                        if ((now - dateObj) < (2 * 60 * 60 * 1000)) { // F1 seansları ortalama 2 saat sürer
                            statusType = "inprogress";
                        }
                    }

                    finalEvents.push({
                        id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                        fixedDate: dayStr,
                        fixedTime: timeStr,
                        timestamp: dateObj.getTime(),
                        broadcaster: "beIN Sports / F1 TV",
                        
                        grandPrix: gpName,
                        sessionName: sessionName,
                        trackName: trackName,
                        country: countryName,
                        
                        matchStatus: {
                            type: statusType,
                            description: statusType === "finished" ? "Tamamlandı" : (statusType === "inprogress" ? "Canlı" : "-"),
                            code: statusType === "finished" ? 100 : 0
                        },
                        
                        // Dinamik Logolar
                        countryLogo: F1_LOGO_BASE + countryFormatted + ".png", // Bayrak görseli
                        tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png",  // Pist silüeti

                        // --- YENİ EKLENEN KISIM: İstatistikler Android'e gönderiliyor ---
                        circuitStats: stats 
                    });
                }
            };

            // Seansları Ekle (Antrenmanlar, Sıralama, Sprint, Yarış)
            if (race.FirstPractice) addSession("1. Antrenman", getTRTime(race.FirstPractice.date, race.FirstPractice.time));
            if (race.SecondPractice) addSession("2. Antrenman", getTRTime(race.SecondPractice.date, race.SecondPractice.time));
            if (race.ThirdPractice) addSession("3. Antrenman", getTRTime(race.ThirdPractice.date, race.ThirdPractice.time));
            if (race.Qualifying) addSession("Sıralama", getTRTime(race.Qualifying.date, race.Qualifying.time));
            if (race.Sprint) addSession("Sprint", getTRTime(race.Sprint.date, race.Sprint.time));
            addSession("Yarış", getTRTime(race.date, race.time));
        });

        // Tarih ve saate göre sırala
        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
            success: true, 
            lastUpdated: new Date().toISOString(), 
            totalSessions: finalEvents.length,
            events: finalEvents 
        }, null, 2));

        console.log(`\n✅ ${finalEvents.length} adet F1 seansı (Bayrak, Pist ve Rekor bilgileriyle) JSON'a yazıldı!`);

    } catch (e) {
        console.error("❌ F1 verileri çekilirken hata:", e.message);
    }
}

start();