const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

const globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    const name = leagueName || "Bilinmeyen";
    globalSummary[sport][name] = (globalSummary[sport][name] || 0) + 1;
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const teamTranslations = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "belgium": "Belçika", "switzerland": "İsviçre", "usa": "ABD", "japan": "Japonya"
};

const translateTeam = (name) => {
    if (!name) return name;
    let translatedName = name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

const getFootBroadcaster = (utId, hName, aName, tName, utName) => {
    const staticConfigs = { 34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 938: "S Sport", 17: "beIN Sports", 8: "S Sport", 23: "S Sport", 7: "TRT / Tabii", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 10: "Exxen", 1: "TRT 1 / Tabii" };
    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];
const baskLeagueConfigs = { 3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor", 132: "beIN Sports 5" };
const targetBaskIds = Object.keys(baskLeagueConfigs).map(Number);

// =========================================================================
// 🎾 TENİS AYARLARI
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (t, c) => (t+c).toUpperCase().includes("ITF") || (t+c).toUpperCase().includes("CHALLENGER");

// =========================================================================
// 🏎️ F1 AYARLARI
// =========================================================================
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

// =========================================================================
// 🚀 MOTOR FONKSİYONLARI
// =========================================================================

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
        const live = status === 'inprogress';
        return {
            id: e.id, isElite: ELITE_FOOT_IDS.includes(ut.id), status,
            fixedTime: live ? "CANLI" : new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            homeScore: (live || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (live || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        };
    });
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
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
        const status = e.status.type;
        const live = status === 'inprogress';
        const isNBA = e.tournament.uniqueTournament.id === 3547;
        return {
            id: e.id, status, fixedTime: live ? "CANLI" : "BAŞLAMADI",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" },
            homeScore: (live || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (live || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : e.tournament.uniqueTournament.name
        };
    });
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    try {
        const data = await page.evaluate(async (d) => {
            const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
            return res.ok ? await res.json() : null;
        }, getTRDate(0));
        
        if (data?.events) {
            const matches = data.events.filter(e => !isGarbage(e.tournament.name, e.tournament.category.name)).map(e => {
                const status = e.status.type;
                const live = status === 'inprogress';
                let setScores = "";
                if (e.homeScore && e.awayScore) {
                    let sets = [];
                    for(let i=1; i<=3; i++) {
                        if(e.homeScore[`period${i}`] !== undefined) sets.push(`${e.homeScore[`period${i}`]}-${e.awayScore[`period${i}`]}`);
                    }
                    setScores = sets.join(", ");
                }
                return {
                    id: e.id, status, fixedTime: live ? "CANLI" : "BAŞLAMADI",
                    homeTeam: { name: e.homeTeam.name }, awayTeam: { name: e.awayTeam.name },
                    homeScore: (live || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
                    awayScore: (live || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
                    setScores, tournament: e.tournament.name
                };
            });
            fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
        }
    } catch (e) {}
}

async function start() {
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    try {
        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
    } catch (e) { console.error(e); }
    finally { await browser.close(); }
}

// =========================================================================
// 🔄 ANA DÖNGÜ (DURMAZ, YORULMAZ)
// =========================================================================
async function loop() {
    console.log("🟢 CANLI SKOR SUNUCUSU BAŞLATILDI");
    while (true) {
        const simdi = new Date().toLocaleTimeString('tr-TR');
        try {
            await start();
            console.log(`[${simdi}] ✅ Veriler çekildi. GitHub'a itiliyor...`);
            exec('git add . && git commit -m "Canlı Skor Güncellemesi" && git push', (error) => {
                if (error) {
                    if (error.message.includes("nothing to commit")) console.log("☁️ Değişiklik yok.");
                    else console.error("❌ Git Hatası:", error.message);
                } else { console.log("☁️ GitHub BAŞARILI!"); }
            });
        } catch (e) { console.error("❌ Hata:", e.message); }
        await new Promise(r => setTimeout(r, 60000)); // 1 dakika mola
    }
}

loop();