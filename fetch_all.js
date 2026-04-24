const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR (Zaman ve Filtre)
// =========================================================================
const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

// Türkiye Saati Hesaplama
const getTRTime = () => new Date().getTime() + (3 * 60 * 60 * 1000);
const getTRDate = (offset = 0) => {
    const trTime = new Date(getTRTime());
    trTime.setDate(trTime.getDate() + offset);
    return trTime.toISOString().split('T')[0];
};

const trNow = getTRTime();
const trToday = getTRDate(0);
const trTomorrow = getTRDate(1);
const validDates = [trToday, trTomorrow];

// =========================================================================
// ⚽ FUTBOL SIKIYÖNETİM LİSTESİ (Sadece Bunlar Gelecek)
// =========================================================================
const ALL_FOOT_IDS = [
    52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015, // Elitler
    10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618 // Diğerleri
];
const ELITE_FOOT = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];

// =========================================================================
// 🏀 BASKETBOL AYARLARI (BSL 519 & NBA Fix)
// =========================================================================
const BASK_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
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
    console.log(`🚀 MAÇ SAATİ AKILLI FİLTRE & SIRALAMA (TR: ${trToday})`);
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

    try {
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000));

        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();

    } catch (e) { console.error("❌ Hata:", e.message); }
    finally { await browser.close(); console.log("✅ İşlem tamamlandı."); }
}

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }

    const matches = allRaw.map(e => {
        const ut = e.tournament?.uniqueTournament;
        // 🚀 SIKIYÖNETİM FİLTRESİ: Sadece listedekiler
        if (!ut || !ALL_FOOT_IDS.includes(ut.id) || duplicateTracker.has(e.id)) return null;

        const ts = e.startTimestamp * 1000;
        const dt = new Date(ts + (3 * 60 * 60 * 1000)); // TR Zamanına çevir
        const dayTR = dt.toISOString().split('T')[0];
        
        if (!validDates.includes(dayTR)) return null;

        duplicateTracker.add(e.id);
        const fixedTime = dt.toISOString().substring(11, 16);
        
        // 🚀 AKILLI DURUM MANTIĞI
        let displayTime = fixedTime;
        if (e.status?.type === 'notstarted' && ts < trNow) {
            displayTime = "BAŞLAMADI";
        }

        return {
            id: e.id, isElite: ELITE_FOOT.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: dayTR,
            fixedTime: displayTime, timestamp: ts,
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: ut.name
        };
    }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp); // 🚀 ZAMANA GÖRE SIRALA

    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`✅ Futbol: ${matches.length} elit maç kaydedildi.`);
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }

    const matches = allRaw.map(e => {
        const ut = e.tournament?.uniqueTournament;
        if (!ut || !targetBaskIds.includes(ut.id) || duplicateTracker.has(e.id)) return null;

        const ts = e.startTimestamp * 1000;
        const dt = new Date(ts + (3 * 60 * 60 * 1000));
        const dayTR = dt.toISOString().split('T')[0];
        if (!validDates.includes(dayTR)) return null;

        duplicateTracker.add(e.id);
        const fixedTime = dt.toISOString().substring(11, 16);
        let displayTime = fixedTime;
        if (e.status?.type === 'notstarted' && ts < trNow) displayTime = "BAŞLAMADI";

        const isNBA = ut.id === 3547;
        const tourName = isNBA ? "NBA" : (ut.name.includes("Super League") ? "Basketbol Süper Ligi" : ut.name);

        return {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: dayTR, fixedTime: displayTime,
            timestamp: ts, broadcaster: baskConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: `${BASK_BASE}logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `${BASK_BASE}logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            tournamentLogo: `${BASK_BASE}tournament_logos/${isNBA ? "3547" : ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: tourName
        };
    }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp); // 🚀 SIRALAMA

    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`✅ Basketbol: ${matches.length} maç.`);
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    const duplicateTracker = new Set();
    let allRaw = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await page.evaluate(async (dt) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${dt}`);
            return res.ok ? await res.json() : null;
        }, d);
        if (data?.events) allRaw.push(...data.events);
    }
    const matches = allRaw.map(e => {
        if (duplicateTracker.has(e.id) || (e.tournament?.name || "").toUpperCase().match(/ITF|CHALLENGER|UTR/)) return null;
        const ts = e.startTimestamp * 1000;
        const dt = new Date(ts + (3 * 60 * 60 * 1000));
        const dayTR = dt.toISOString().split('T')[0];
        if (!validDates.includes(dayTR)) return null;

        duplicateTracker.add(e.id);
        const fixedTime = dt.toISOString().substring(11, 16);
        return {
            id: e.id, status: e.status?.type, matchStatus: { type: e.status?.type },
            fixedDate: dayTR, fixedTime: ts < trNow && e.status?.type === 'notstarted' ? "BAŞLAMADI" : fixedTime,
            timestamp: ts, homeTeam: { name: e.homeTeam.name }, awayTeam: { name: e.awayTeam.name },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/${e.tournament?.uniqueTournament?.id || 0}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: e.tournament.name
        };
    }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
}

async function runF1() {
    try {
        const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await res.json();
        const races = data.MRData.RaceTable.Races.map(r => ({
            id: r.round, grandPrix: r.raceName, timestamp: new Date(`${r.date}T${r.time}`).getTime(),
            fixedDate: r.date, fixedTime: r.time
        }));
        fs.writeFileSync("matches_f1.json", JSON.stringify({ success: true, events: races }, null, 2));
    } catch { console.log("F1 Hata."); }
}

start();