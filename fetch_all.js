const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

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

// Loglama İçin Özet Tablosu
const globalSummary = {};

function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    globalSummary[sport][leagueName] = (globalSummary[sport][leagueName] || 0) + 1;
}

function printSportSummary(sport) {
    console.log(`\n📊 ${sport.toUpperCase()} ÖZETİ`);
    console.log("-----------------------------------------");
    let total = 0;
    const sortedLeagues = Object.entries(globalSummary[sport] || {}).sort((a, b) => b[1] - a[1]);
    sortedLeagues.forEach(([league, count]) => {
        console.log(`📍 ${league}: ${count} maç`);
        total += count;
    });
    console.log(`✅ Toplam: ${total} maç kaydedildi.`);
    console.log("-----------------------------------------\n");
}

// =========================================================================
// ⚽ FUTBOL YARDIMCILARI
// =========================================================================
const FOOT_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOT_TOUR_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

const teamTranslations = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya", "croatia": "Hırvatistan",
    "denmark": "Danimarka", "scotland": "İskoçya", "hungary": "Macaristan", "serbia": "Sırbistan",
    "poland": "Polonya", "czechia": "Çekya", "romania": "Romanya", "slovakia": "Slovakya",
    "slovenia": "Slovenya", "georgia": "Gürcistan", "albania": "Arnavutluk", "norway": "Norveç",
    "sweden": "İsveç", "ukraine": "Ukrayna", "greece": "Yunanistan", "wales": "Galler",
    "finland": "Finlandiya", "ireland": "İrlanda", "northernireland": "Kuzey İrlanda",
    "iceland": "İzlanda", "israel": "İsrail", "bulgaria": "Bulgaristan", "kazakhstan": "Kazakistan",
    "azerbaijan": "Azerbaycan", "armenia": "Ermenistan", "kosovo": "Kosova", "montenegro": "Karadağ",
    "estonia": "Estonya", "latvia": "Letonya", "lithuania": "Litvanya", "belarus": "Belarus",
    "moldova": "Moldova", "luxembourg": "Lüksemburg", "faroeislands": "Faroe Adaları",
    "malta": "Malta", "andorra": "Andorra", "sanmarino": "San Marino", "gibraltar": "Cebelitarık",
    "liechtenstein": "Liechtenstein", "northmacedonia": "K. Makedonya", "cyprus": "Güney Kıbrıs",
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya",
    "chile": "Şili", "peru": "Peru", "ecuador": "Ekvador", "paraguay": "Paraguay",
    "venezuela": "Venezuela", "bolivia": "Bolivya", "usa": "ABD", "mexico": "Meksika", 
    "canada": "Kanada", "japan": "Japonya", "southkorea": "Güney Kore", "australia": "Avustralya"
};

const translateTeam = (name) => {
    if (!name) return name;
    let translatedName = name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) {
            translatedName = name.replace(new RegExp(eng, 'i'), tr);
            if (cleanSearch === eng) return tr;
            return translatedName;
        }
    }
    return name;
};

const getFootballBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = hName.toLowerCase(); const an = aName.toLowerCase();
    const tn = tName.toLowerCase(); const utn = utName.toLowerCase();
    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || utn.includes("play-off") || utn.includes("playoff");
    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    if (utId === 11 || utn.includes("world cup qual") || utn.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }
    const staticConfigs = {
        34: "beIN Sports", 52: "beIN Sports", 238: "S Sport Plus", 242: "Apple TV", 
        938: "S Sport / S Sport Plus", 17: "beIN Sports", 8: "S Sport", 23: "S Sport", 
        7: "TRT / Tabii", 11: "TRT 1 / Tabii", 351: "TRT Spor / Tabii", 37: "S Sport Plus / TV+", 
        10: "Exxen / S Sport+", 13: "Spor Smart", 393: "CBC Sport", 155: "Spor Smart / Exxen", 
        10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 
        97: "TFF YouTube", 1: "TRT 1 / Tabii"
    };
    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

const FOOT_ELITE_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015];
const FOOT_REGULAR_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const FOOT_STUBBORN_IDS = [11, 351, 10, 97, 750, 13, 393, 52, 238, 242, 938];

// =========================================================================
// 🏀 BASKETBOL YARDIMCILARI
// =========================================================================
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const BASK_ELITE_IDS = [3547, 138, 142, 137, 132, 167, 168];
const baskConfigs = {
    3547: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 142: "S Sport Plus", 
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus / FIBA TV", 
    168: "TRT Spor Yıldız", 9357: "S Sport Plus", 139: "beIN Sports / TRT Spor", 
    11511: "TRT Spor Yıldız / TBF TV", 21511: "TBF TV (YouTube)", 251: "S Sport Plus", 
    215: "S Sport Plus", 304: "S Sport Plus", 227: "beIN Sports", 164: "beIN Sports", 
    235: "S Sport Plus", 405: "beIN Sports"
};
const targetBaskLeagueIds = Object.keys(baskConfigs).map(Number);

// =========================================================================
// 🎾 TENİS YARDIMCILARI
// =========================================================================
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOUR_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

const isTennisGarbage = (tourName, catName) => {
    const t = (tourName || "").toUpperCase(); const c = (catName || "").toUpperCase();
    return t.includes("ITF") || t.includes("CHALLENGER") || t.includes("UTR") ||
           c.includes("ITF") || c.includes("CHALLENGER") || c.includes("UTR");
};

const TENNIS_ELITE_KEYWORDS = [
    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC",
    "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME",
    "CINCINNATI", "MONTREAL", "TORONTO", "SHANGHAI", "PARIS", "MASTERS", "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"
];

const checkIsTennisElite = (name) => {
    if (!name) return false;
    const n = name.toUpperCase();
    if (n.includes("QUALIFYING") || n.includes("QUALIFIERS")) return false;
    return TENNIS_ELITE_KEYWORDS.some(k => n.includes(k));
};

// =========================================================================
// 🏎️ F1 YARDIMCILARI
// =========================================================================
const F1_TOUR_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const f1CountryToCode = {
    "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
    "China": "cn", "USA": "us", "United States": "us", "Italy": "it", 
    "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at", 
    "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl", 
    "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br", 
    "Qatar": "qa", "UAE": "ae"
};

// =========================================================================
// 🚀 ANA MOTOR (START)
// =========================================================================
async function start() {
    console.log("🚀 MAÇ SAATİ ULTRA BİRLEŞİK MOTOR BAŞLATILDI (2026)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log("🛡️ Güvenlik duvarı aşılıyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 6000));

        // 1. FUTBOL
        await processFootball(page);

        // 2. BASKETBOL
        await processBasketball(page);

        // 3. TENİS
        await processTennis(page);

        // 4. F1 (Puppeteer gerektirmez ama akışa dahil)
        await processF1();

        console.log("\n✨ TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI! ✨");

    } catch (e) {
        console.error("❌ KRİTİK HATA:", e.message);
    } finally {
        await browser.close();
    }
}

// ⚽ FUTBOL SÜRECİ
async function processFootball(page) {
    console.log("\n⚽ Futbol verileri işleniyor...");
    const dates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let allEvents = [];
    const allTargetIds = [...FOOT_ELITE_IDS, ...FOOT_REGULAR_IDS];

    for (const date of dates) {
        const data = await page.evaluate(async (d) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${d}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, date);

        if (data?.events) {
            const filtered = data.events.filter(e => {
                const ut = e.tournament?.uniqueTournament;
                if (!ut) return false;
                return allTargetIds.includes(ut.id) || ut.hasEventPlayerStatistics || ut.priority > 20;
            });
            allEvents.push(...filtered);
        }
    }

    // İnatçı Ligler (Stubborn)
    for (const id of FOOT_STUBBORN_IDS) {
        const eventsData = await page.evaluate(async (lid) => {
            try {
                const sRes = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${lid}/seasons`);
                const sData = await sRes.json();
                if (!sData?.seasons?.length) return null;
                const sid = sData.seasons[0].id;
                const eRes = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${lid}/season/${sid}/events/next/0`);
                return await eRes.json();
            } catch { return null; }
        }, id);
        if (eventsData?.events) allEvents.push(...eventsData.events);
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament;
        if (!ut) continue;
        const hName = e.homeTeam.name; const aName = e.awayTeam.name;
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!dates.includes(dayStr)) continue;

        const matchKey = `${hName}_${aName}_${ut.id}`;
        const statusType = e.status?.type;
        const hasScore = (statusType === 'finished' || statusType === 'inprogress');

        finalMatchesMap.set(matchKey, {
            id: e.id,
            isElite: FOOT_ELITE_IDS.includes(ut.id) && !ut.name.toLowerCase().includes("women"),
            status: statusType,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) + (statusType === 'inprogress' ? "\nCANLI" : ""),
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootballBroadcaster(ut.id, hName, aName, e.tournament.name, ut.name),
            homeTeam: { name: translateTeam(hName), logo: FOOT_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(aName), logo: FOOT_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOT_TOUR_LOGO_BASE + ut.id + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
        addToSummary("football", ut.name);
    }

    const results = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_football.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: results.length, matches: results }, null, 2));
    printSportSummary("football");
}

// 🏀 BASKETBOL SÜRECİ
async function processBasketball(page) {
    console.log("🏀 Basketbol verileri işleniyor...");
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];
    let allEvents = [];

    for (const date of dates) {
        const data = await page.evaluate(async (d) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${d}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, date);
        if (data?.events) {
            allEvents.push(...data.events.filter(e => targetBaskLeagueIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();
    const today = getTRDate(0); const tomorrow = getTRDate(1);

    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament;
        const utId = ut?.id; const utName = ut?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (dayStr !== today && dayStr !== tomorrow) continue;

        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        const statusType = e.status?.type;
        const hasScore = (statusType === 'finished' || statusType === 'inprogress');

        finalMatches.push({
            id: e.id,
            isElite: BASK_ELITE_IDS.includes(utId),
            status: statusType,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) + (statusType === 'inprogress' ? "\nCANLI" : ""),
            timestamp: dateTR.getTime(),
            broadcaster: baskConfigs[utId] || "Resmi Yayıncı",
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + (isNBA ? "NBA/3547" : utId) + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : utName
        });
        duplicateTracker.add(matchKey);
        addToSummary("basketball", isNBA ? "NBA" : utName);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches }, null, 2));
    printSportSummary("basketball");
}

// 🎾 TENİS SÜRECİ
async function processTennis(page) {
    console.log("🎾 Tenis verileri işleniyor...");
    const dates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let rawEvents = [];
    const stubbornIds = new Set([2391]);

    for (const date of dates) {
        const data = await page.evaluate(async (d) => {
            try {
                const res = await fetch(`https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${d}`);
                return res.ok ? await res.json() : null;
            } catch { return null; }
        }, date);
        if (data?.events) {
            rawEvents.push(...data.events.filter(e => {
                if (isTennisGarbage(e.tournament?.name, e.tournament?.category?.name)) return false;
                if (checkIsTennisElite(e.tournament?.name) && e.tournament?.uniqueTournament?.id) stubbornIds.add(e.tournament.uniqueTournament.id);
                return true;
            }));
        }
    }

    // Derin Tarama
    for (const tid of stubbornIds) {
        const eData = await page.evaluate(async (id) => {
            try {
                const sR = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${id}/seasons`);
                const sD = await sR.json();
                if (!sD?.seasons?.[0]?.id) return null;
                const sid = sD.seasons[0].id;
                const eR = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${id}/season/${sid}/events/next/0`);
                return await eR.json();
            } catch { return null; }
        }, tid);
        if (eData?.events) rawEvents.push(...eData.events);
    }

    const finalMatchesMap = new Map();
    for (const e of rawEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        if (!dates.includes(dayStr) || isTennisGarbage(e.tournament?.name, e.tournament?.category?.name)) continue;

        const statusType = e.status?.type;
        const hasScore = (statusType === 'inprogress' || statusType === 'finished');
        
        // Detay Fetch (Ranking & Flags)
        const detail = await page.evaluate(async (id) => {
            try {
                const r = await fetch(`https://www.sofascore.com/api/v1/event/${id}`);
                const ev = await r.json();
                const getC = (t) => t.subTeams?.length ? t.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean) : [t.country?.alpha2?.toLowerCase() || "mc"];
                return { hC: getC(ev.event.homeTeam), aC: getC(ev.event.awayTeam), hR: ev.event.homeTeam.ranking, aR: ev.event.awayTeam.ranking };
            } catch { return null; }
        }, e.id);

        let sets = [];
        if (e.homeScore && e.awayScore) {
            for (let i = 1; i <= 5; i++) {
                let hSet = e.homeScore[`period${i}`]; let aSet = e.awayScore[`period${i}`];
                if (hSet !== undefined && aSet !== undefined) sets.push(`${hSet}-${aSet}`);
            }
        }

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsTennisElite(e.tournament?.name),
            status: statusType,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) + (statusType === 'inprogress' ? "\nCANLI" : (statusType === 'finished' ? "\nMS" : "")),
            timestamp: e.startTimestamp * 1000,
            broadcaster: "S Sport / beIN Sports",
            homeTeam: { name: e.homeTeam.name, logos: detail?.hC.map(c => TENNIS_LOGO_BASE + c + ".png") || [TENNIS_LOGO_BASE + "mc.png"] },
            awayTeam: { name: e.awayTeam.name, logos: detail?.aC.map(c => TENNIS_LOGO_BASE + c + ".png") || [TENNIS_LOGO_BASE + "mc.png"] },
            homeRank: detail?.hR ? String(detail.hR) : null,
            awayRank: detail?.aR ? String(detail.aR) : null,
            tournamentLogo: TENNIS_TOUR_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            setScores: sets.join(", "),
            tournament: e.tournament.name
        });
        addToSummary("tennis", e.tournament.name);
    }

    const results = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: results.length, matches: results }, null, 2));
    printSportSummary("tennis");
}

// 🏎️ F1 SÜRECİ
async function processF1() {
    console.log("🏎️ F1 verileri işleniyor...");
    try {
        const statsFilePath = path.join(__dirname, 'f1_stats.json');
        let circuitStats = {};
        try { circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8')); } catch { console.log("⚠️ f1_stats.json bulunamadı."); }

        const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        const data = await res.json();
        const races = data.MRData.RaceTable.Races;
        const finalEvents = [];

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const country = race.Circuit.Location.country;
            let fCode = f1CountryToCode[country] || country.toLowerCase().substring(0, 2);
            if (country.toLowerCase().includes("usa")) fCode = "us";
            const stats = circuitStats[circuitId] || circuitStats["default"] || {};

            const addS = (sName, dS, tS) => {
                if (!dS || !tS) return;
                const dObj = new Date(`${dS}T${tS}`);
                finalEvents.push({
                    id: `${race.round}_${sName.replace(/\s/g, '')}`,
                    fixedDate: dObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }),
                    fixedTime: dObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sName,
                    trackName: race.Circuit.circuitName,
                    countryLogo: F1_LOGO_BASE + fCode + ".png",
                    tournamentLogo: F1_TOUR_BASE + (circuitId === "red_bull_ring" ? "red_bull_ring" : circuitId) + ".png",
                    circuitStats: stats
                });
            };

            if (race.FirstPractice) addS("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addS("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addS("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addS("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addS("Sprint", race.Sprint.date, race.Sprint.time);
            addS("Yarış", race.date, race.time);
            addToSummary("f1", "Formula 1");
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);
        fs.writeFileSync("matches_f1.json", JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents }, null, 2));
        printSportSummary("f1");
    } catch (e) { console.error("❌ F1 Hatası:", e.message); }
}

start();