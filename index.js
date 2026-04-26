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

// ✅ FA Cup (19), Championship (18) ve Nations League (10783) listede
const ELITE_FOOT_IDS = [10783, 19, 18, 52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 1, 679, 17015];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

const getFootBroadcaster = (utId) => {
    const staticConfigs = { 
        10783: "TRT Spor / S Sport", // Nations League
        19: "Tivibu Spor",           // FA Cup
        18: "Exxen",                 // Championship
        34: "beIN Sports", 52: "beIN Sports", 238: "S Spor", 242: "Apple TV", 
        938: "S Sport", 17: "beIN Sports", 8: "S Sport Plus", 23: "S Sport", 
        7: "TRT", 11: "TRT 1", 351: "TRT Spor", 37: "S Sport Plus", 1: "TRT 1 / Tabii" 
    };
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
// 🎾 TENİS AYARLARI
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;

const isGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase();
    const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const ELITE_KEYWORDS = ["WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC", "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", "CINCINNATI", "MONTREAL", "TORONTO", "SHANGHAI", "PARIS", "MASTERS", "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"];

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

const getTennisBroadcaster = (tournamentName, isElite) => {
    if (!tournamentName) return "Resmi Yayıncı";
    const t = tournamentName.toUpperCase();
    if (t.includes("WIMBLEDON")) return "TRT Spor / S Sport";
    if (t.includes("ROLAND GARROS") || t.includes("FRENCH OPEN") || t.includes("US OPEN") || t.includes("AUSTRALIAN OPEN")) return "Eurosport";
    if (isElite) return "S Sport / beIN Sports";
    return "Tennis TV / Resmi Yayıncı"; 
};

// =========================================================================
// 🚀 MOTORLAR
// =========================================================================







async function runFootball(page) {
    console.log("⚽ Futbol taranıyor (Kesin Çözüm Modu)...");
    let allEvents = [];
    
    // 1. ADIM: Günlük Listeyi Çek
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) {
                allEvents.push(...data.events.filter(e => ALL_FOOT_TARGETS.includes(e.tournament?.uniqueTournament?.id)));
            }
        } catch (e) {}
    }

    // 2. ADIM: Canlı Dakika Havuzunu Çek (Daha Yavaş ve Sağlam Bekleme ile)
    let liveMinutesPool = new Map();
    try {
        await page.goto(`https://www.sofascore.com/api/v1/sport/football/events/live`, { waitUntil: 'networkidle0' }); // idle0 daha sağlam bekler
        const liveData = await page.evaluate(() => JSON.parse(document.body.innerText));
        if (liveData?.events) {
            liveData.events.forEach(le => {
                // SofaScore'un gerçek dakika alanı genellikle description içindedir
                liveMinutesPool.set(le.id, le.status?.description || "");
            });
            console.log(`✅ Canlı Havuz Hazır: ${liveMinutesPool.size} maç bulundu.`);
        }
    } catch (e) { 
        console.log("❌ KRİTİK HATA: Canlı API çekilemedi!"); 
    }

    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return;
        
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        const showScore = status === 'inprogress' || status === 'finished';
        
        let liveMinute = "";
        if (status === 'inprogress') {
            // HAVUZ KONTROLÜ
            if (liveMinutesPool.has(e.id)) {
                const clock = liveMinutesPool.get(e.id); // Örn: "78'"
                
                if (clock.includes("'")) {
                    liveMinute = clock.replace(/[^0-9+]/g, "").trim(); 
                } else if (clock.toLowerCase().includes("half") && clock.toLowerCase().includes("time")) {
                    liveMinute = "DA";
                } else if (clock.toLowerCase().includes("1st")) {
                    liveMinute = "1.Y";
                } else if (clock.toLowerCase().includes("2nd")) {
                    liveMinute = "2.Y";
                } else {
                    liveMinute = clock;
                }
            } else {
                // Havuzda maç yoksa nedenini anlamak için log basalım
                if (e.homeTeam.name.includes("Galatasaray")) {
                    console.log(`⚠️ UYARI: GS maçı canlı havuzda bulunamadı! ID: ${e.id}`);
                }
                // Fallback (Senin aldığın "2.Y" burdan geliyor)
                const fallbackDesc = e.status.description || "";
                liveMinute = fallbackDesc.includes("1st") ? "1.Y" : (fallbackDesc.includes("2nd") ? "2.Y" : "İY");
            }
        }

        finalMatchesMap.set(e.id, {
            id: e.id, 
            isElite: ELITE_FOOT_IDS.includes(ut.id), 
            status: status,
            liveMinute: liveMinute,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
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
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches }, null, 2));
}






async function runBasketball(page) {
    console.log("🏀 Basketbol taranıyor...");
    let allEvents = [];
    for (const date of [getTRDate(0), getTRDate(1), getTRDate(2)]) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) allEvents.push(...data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    allEvents.forEach(e => {
        if (finalMatchesMap.has(e.id)) return; 
        const ut = e.tournament.uniqueTournament;
        const status = e.status.type;
        addToSummary("basketball", ut.name);
        
        finalMatchesMap.set(e.id, {
            id: e.id, isElite: true, status,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: baskLeagueConfigs[ut.id] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + ut.id + ".png",
            homeScore: (status === 'inprogress' || status === 'finished') ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: (status === 'inprogress' || status === 'finished') ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    });
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: Array.from(finalMatchesMap.values()) }, null, 2));
}

async function runTennis(page) {
    console.log("🎾 Tenis taranıyor...");
    let rawEvents = [];
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    for (const date of targetDates) {
        try {
            await page.goto(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data?.events) rawEvents.push(...data.events.filter(e => !isGarbage(e.tournament?.name, e.tournament?.category?.name)));
        } catch (e) {}
    }

    const finalMatchesMap = new Map();
    for (const e of rawEvents) {
        if (finalMatchesMap.has(e.id)) continue;
        const isElite = checkIsEliteMatch(e.tournament.name);
        addToSummary("tennis", e.tournament.name);

        finalMatchesMap.set(e.id, {
            id: e.id, isElite, status: e.status.type,
            fixedDate: new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: new Date(e.startTimestamp * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getTennisBroadcaster(e.tournament.name, isElite),
            homeTeam: { name: e.homeTeam.name, logo: TENNIS_LOGO_BASE + "mc.png" },
            awayTeam: { name: e.awayTeam.name, logo: TENNIS_LOGO_BASE + "mc.png" },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || 1) + ".png",
            homeScore: String(e.homeScore?.display ?? "-"),
            awayScore: String(e.awayScore?.display ?? "-"),
            tournament: e.tournament.name
        });
    }
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, matches: Array.from(finalMatchesMap.values()) }, null, 2));
}

async function start(page) {
    try {
        await runFootball(page); await runBasketball(page); await runTennis(page);
        printFullSummary();
    } catch (e) { console.error("Hata:", e); }
}

async function loop() {
    console.log("🟢 iMac CANLI SKOR SUNUCUSU AKTİF");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

    while (true) {
        try {
            await start(page);
            const simdi = new Date().toLocaleTimeString('tr-TR');
            
            const gitCmd = 'git add . && (git commit -m "Canlı Skor Güncellemesi: ' + simdi + '" || echo "Değişiklik yok") && git push origin main --force';
            
            exec(gitCmd, (error) => {
                if (error) console.error(`[${simdi}] ❌ GitHub Hatası: ${error.message}`);
                else console.log(`[${simdi}] ✅ GitHub BAŞARILI!`);
            });
        } catch (e) {}
        await new Promise(r => setTimeout(r, 60000));
    }
}
loop();