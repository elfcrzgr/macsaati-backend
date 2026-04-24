const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";

const getTRDate = (offset = 0) => {
    const d = new Date();
    const trTime = new Date(d.getTime() + (3 * 60 * 60 * 1000)); 
    trTime.setDate(trTime.getDate() + offset);
    return trTime.toISOString().split('T')[0];
};

const trToday = getTRDate(0);
const trTomorrow = getTRDate(1);
const validDates = [trToday, trTomorrow];

const globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    globalSummary[sport][leagueName] = (globalSummary[sport][leagueName] || 0) + 1;
}

// 🛡️ AKILLI VERİ ÇEKİCİ (Safe Fetch)
async function safeFetch(page, url) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const content = await page.evaluate(() => document.body.innerText);
        if (content.trim().startsWith('{')) return JSON.parse(content);
        return null;
    } catch (e) { return null; }
}

async function start() {
    console.log(`🚀 MAÇ SAATİ GÜNCELLEME (TR: ${trToday} / ${trTomorrow})`);
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    try {
        console.log("🛡️ SofaScore oturumu ısındırılıyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 8000));

        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();

    } catch (e) { console.error("❌ Hata:", e.message); }
    finally { await browser.close(); console.log("✅ İşlem tamamlandı."); }
}

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    const ELITE_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
    const duplicateTracker = new Set();
    let rawEvents = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await safeFetch(page, `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);
        if (data?.events) rawEvents.push(...data.events);
    }

    const matches = rawEvents.map(e => {
        const ut = e.tournament?.uniqueTournament;
        if (!ut || duplicateTracker.has(e.id)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        if (!validDates.includes(matchDay)) return null;

        duplicateTracker.add(e.id);
        addToSummary("football", ut.name);
        return {
            id: e.id, isElite: ELITE_IDS.includes(ut.id), status: e.status?.type,
            matchStatus: { type: e.status?.type }, fixedDate: matchDay,
            fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().substring(11, 16),
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/${e.awayTeam.id}.png` },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/${ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: ut.name
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`✅ Futbol: ${matches.length} maç kaydedildi.`);
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    const TARGET_IDS = [3547, 138, 142, 519, 132, 167, 168, 137, 235, 304, 227, 164];
    const ELITE_IDS = [3547, 138, 142, 519, 132];
    const duplicateTracker = new Set();
    let rawEvents = [];

    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await safeFetch(page, `https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
        if (data?.events) rawEvents.push(...data.events);
    }

    const matches = rawEvents.map(e => {
        const ut = e.tournament?.uniqueTournament;
        if (!ut || !TARGET_IDS.includes(ut.id) || duplicateTracker.has(e.id)) return null;

        const dt = new Date(e.startTimestamp * 1000);
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        if (!validDates.includes(matchDay)) return null;

        duplicateTracker.add(e.id);
        const isNBA = ut.id === 3547;
        const tourName = isNBA ? "NBA" : (ut.name === "Turkish Basketball Super League" ? "Basketbol Süper Ligi" : ut.name);
        addToSummary("basketball", tourName);

        return {
            id: e.id, 
            isElite: ELITE_IDS.includes(ut.id), 
            status: e.status?.type,
            matchStatus: { type: e.status?.type }, 
            fixedDate: matchDay,
            fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().substring(11, 16),
            // 🚀 TAKIM LOGO YOLU: NBA ise NBA/ klasörüne, değilse doğrudan logos/ klasörüne
            homeTeam: { name: e.homeTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.homeTeam.id}.png` },
            awayTeam: { name: e.awayTeam.name, logo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/${isNBA ? "NBA/" : ""}${e.awayTeam.id}.png` },
            // 🚀 TURNUVA LOGO YOLU: Hepsi doğrudan tournament_logos/ klasörüne
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/${isNBA ? "3547" : ut.id}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), 
            awayScore: String(e.awayScore?.display ?? "-"), 
            tournament: tourName
        };
    }).filter(Boolean);

    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`✅ Basketbol: ${matches.length} maç kaydedildi.`);
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    const duplicateTracker = new Set();
    let rawEvents = [];
    for (const d of [getTRDate(-1), trToday, trTomorrow]) {
        const data = await safeFetch(page, `https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
        if (data?.events) rawEvents.push(...data.events);
    }
    const matches = rawEvents.map(e => {
        if (duplicateTracker.has(e.id) || (e.tournament?.name || "").toUpperCase().match(/ITF|CHALLENGER|UTR/)) return null;
        const dt = new Date(e.startTimestamp * 1000);
        const matchDay = new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().split('T')[0];
        if (!validDates.includes(matchDay)) return null;
        duplicateTracker.add(e.id);
        addToSummary("tennis", e.tournament.name);
        return {
            id: e.id, status: e.status?.type, matchStatus: { type: e.status?.type },
            fixedDate: matchDay, fixedTime: new Date(dt.getTime() + (3 * 60 * 60 * 1000)).toISOString().substring(11, 16),
            homeTeam: { name: e.homeTeam.name }, awayTeam: { name: e.awayTeam.name },
            tournamentLogo: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/${e.tournament?.uniqueTournament?.id || 0}.png`,
            homeScore: String(e.homeScore?.display ?? "-"), awayScore: String(e.awayScore?.display ?? "-"), tournament: e.tournament.name
        };
    }).filter(Boolean);
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches }, null, 2));
    console.log(`✅ Tenis: ${matches.length} maç.`);
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
    } catch { console.log("❌ F1 Hata."); }
}

start();