const fs = require('fs');
const admin = require('firebase-admin');

// =========================================================================
// 🔥 FIREBASE BAŞLATMA
// =========================================================================
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/"
    });
}
console.log("🔥 Firebase Admin başlatıldı (Formula 1).");

// =========================================================================
// ⚙️ AYARLAR VE SABİTLER
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const HOUR_MS = 60 * 60000;
const DAY_MS = 24 * 60 * 60000;

const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

const CIRCUIT_DETAILS = {
    "bahrain": { laps: "57", length: "5.412 km", record: "1:31.447 - Pedro de la Rosa" },
    "jeddah": { laps: "50", length: "6.174 km", record: "1:30.734 - Lewis Hamilton" },
    "albert_park": { laps: "58", length: "5.278 km", record: "1:19.813 - Charles Leclerc" },
    "suzuka": { laps: "53", length: "5.807 km", record: "1:30.983 - Lewis Hamilton" },
    "shanghai": { laps: "56", length: "5.451 km", record: "1:32.238 - Michael Schumacher" },
    "miami": { laps: "57", length: "5.412 km", record: "1:29.708 - Max Verstappen" },
    "imola": { laps: "63", length: "4.909 km", record: "1:15.484 - Lewis Hamilton" },
    "monaco": { laps: "78", length: "3.337 km", record: "1:12.909 - Lewis Hamilton" },
    "villeneuve": { laps: "70", length: "4.361 km", record: "1:13.078 - Valtteri Bottas" },
    "catalunya": { laps: "66", length: "4.675 km", record: "1:18.149 - Max Verstappen" },
    "red_bull_ring": { laps: "71", length: "4.318 km", record: "1:05.619 - Carlos Sainz" },
    "silverstone": { laps: "52", length: "5.891 km", record: "1:27.097 - Max Verstappen" },
    "hungaroring": { laps: "70", length: "4.381 km", record: "1:16.627 - Lewis Hamilton" },
    "spa": { laps: "44", length: "7.004 km", record: "1:46.286 - Valtteri Bottas" },
    "zandvoort": { laps: "72", length: "4.259 km", record: "1:11.097 - Lewis Hamilton" },
    "monza": { laps: "53", length: "5.793 km", record: "1:21.046 - Rubens Barrichello" },
    "baku": { laps: "51", length: "6.003 km", record: "1:43.009 - Charles Leclerc" },
    "marina_bay": { laps: "62", length: "4.940 km", record: "1:35.867 - Lewis Hamilton" },
    "americas": { laps: "56", length: "5.513 km", record: "1:36.169 - Charles Leclerc" },
    "rodriguez": { laps: "71", length: "4.304 km", record: "1:17.774 - Valtteri Bottas" },
    "interlagos": { laps: "71", length: "4.309 km", record: "1:10.540 - Valtteri Bottas" },
    "vegas": { laps: "50", length: "6.201 km", record: "1:35.490 - Oscar Piastri" },
    "losail": { laps: "57", length: "5.419 km", record: "1:24.319 - Max Verstappen" },
    "yas_marina": { laps: "58", length: "5.281 km", record: "1:26.103 - Max Verstappen" }
};

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function uploadToFirebase(sportName, data) {
    try {
        const db = admin.database();
        const ref = db.ref(`matches_${sportName}`);
        await ref.set(data);
        console.log(`✅ [FIREBASE] ${sportName.toUpperCase()} başarıyla güncellendi!`);
    } catch (error) {
        console.error(`❌ [FIREBASE] ${sportName} Hata:`, error.message);
    }
}

async function fetchData(url) {
    try {
        const delay = Math.floor(Math.random() * 1500) + 500;
        await new Promise(r => setTimeout(r, delay));

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9"
            }
        });

        if (!response.ok) {
            console.log(`⚠️ API Reddi (HTTP ${response.status})`);
            return null;
        }

        return await response.json();
    } catch (e) {
        return null;
    }
}

// =========================================================================
// 🏎️ FORMULA 1 GÜNCELLEME
// =========================================================================
async function updateF1() {
    console.log(`🏎️ Formula 1 güncelleniyor...`);
    try {
        const response = await fetchData('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response) {
            console.log("⚠️ F1 API'den yanıt alınamadı.");
            return null;
        }

        const races = response.MRData?.RaceTable?.Races || [];
        const finalEvents = [];

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
            const stats = CIRCUIT_DETAILS[circuitId] || { laps: "-", length: "-", record: "-" };
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
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
                    circuitStats: { laps: stats.laps, length: stats.length, record: stats.record },
                    countryLogo: F1_LOGO_BASE + flagCode + ".png",
                    tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png"
                });
            };

            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        await uploadToFirebase("f1", { success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents });
        console.log(`  ✅ F1 güncellemesi tamamlandı.`);

        // Sıradaki seansın zamanını bul
        const now = Date.now();
        const upcomingEvent = finalEvents.find(ev => ev.timestamp > now);
        
        return upcomingEvent ? upcomingEvent.timestamp : null;

    } catch (error) {
        console.error(`   ⚠️ F1 hatası: ${error.message}`);
        return null;
    }
}

// =========================================================================
// 🆕 ANA DÖNGÜ (F1 AKILLI MİKROSERVİS)
// =========================================================================
async function main() {
    console.log("============================================================");
    console.log("🟢 J7 F1 MİKROSERVİSİ BAŞLADI (AKILLI DÖNGÜ)");
    console.log("============================================================");

    let iteration = 1;

    while (true) {
        try {
            console.log(`\n[🏎️ İterasyon ${iteration}] ${new Date().toLocaleTimeString('tr-TR')}`);
            
            const nextSessionTimestamp = await updateF1();
            let sleepTime = DAY_MS; // Standart olarak 24 saat uyu

            if (nextSessionTimestamp) {
                const timeToNext = nextSessionTimestamp - Date.now();
                
                // Eğer sıradaki seansa 48 saatten (2 gün) az kaldıysa, Yarış Haftası moduna gir!
                if (timeToNext < 2 * DAY_MS) {
                    sleepTime = HOUR_MS;
                    console.log(`🏁 [YARIŞ HAFTASI] Sıradaki F1 seansına ${(timeToNext / HOUR_MS).toFixed(1)} saat kaldı! Saatlik kontrol devrede.`);
                } else {
                    console.log(`🛌 [DİNLENME MODU] Sıradaki F1 seansına ${(timeToNext / DAY_MS).toFixed(1)} gün var. Sistem 24 saat uykuya geçiyor.`);
                }
            } else {
                console.log(`🏁 [SEZON SONU] Yaklaşan yarış bulunamadı. Sistem 24 saat uykuya geçiyor.`);
            }

            await new Promise(r => setTimeout(r, sleepTime));
            iteration++;
        } catch (e) {
            console.error("🚨 Döngü Hatası:", e.message);
            await new Promise(r => setTimeout(r, 10 * 60000));
        }
    }
}

main();
