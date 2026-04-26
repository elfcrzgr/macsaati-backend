const fs = require('fs');
const { exec } = require('child_process');

// =========================================================================
// ⚙️ AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const INTERVAL = 60000; // 1 Dakika

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// LOGO YOLLARI
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main`;

// ID AYARLARI
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];
const baskLeagues = { 3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor", 132: "beIN Sports 5" };

// =========================================================================
// 🛠️ YARDIMCI FONKSİYONLAR
// =========================================================================
async function fetchData(url) {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
        });
        return response.ok ? await response.json() : null;
    } catch (e) { return null; }
}

function pushToGithub() {
    return new Promise((resolve) => {
        const simdi = new Date().toLocaleTimeString('tr-TR');
        
        // (git commit ... || echo "No changes") kısmı, skor değişmese bile hatayı görmezden gelir
        const command = `git add . && (git commit -m "Canlı Skor Güncellemesi: ${simdi}" || echo "No changes") && git push origin main --force`;

        exec(command, (error) => {
            if (error) {
                // Sadece push sırasında gerçek bir bağlantı hatası olursa burası çalışır
                console.error(`❌ GitHub Gerçek Hata: ${error.message}`);
            } else {
                console.log(`[${simdi}] ✅ GitHub BAŞARILI!`);
            }
            resolve();
        });
    });
}

// =========================================================================
// ⚽ FUTBOL MOTORU
// =========================================================================
async function updateFootball() {
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        if (data?.events) allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
    }
    const matches = allEvents.map(e => ({
        id: e.id,
        isElite: ELITE_FOOT_IDS.includes(e.tournament?.uniqueTournament?.id),
        status: e.status.type,
        liveMinute: e.status.type === 'inprogress' ? (e.status.description || "").replace(/half/i, "İY") : "",
        fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
        fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: e.startTimestamp * 1000,
        homeTeam: { name: e.homeTeam.name, logo: `${BASE_URL}/football/logos/${e.homeTeam.id}.png` },
        awayTeam: { name: e.awayTeam.name, logo: `${BASE_URL}/football/logos/${e.awayTeam.id}.png` },
        homeScore: String(e.homeScore?.display ?? "-"),
        awayScore: String(e.awayScore?.display ?? "-"),
        tournament: e.tournament.name
    }));
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🏀 BASKETBOL MOTORU
// =========================================================================
async function updateBasketball() {
    let allEvents = [];
    const targets = Object.keys(baskLeagues).map(Number);
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`);
        if (data?.events) allEvents.push(...data.events.filter(e => targets.includes(e.tournament?.uniqueTournament?.id)));
    }
    const matches = allEvents.map(e => ({
        id: e.id, isElite: true, status: e.status.type,
        fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
        fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: e.startTimestamp * 1000,
        homeTeam: { name: e.homeTeam.name, logo: `${BASE_URL}/basketball/logos/${e.homeTeam.id}.png` },
        awayTeam: { name: e.awayTeam.name, logo: `${BASE_URL}/basketball/logos/${e.awayTeam.id}.png` },
        homeScore: String(e.homeScore?.display ?? "-"),
        awayScore: String(e.awayScore?.display ?? "-"),
        tournament: e.tournament.name,
        broadcaster: baskLeagues[e.tournament.uniqueTournament.id] || "beIN Sports"
    }));
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🎾 TENİS MOTORU
// =========================================================================
async function updateTennis() {
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        const data = await fetchData(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => {
                const t = (e.tournament?.name || "").toUpperCase();
                return !t.includes("ITF") && !t.includes("CHALLENGER");
            }));
        }
    }
    const matches = allEvents.map(e => ({
        id: e.id, isElite: false, status: e.status.type,
        fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
        fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: e.startTimestamp * 1000,
        // ✅ TENİS LOGO ARTIK DİZİ DEĞİL, STRING (Uygulama Hatasını Çözer)
        homeTeam: { name: e.homeTeam.name, logo: `${BASE_URL}/tennis/logos/mc.png` },
        awayTeam: { name: e.awayTeam.name, logo: `${BASE_URL}/tennis/logos/mc.png` },
        homeScore: String(e.homeScore?.display ?? "-"),
        awayScore: String(e.awayScore?.display ?? "-"),
        tournament: e.tournament.name
    }));
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
}

// =========================================================================
// 🔄 ANA DÖNGÜ
// =========================================================================
async function loop() {
    console.log("🟢 iMac CANLI SKOR SUNUCUSU BAŞLADI");
    while (true) {
        try {
            await updateFootball();
            await updateBasketball();
            await updateTennis();
            await pushToGithub();
        } catch (e) { console.error("🚨 Hata:", e.message); }
        
        await new Promise(r => setTimeout(r, INTERVAL));
    }
}

loop();