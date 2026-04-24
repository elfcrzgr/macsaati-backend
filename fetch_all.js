const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

// 🚀 UTC NE OLURSA OLSUN TÜRKİYE SAATİNİ HESAPLAR
const getTRDate = (offset = 0) => {
    const d = new Date();
    // UTC zamanına 3 saat ekleyerek Türkiye saatine sabitliyoruz
    const trTime = new Date(d.getTime() + (3 * 60 * 60 * 1000)); 
    trTime.setDate(trTime.getDate() + offset);
    return trTime.toISOString().split('T')[0]; // Kesinlikle "2026-04-24" formatı
};

const trToday = getTRDate(0);
const trTomorrow = getTRDate(1);
const validDates = [trToday, trTomorrow];

const globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    globalSummary[sport][leagueName] = (globalSummary[sport][leagueName] || 0) + 1;
}

function printSportSummary(sport, rawCount) {
    console.log(`\n📊 ${sport.toUpperCase()} ÖZET RAPORU`);
    console.log(`📡 Kaynaktan gelen ham veri: ${rawCount} maç`);
    let total = 0;
    const sorted = Object.entries(globalSummary[sport] || {}).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, c]) => { console.log(`   📍 ${l}: ${c} maç`); total += c; });
    console.log(`✅ Filtre sonrası kaydedilen: ${total} maç.`);
    console.log("-----------------------------------------\n");
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const ELITE_FOOT = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_IDS = [...ELITE_FOOT, ...REGULAR_FOOT];

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const ELITE_BASK_IDS = [3547, 138, 142, 519, 132, 167, 168]; 
const baskConfigs = {
    519: "TRT Spor / Tabii", 3547: "beIN Sports 5", 138: "S Sport Plus", 142: "S Sport Plus",
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus", 168: "TRT Spor Yıldız",
    235: "S Sport Plus", 304: "beIN Sports", 227: "beIN Sports", 164: "beIN Sports"
};
const targetBaskIds = Object.keys(baskConfigs).map(Number);

// =========================================================================
// 🚀 ANA MOTOR
// =========================================================================
async function start() {
    console.log(`🚀 MAÇ SAATİ OTOMASYON (${trToday} / ${trTomorrow})`);
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log("🛡️ Güvenlik duvarı aşılıyor (10 saniye bekleme)...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000)); // Actions için bekleme artırıldı

        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();

    } catch (e) { console.error("❌ KRİTİK HATA:", e.message); }
    finally { await browser.close(); console.log("✅ İşlem Bitti."); }
}

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    const duplicateTracker = new Set();
    let rawEvents = [];
    
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${dt}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, d);
        if (data?.events) rawEvents.push(...data.events);
    }

    const matches = rawEvents.map(e => {
        if (duplicateTracker.has(e.id)) return null;
        const ut = e.tournament?.uniqueTournament;
        if (!ut) return null;

        const dt = new Date(e.startTimestamp * 1000);
        // TR Saatiyle kıyaslama
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        
        if (!validDates.includes(matchDay)) return null;
        if (ut.name.toLowerCase().match(/u19|u21|women/)) return null;
        if (!ALL_FOOT_IDS.includes(ut.id) && !(ut.hasEventPlayerStatistics && ut.priority < 100)) return null;

        duplicateTracker.add(e.id);
        addToSummary("football", ut.name);
        return {
            id: e.id, isElite: ELITE_FOOT.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: matchDay,
            fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).getUTCHours().toString().padStart(2, '0') + ":" + new Date(dt.getTime()).getUTCMinutes().toString().padStart(2, '0'),
            timestamp: e.startTimestamp * 1000,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: ut.name
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("football", rawEvents.length);
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    const duplicateTracker = new Set();
    let rawEvents = [];
    
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${dt}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, d);
        if (data?.events) rawEvents.push(...data.events);
    }

    const matches = rawEvents.map(e => {
        if (duplicateTracker.has(e.id)) return null;
        const ut = e.tournament?.uniqueTournament;
        if (!ut || !targetBaskIds.includes(ut.id)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        
        if (!validDates.includes(matchDay)) return null;

        duplicateTracker.add(e.id);
        const isNBA = (ut.id === 3547 || ut.name.toUpperCase().includes("NBA"));
        addToSummary("basketball", isNBA ? "NBA" : ut.name);

        return {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: matchDay,
            fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).getUTCHours().toString().padStart(2, '0') + ":" + new Date(dt.getTime()).getUTCMinutes().toString().padStart(2, '0'),
            timestamp: dt.getTime(),
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "NBA/3547" : ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: isNBA ? "NBA" : ut.name
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("basketball", rawEvents.length);
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    const duplicateTracker = new Set();
    let rawEvents = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${dt}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, d);
        if (data?.events) rawEvents.push(...data.events);
    }

    const matches = rawEvents.map(e => {
        if (duplicateTracker.has(e.id)) return null;
        if ((e.tournament?.name || "").toUpperCase().match(/ITF|CHALLENGER|UTR/)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        if (!validDates.includes(matchDay)) return null;

        duplicateTracker.add(e.id);
        addToSummary("tennis", e.tournament.name);
        return {
            id: e.id, status: e.status?.type, matchStatus: { type: e.status?.type },
            fixedDate: matchDay, fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).getUTCHours().toString().padStart(2, '0') + ":" + new Date(dt.getTime()).getUTCMinutes().toString().padStart(2, '0'),
            timestamp: dt.getTime(), homeTeam: { name: e.homeTeam.name }, awayTeam: { name: e.awayTeam.name },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/${e.tournament?.uniqueTournament?.id || 0}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: e.tournament.name
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
    printSportSummary("tennis", rawEvents.length);
}

async function runF1() {
    console.log("🏎️ F1 taranıyor...");
    try {
        const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await res.json();
        const races = data.MRData.RaceTable.Races.map(r => ({
            id: r.round, grandPrix: r.raceName, timestamp: new Date(`${r.date}T${r.time}`).getTime(),
            fixedDate: r.date, fixedTime: r.time
        }));
        fs.writeFileSync("matches_f1.json", JSON.stringify({ success: true, events: races }, null, 2));
        console.log("✅ F1 Tamam.");
    } catch (e) { console.log("F1 Hata"); }
}

start();
