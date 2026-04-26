const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
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

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const ELITE_FOOT_IDS = [19,52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const getFootBroadcaster = (utId) => {
    const staticConfigs = { 34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 938: "S Sport", 17: "beIN Sports", 8: "S Sport", 23: "S Sport", 7: "TRT", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 1: "TRT 1 / Tabii" };
    return staticConfigs[utId] || "beIN Sports";
};

const teamTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "usa": "ABD" };
const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];
const baskLeagueConfigs = { 3547: "S Sport / NBA TV", 138: "S Sport Plus", 142: "S Sport Plus", 137: "TRT Spor", 132: "beIN Sports 5" };
const targetBaskIds = Object.keys(baskLeagueConfigs).map(Number);

// =========================================================================
// 🎾 TENİS AYARLARI & YENİ YAYINCI MANTIĞI
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const ELITE_KEYWORDS = [
    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC",
    "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", 
    "MONTREAL", "TORONTO", "CANADIAN OPEN", "SHANGHAI", "PARIS", "MASTERS",
    "ROTTERDAM", "RIO DE JANEIRO", "ACAPULCO", "BARCELONA", "HALLE", "LONDON", "QUEEN'S", 
    "HAMBURG", "WASHINGTON", "TOKYO", "BASEL", "VIENNA", "MUNICH", "DALLAS", "BRISBANE", 
    "ABU DHABI", "SAN DIEGO", "CHARLESTON", "STUTTGART", "BERLIN", "EASTBOURNE", 
    "MONTERREY", "SEOUL", "STRASBOURG", "ZHENGZHOU", "BAD HOMBURG",
    "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"
];

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

// 🚀 YENİ EKLENEN YAYINCI BULUCU
const getTennisBroadcaster = (tournamentName, isElite) => {
    if (!tournamentName) return "Resmi Yayıncı";
    const t = tournamentName.toUpperCase();

    // Özel Grand Slam yayıncıları
    if (t.includes("WIMBLEDON")) return "TRT Spor / S Sport";
    if (t.includes("ROLAND GARROS") || t.includes("FRENCH OPEN") || t.includes("US OPEN") || t.includes("AUSTRALIAN OPEN")) return "Eurosport";
    
    // Elit Ligler (Masters 1000, 500 vb.)
    if (isElite) return "S Sport / beIN Sports";
    
    // Çin elemeleri, 250'lik turnuvalar ve diğer her şey
    return "Tennis TV / Resmi Yayıncı"; 
};

// =========================================================================
// 🚀 MOTORLAR
// =========================================================================

async function runFootball(page) {
    console.log("⚽ Futbol taranıyor...");
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return;
        
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        const showScore = status === 'inprogress' || status === 'finished';


// 🚀 ÖZETE EKLEME SATIRI EKSİKTİ, BURAYA EKLEDİK:
    addToSummary("football", ut.name);
        
        // ⏱️ DAKİKA BİLGİSİ ÇEKİMİ
        let liveMinute = "";
        if (status === 'inprogress') {
            liveMinute = e.status.description || "";
            // SofaScore "1st half" veya "Halftime" derse biz "İY" yapıyoruz
            if (liveMinute.toLowerCase().includes("half")) liveMinute = "İY";
        }

        const timeString = new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        
        finalMatchesMap.set(e.id, {
            id: e.id, 
            isElite: ELITE_FOOT_IDS.includes(ut.id), 
            status: status,
            liveMinute: liveMinute, // 🆕 Yeni alan
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootBroadcaster(ut.id),
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + ut.id + ".png",
            homeScore: showScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: showScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    });

    const matches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: matches.length, matches }, null, 2));
}

async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    let allEvents = [];
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            const data = await page.evaluate(async (d) => {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
                return res.ok ? await res.json() : null;
            }, date);
            if (data?.events) allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return; 
        
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        const showScore = status === 'inprogress' || status === 'finished';
        addToSummary("basketball", ut.name);
        
        const timeString = new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        finalMatchesMap.set(e.id, {
            id: e.id, isElite: ELITE_BASK_IDS.includes(ut.id), status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: baskLeagueConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + ut.id + ".png",
            homeScore: showScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: showScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    });

    const matches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: matches.length, matches }, null, 2));
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor (Klon Korumalı Derin Tarama)...");
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    const stubbornTournamentIds = new Set([2391]); 

    for (const date of targetDates) {
        try {
            const data = await page.evaluate(async (d) => {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
                return res.ok ? await res.json() : null;
            }, date);
            if (data?.events) {
                const filtered = data.events.filter(e => {
                    const tName = e.tournament?.name;
                    const cName = e.tournament?.category?.name;
                    if (isGarbage(tName, cName)) return false;
                    if (checkIsEliteMatch(tName) && e.tournament?.uniqueTournament?.id) stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                    return true;
                });
                rawEvents.push(...filtered);
            }
        } catch (e) {}
    }

    for (const tid of stubbornTournamentIds) {
        try {
            const sData = await page.evaluate(async (id) => {
                const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${id}/seasons`);
                return res.ok ? await res.json() : null;
            }, tid);
            if (sData?.seasons?.[0]?.id) {
                const sid = sData.seasons[0].id;
                for (const path of ['last/0', 'next/0', 'next/1']) {
                    const eData = await page.evaluate(async (t_id, s_id, p) => {
                        const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${t_id}/season/${s_id}/events/${p}`);
                        return res.ok ? await res.json() : null;
                    }, tid, sid, path);
                    if (eData?.events) rawEvents.push(...eData.events);
                }
            }
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    for (const e of rawEvents) {
        if (finalMatchesMap.has(e.id)) continue; 

        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!targetDates.includes(fixedDate)) continue;

        const tourName = e.tournament?.name || "";
        const catName = e.tournament?.category?.name || "";
        if (isGarbage(tourName, catName)) continue;

        let homeLogos = []; let awayLogos = [];
        let homeRank = null; let awayRank = null;

        try {
            const detail = await page.evaluate(async (id) => {
                const r = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
                const ev = await r.json();
                const eventData = ev.event;
                const getCodes = (team) => {
                    if (team.subTeams && team.subTeams.length > 0) return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                    return [team.country?.alpha2?.toLowerCase() || "mc"];
                };
                return { 
                    hCodes: getCodes(eventData.homeTeam), aCodes: getCodes(eventData.awayTeam),
                    hRank: eventData.homeTeam.ranking ? String(eventData.homeTeam.ranking) : null,
                    aRank: eventData.awayTeam.ranking ? String(eventData.awayTeam.ranking) : null
                };
            }, e.id);
            if (detail) {
                homeLogos = detail.hCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                awayLogos = detail.aCodes.map(c => `${TENNIS_LOGO_BASE}${c}.png`);
                homeRank = detail.hRank; awayRank = detail.aRank;
            }
        } catch (err) {}

        if (homeLogos.length === 0) homeLogos = [TENNIS_LOGO_BASE + "mc.png"];
        if (awayLogos.length === 0) awayLogos = [TENNIS_LOGO_BASE + "mc.png"];

        const statusType = e.status?.type;
        const timeString = dateTR.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); 
        const showScore = statusType === 'inprogress' || statusType === 'finished';
        const isEliteMatch = checkIsEliteMatch(tourName);

        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                if (e.homeScore[`period${i}`] !== undefined) sets.push(`${e.homeScore[`period${i}`]}-${e.awayScore[`period${i}`]}`);
            }
            setScoresStr = sets.join(", "); 
        }

        addToSummary("tennis", tourName);
        finalMatchesMap.set(e.id, {
            id: e.id, isElite: isEliteMatch, status: statusType,
            fixedDate: fixedDate, fixedTime: timeString, timestamp: startTimestamp,
            
            // 🚀 UYGULANAN YENİ YAYINCI MANTIĞI
            broadcaster: getTennisBroadcaster(tourName, isEliteMatch),
            
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            homeRank: homeRank, awayRank: awayRank,
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: showScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: showScore ? String(e.awayScore?.display ?? "0") : "-",
            setScores: setScoresStr, tournament: tourName
        });
    }
    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches }, null, 2));
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