const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// 📊 LOG ÖZETİ
let globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    const name = leagueName || "Bilinmeyen";
    globalSummary[sport][name] = (globalSummary[sport][name] || 0) + 1;
}

function printFullSummary() {
    console.log("\n📊 GÜNCEL TARAMA ÖZETİ");
    console.log("-----------------------------------------");
    for (const [sport, leagues] of Object.entries(globalSummary)) {
        console.log(`\n[${sport.toUpperCase()}]`);
        const sorted = Object.entries(leagues).sort((a, b) => b[1] - a[1]);
        sorted.forEach(([name, count]) => console.log(`📍 ${name}: ${count} maç`));
    }
    console.log("-----------------------------------------\n");
    globalSummary = {};
}

// ⚽ AYARLAR & LOGOLAR
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const getFootBroadcaster = (utId) => {
    const staticConfigs = { 34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 938: "S Sport", 17: "beIN Sports", 8: "S Sport", 23: "S Sport", 7: "TRT", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 1: "TRT 1 / Tabii" };
    return staticConfigs[utId] || "Resmi Yayıncı";
};

// 🏀 AYARLAR & LOGOLAR
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];
const baskLeagueConfigs = { 3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor", 132: "beIN Sports 5" };
const targetBaskIds = Object.keys(baskLeagueConfigs).map(Number);

// 🎾 AYARLAR & LOGOLAR
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// 🚀 MOTORLAR
async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        } catch (e) {}
    }
    const matches = allEvents.map(e => {
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        addToSummary("football", ut.name);
        return {
            id: e.id, isElite: ELITE_FOOT_IDS.includes(ut.id), status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: status === 'inprogress' ? "CANLI" : new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootBroadcaster(ut.id),
            homeTeam: { name: e.homeTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + ut.id + ".png",
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        };
    });
    // 📁 KLASÖR YOLU DÜZELTİLDİ
    fs.writeFileSync("football/matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: matches.length, matches }, null, 2));
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    let allEvents = [];
    try {
        const data = await page.evaluate(async (d) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
            return res.ok ? await res.json() : null;
        }, getTRDate(0));
        if (data?.events) allEvents = data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id));
    } catch (e) {}
    const matches = allEvents.map(e => {
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        addToSummary("basketball", ut.name);
        return {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status,
            fixedDate: getTRDate(0),
            fixedTime: status === 'inprogress' ? "CANLI" : "BAŞLAMADI",
            timestamp: e.startTimestamp * 1000,
            broadcaster: baskLeagueConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + ut.id + ".png",
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        };
    });
    // 📁 KLASÖR YOLU DÜZELTİLDİ
    fs.writeFileSync("basketball/matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: matches.length, matches }, null, 2));
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    try {
        const data = await page.evaluate(async (d) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
            return res.ok ? await res.json() : null;
        }, getTRDate(0));
        if (data?.events) {
            const matches = data.events.filter(e => !e.tournament.name.includes("ITF")).map(e => {
                const status = e.status.type;
                addToSummary("tennis", e.tournament.name);
                return {
                    id: e.id, isElite: true, status, fixedDate: getTRDate(0),
                    fixedTime: status === 'inprogress' ? "CANLI" : "BAŞLAMADI",
                    timestamp: e.startTimestamp * 1000,
                    broadcaster: "S Sport / beIN",
                    homeTeam: { name: e.homeTeam.name, logos: [TENNIS_LOGO_BASE + "mc.png"] },
                    awayTeam: { name: e.awayTeam.name, logos: [TENNIS_LOGO_BASE + "mc.png"] },
                    tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament.uniqueTournament?.id || 0) + ".png",
                    homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
                    awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
                    tournament: e.tournament.name
                };
            });
            // 📁 TENİS GENELDE ANA DİZİNDEDİR
            fs.writeFileSync("tennis/matches_tennis.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: matches.length, matches }, null, 2));
        }
    } catch (e) {}
}

async function start() {
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    try {
        await runFootball(page); await runBasketball(page); await runTennis(page);
        printFullSummary();
    } catch (e) { console.error(e); }
    finally { await browser.close(); }
}

async function loop() {
    console.log("🟢 CANLI SKOR SUNUCUSU AKTİF");
    while (true) {
        try {
            await start();
            const simdi = new Date().toLocaleTimeString('tr-TR');
            exec('git add . && git commit -m "Canlı Skor Güncellemesi" && git push', (error) => {
                if (!error) console.log(`[${simdi}] ☁️ GitHub BAŞARILI!`);
            });
        } catch (e) {}
        await new Promise(r => setTimeout(r, 60000));
    }
}
loop();