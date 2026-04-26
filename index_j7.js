const fs = require('fs');
const { exec } = require('child_process');

// =========================================================================
// ⚙️ AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const INTERVAL = 60000; // Her 1 dakikada bir çalışır
const TARGET_FILE = "matches_football_j7.json"; // Hedef dosya adı güncellendi

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// Senin mevcut Elit ve Regular ID'lerin
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Samsung J7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" 
            }
        });
        return response.ok ? await response.json() : null;
    } catch (e) { return null; }
}

function pushToGithub() {
    return new Promise((resolve) => {
        const simdi = new Date().toLocaleTimeString('tr-TR');
        // Commit mesajını ve dosya takibini J7'ye göre netleştirdik
        exec(`git add ${TARGET_FILE} && git commit -m "J7 Canlı Skor: ${simdi}" && git push`, (error) => {
            if (error) console.error(`❌ GitHub Hatası: ${error.message}`);
            else console.log(`[${simdi}] ✅ J7 -> GitHub BAŞARILI!`);
            resolve();
        });
    });
}

// =========================================================================
// ⚽ FUTBOL MOTORU (HAFİF)
// =========================================================================
async function updateFootball() {
    console.log(`⚽ Futbol güncelleniyor (${TARGET_FILE})...`);
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const matches = allEvents.map(e => {
        const status = e.status.type;
        const isLive = status === 'inprogress';
        
        let liveMinute = "";
        if (isLive) {
            liveMinute = e.status.description || "";
            if (liveMinute.toLowerCase().includes("half")) liveMinute = "İY";
            else liveMinute = liveMinute.replace(/[^0-9+]/g, '');
        }

        return {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(e.tournament?.uniqueTournament?.id),
            status: status,
            liveMinute: liveMinute,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            homeScore: (isLive || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (isLive || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: e.tournament.name
        };
    });

    // Yazma işlemi yeni dosya ismine göre yapılıyor
    fs.writeFileSync(TARGET_FILE, JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function loop() {
    console.log("🟢 J7 CANLI SUNUCU BAŞLADI");
    while (true) {
        try {
            await updateFootball();
            await pushToGithub();
        } catch (e) { console.error("🚨 Hata:", e.message); }
        
        console.log(`⏳ ${INTERVAL/1000} saniye bekleniyor...`);
        await new Promise(r => setTimeout(r, INTERVAL));
    }
}

loop();
