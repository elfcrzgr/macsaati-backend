const fs = require('fs');

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const OUTPUT_FILE = "matches_f1.json";

async function start() {
    console.log("🏎️ Formula 1 motoru başlatılıyor (Açık Kaynak Jolpi API)...");

    try {
        // Puppeteer'a veda! Doğrudan API'den saniyesinde tüm sezonu çekiyoruz.
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;

        const finalEvents = [];
        const now = new Date();

        // API'den gelen UTC saatleri Türkiye saatine (TSİ) çeviren yardımcı
        const getTRTime = (dateStr, timeStr) => {
            if (!dateStr || !timeStr) return null;
            return new Date(`${dateStr}T${timeStr}`);
        };

        races.forEach(race => {
            // F1 pistinin benzersiz ID'si (Örn: "albert_park", "bahrain", "monaco")
            // Bunu Android uygulamasında bayrak veya pist silueti göstermek için kullanacağız.
            const circuitId = race.Circuit.circuitId; 
            const gpName = race.raceName;

            const addSession = (sessionName, dateObj) => {
                if (!dateObj) return;
                
                // F1 takvimi bütün yılı içerdiği için sadece bize lazım olanları filtreliyoruz
                // Kural: Bugünden 2 gün öncesi ile 15 gün sonrası arasındaki seansları göster
                const diffDays = (dateObj - now) / (1000 * 60 * 60 * 24);
                if (diffDays >= -2 && diffDays <= 15) {
                    const dayStr = dateObj.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    const timeStr = dateObj.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

                    // Maç/Seans durumu: Geçmiş mi, Canlı mı, Gelecek mi?
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
                        
                        matchStatus: {
                            type: statusType,
                            description: statusType === "finished" ? "Tamamlandı" : (statusType === "inprogress" ? "Canlı" : "-"),
                            code: statusType === "finished" ? 100 : 0
                        },
                        // Logo ismini circuitId yapıyoruz (Örn: albert_park.png)
                        tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png"
                    });
                }
            };

            // Hafta sonu takvimindeki tüm etkinlikleri sırayla ekle
            if (race.FirstPractice) addSession("1. Antrenman", getTRTime(race.FirstPractice.date, race.FirstPractice.time));
            if (race.SecondPractice) addSession("2. Antrenman", getTRTime(race.SecondPractice.date, race.SecondPractice.time));
            if (race.ThirdPractice) addSession("3. Antrenman", getTRTime(race.ThirdPractice.date, race.ThirdPractice.time));
            if (race.Qualifying) addSession("Sıralama", getTRTime(race.Qualifying.date, race.Qualifying.time));
            if (race.Sprint) addSession("Sprint", getTRTime(race.Sprint.date, race.Sprint.time));
            
            // Ana Yarış
            addSession("Yarış", getTRTime(race.date, race.time));
        });

        // Tarih ve saate göre sırala ki Android'de düzgün görünsün
        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
            success: true, 
            lastUpdated: new Date().toISOString(), 
            totalSessions: finalEvents.length,
            events: finalEvents 
        }, null, 2));

        console.log(`\n✅ ${finalEvents.length} adet F1 seansı başarıyla JSON'a yazıldı!`);

    } catch (e) {
        console.error("❌ F1 verileri çekilirken hata:", e.message);
    }
}

start();
