const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// =========================================================================
// ⚙️ GLOBAL AYARLAR VE ÖZET RAPORU FONKSİYONLARI
// =========================================================================
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const getTRDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// 📊 DETAYLI LOG (ÖZET RAPORU) YÖNETİMİ
let globalSummary = {};
function addToSummary(sport, leagueName) {
    if (!globalSummary[sport]) globalSummary[sport] = {};
    const name = leagueName || "Bilinmeyen";
    globalSummary[sport][name] = (globalSummary[sport][name] || 0) + 1;
}

function printSportSummary(sport) {
    console.log(`\n📊 ${sport.toUpperCase()} ÖZET RAPORU`);
    console.log("-----------------------------------------");
    let total = 0;
    const sorted = Object.entries(globalSummary[sport] || {}).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([l, c]) => { 
        console.log(`📍 ${l}: ${c} maç`); 
        total += c; 
    });
    console.log(`✅ Toplam ${total} maç kaydedildi.`);
    console.log("-----------------------------------------\n");
}

function resetSummary() {
    globalSummary = {};
}

// =========================================================================
// 🛡️ BOT KORUMASINI AŞAN VE DETAYLI LOG TUTAN FETCH YARDIMCISI
// =========================================================================
async function fetchJsonSafely(page, url, sportName = "genel") {
    console.log(`\n[DEBUG - ${sportName.toUpperCase()}] 🌐 İstek atılıyor: ${url}`);
    
    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = response.status();
        console.log(`[DEBUG - ${sportName.toUpperCase()}] 📡 HTTP Status: ${status}`);

        // Eğer doğrudan Cloudflare veya Rate Limit engeli yediysek:
        if (status === 403 || status === 429) {
            console.log(`[HATA] 🚨 ${sportName} için erişim ENGELLENDİ! (Status: ${status})`);
            const html = await page.content();
            const fileName = `hata_${sportName}_${status}.html`;
            fs.writeFileSync(fileName, html);
            console.log(`[İPUCU] 📄 Hata anındaki sayfa kaydedildi: ${fileName}. Ne gördüğünü anlamak için bu dosyayı tarayıcıda açın!`);
            return null;
        }

        const data = await page.evaluate(() => {
            try {
                const preNode = document.querySelector("pre");
                if (preNode) return { success: true, json: JSON.parse(preNode.innerText) };
                
                return { success: true, json: JSON.parse(document.body.innerText) };
            } catch(e) { 
                return { 
                    success: false, 
                    rawText: document.body.innerText.substring(0, 300) 
                }; 
            }
        });

        // Her istekten sonra insani bir bekleme (2-3 saniye arası)
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

        if (!data.success) {
            console.log(`[HATA] ❌ JSON ayrıştırılamadı! Muhtemelen Captcha'ya takıldık.`);
            console.log(`[GELEN VERİ ÖZETİ] 👇\n${data.rawText.trim()}...\n`);
            
            const html = await page.content();
            fs.writeFileSync(`hata_${sportName}_json_parse.html`, html);
            return null;
        }

        return data.json;
    } catch (e) {
        console.log(`[HATA] ⚠️ Tarayıcı Bağlantı Hatası: ${e.message}`);
        return null;
    }
}

// =========================================================================
// ⚽ FUTBOL AYARLARI
// =========================================================================
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;

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
    "usa": "ABD", "mexico": "Meksika", "brazil": "Brezilya", "argentina": "Arjantin"
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

const getFootBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = hName.toLowerCase();
    const an = aName.toLowerCase();
    const tn = tName.toLowerCase();
    const utn = utName.toLowerCase();

    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || utn.includes("play-off") || utn.includes("playoff");

    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    if (utId === 11 || utn.includes("world cup qual") || utn.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    const staticConfigs = {
        34: "beIN Sports", 52: "S Sport / Tivibu", 238: "S Sport", 242: "Apple TV", 938: "S Sport / S Sport Plus", 
        17: "beIN Sports", 8: "S Sport Plus", 23: "S Sport / Tivibu", 7: "TRT / Tabii", 11: "TRT 1 / Tabii", 351: "TRT Spor / Tabii", 
        37: "S Sport Plus / Tivibu Spor", 10: "Exxen / S Sport+", 13: "Spor Smart", 393: "CBC Sport", 155: "Spor Smart / Exxen", 
        10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 97: "TFF YouTube", 11417: "TFF YouTube", 
        11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube", 696: "DAZN / YouTube", 13363: "USL YouTube", 
        10783: "S Sport Plus / TRT", 232: "S Sport Plus / DAZN", 1: "TRT 1 / Tabii", 19: "TRT 1 / Tabii", 18: "Exxen"
    };

    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    return "Resmi Yayıncı / Canlı Skor";
};

const ELITE_FOOT_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015, 19, 18];
const REGULAR_FOOT_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618];
const ALL_FOOT_TARGETS = [...ELITE_FOOT_IDS, ...REGULAR_FOOT_IDS];

// =========================================================================
// 🏀 BASKETBOL AYARLARI
// =========================================================================
const BASK_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/`;
const ELITE_BASK_IDS = [3547, 138, 142, 137, 132, 167, 168];

const baskLeagueConfigs = {
    3547: "S Sport / NBA TV", 138: "S Sport / S Sport Plus", 142: "S Sport Plus", 
    137: "TRT Spor / Tabii", 132: "beIN Sports 5", 167: "S Sport Plus / FIBA TV", 
    168: "TRT Spor Yıldız", 9357: "S Sport Plus", 139: "beIN Sports / TRT Spor", 
    11511: "TRT Spor Yıldız / TBF TV", 21511: "TBF TV (YouTube)", 251: "S Sport Plus", 
    215: "S Sport Plus", 304: "S Sport Plus", 227: "beIN Sports", 164: "beIN Sports",
    235: "S Sport Plus", 405: "beIN Sports"
};
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

const ELITE_TENNIS_KEYWORDS = [
    "WIMBLEDON", "US OPEN", "AUSTRALIAN OPEN", "ROLAND GARROS", "FRENCH OPEN", "OLYMPIC",
    "ATP FINALS", "WTA FINALS", "MONTE CARLO", "INDIAN WELLS", "MIAMI", "MADRID", "ROME", 
    "CINCINNATI", "MONTREAL", "TORONTO", "CANADIAN OPEN", "SHANGHAI", "PARIS", "MASTERS",
    "ATP 1000", "WTA 1000", "ATP 500", "WTA 500"
];

const checkIsEliteMatch = (tournamentName) => {
    if (!tournamentName) return false;
    const nameUpper = tournamentName.toUpperCase();
    if (nameUpper.includes("QUALIFYING") || nameUpper.includes("QUALIFIERS")) return false;
    return ELITE_TENNIS_KEYWORDS.some(keyword => nameUpper.includes(keyword));
};

const getTennisBroadcaster = (tourName) => {
    const name = (tourName || "").toUpperCase();
    if (name.includes("WIMBLEDON")) return "TRT Spor / S Sport";
    if (name.includes("US OPEN") || name.includes("AUSTRALIAN OPEN") || name.includes("ROLAND GARROS") || name.includes("FRENCH OPEN")) return "Eurosport";
    return "beIN Sports / S Sport"; 
};

// =========================================================================
// 🏎️ F1 AYARLARI
// =========================================================================
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;

// =========================================================================
// 🚀 GÖREV MOTORLARI
// =========================================================================

async function runFootball(page) {
    console.log("\n⚽ Futbol motoru taranıyor...");
    let allEvents = [];
    const validDates = [getTRDate(0), getTRDate(1), getTRDate(2)];

    // 1. ADIM: Günlük Listeyi Çek
    for (const date of validDates) {
        const apiUrl = `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;
        const data = await fetchJsonSafely(page, apiUrl, "football");

        if (data && data.events) {
            const filtered = data.events.filter(e => {
                const ut = e.tournament?.uniqueTournament;
                if (!ut) return false;
                return ALL_FOOT_TARGETS.includes(ut.id) || ut.hasEventPlayerStatistics || ut.priority > 20;
            });
            allEvents = allEvents.concat(filtered);
        }
    }

    // 2. ADIM: Canlı Maçlar İçin Detaylı Dakika Hesaplama
    const liveMinutesPool = new Map();
    const liveMatches = allEvents.filter(e => e.status?.type === 'inprogress');
    
    for (const match of liveMatches) {
        const detailUrl = `https://www.sofascore.com/api/v1/event/${match.id}`;
        const detailData = await fetchJsonSafely(page, detailUrl, "football_detail");
        
        if (detailData && detailData.event && detailData.event.time?.currentPeriodStartTimestamp) {
            const detail = detailData.event;
            const status = detail.status;
            const time = detail.time;
            const now = Math.floor(Date.now() / 1000);
            const elapsed = now - time.currentPeriodStartTimestamp;
            const calcMinute = Math.floor(elapsed / 60);
            
            let minuteResult = "";
            if (status?.code === 31) minuteResult = "DA";
            else if (status?.code === 7) minuteResult = String(45 + calcMinute);
            else minuteResult = String(calcMinute);

            liveMinutesPool.set(match.id, minuteResult);
        } else {
            liveMinutesPool.set(match.id, "Canlı");
        }
    }

    // 3. ADIM: Final Listesi
    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament;
        if (!ut) continue;
        
        const utId = ut.id;
        const utName = ut.name || "";
        const lowerName = utName.toLowerCase();
        const dateTR = new Date(e.startTimestamp * 1000);
        
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';
        const isCanceled = statusType === 'canceled' || statusType === 'postponed';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        let liveMinute = "";
        if (isInProgress) {
            liveMinute = liveMinutesPool.get(e.id) || "İY";
            timeString += ` CANLI (${liveMinute}')`; 
        } else if (isCanceled) {
            timeString = "İPTAL";
        }

        const isExcludedCategory = lowerName.includes("u19") || lowerName.includes("u21") || lowerName.includes("women");
        const hasScore = isFinished || isInProgress; 

        if (ELITE_FOOT_IDS.includes(utId) && !isExcludedCategory) addToSummary("football", utName);
        else if (ALL_FOOT_TARGETS.includes(utId)) addToSummary("football", utName);

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: ELITE_FOOT_IDS.includes(utId) && !isExcludedCategory, 
            status: statusType, 
            liveMinute: liveMinute,
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString, 
            timestamp: e.startTimestamp * 1000,
            broadcaster: getFootBroadcaster(utId, e.homeTeam.name, e.awayTeam.name, e.tournament.name || "", utName), 
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: utName
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_football.json", JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));
    
    printSportSummary("football");
}

async function runBasketball(page) {
    console.log("\n🏀 Basketbol motoru taranıyor...");
    let allEvents = [];
    
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        const apiUrl = `https://www.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`;
        const data = await fetchJsonSafely(page, apiUrl, "basketball");

        if (data && data.events) {
            allEvents = allEvents.concat(data.events.filter(e => targetBaskIds.includes(e.tournament?.uniqueTournament?.id)));
        }
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        if (finalMatchesMap.has(e.id)) continue;
        const utId = e.tournament?.uniqueTournament?.id;
        const utName = e.tournament?.uniqueTournament?.name || "";
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        const isNBA = (utId === 3547 || utName.toUpperCase() === "NBA");
        const statusType = e.status?.type; 
        
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI"; 
        else if (statusType === 'canceled' || statusType === 'postponed') timeString = `İPTAL`;

        const hasScore = statusType === 'finished' || statusType === 'inprogress';
        addToSummary("basketball", isNBA ? "NBA" : utName);

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: ELITE_BASK_IDS.includes(utId), 
            status: statusType, 
            fixedDate: dayStr,
            fixedTime: timeString, 
            timestamp: dateTR.getTime(),
            broadcaster: baskLeagueConfigs[utId] || "Resmi Yayıncı", 
            homeTeam: { name: e.homeTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: BASK_BASE_URL + "logos/" + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" },
            tournamentLogo: BASK_BASE_URL + "tournament_logos/" + (isNBA ? "3547" : utId) + ".png",
            homeScore: hasScore ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: hasScore ? String(e.awayScore?.display ?? "0") : "-",
            tournament: isNBA ? "NBA" : utName
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_basketball.json", JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    printSportSummary("basketball");
}

async function runTennis(page) {
    console.log("\n🎾 Tenis motoru taranıyor...");
    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let rawEvents = [];
    const stubbornTournamentIds = new Set([2391]); 

    for (const date of targetDates) {
        const apiUrl = `https://www.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`;
        const data = await fetchJsonSafely(page, apiUrl, "tennis");
        
        if (data && data.events) {
            const filtered = data.events.filter(e => {
                const tourName = e.tournament?.name;
                const catName = e.tournament?.category?.name;
                if (isGarbage(tourName, catName)) return false;
                if (checkIsEliteMatch(tourName) && e.tournament?.uniqueTournament?.id) {
                    stubbornTournamentIds.add(e.tournament.uniqueTournament.id);
                }
                return true;
            });
            rawEvents.push(...filtered);
        }
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

        const detailUrl = `https://www.sofascore.com/api/v1/event/${e.id}`;
        const evData = await fetchJsonSafely(page, detailUrl, "tennis_detail");

        if (evData && evData.event) {
            const eventData = evData.event;
            const getCodes = (team) => {
                if (team.subTeams && team.subTeams.length > 0) {
                    return team.subTeams.map(p => p.country?.alpha2?.toLowerCase()).filter(Boolean);
                }
                return [team.country?.alpha2?.toLowerCase() || "mc"];
            };
            
            homeLogos = getCodes(eventData.homeTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            awayLogos = getCodes(eventData.awayTeam).map(c => `${TENNIS_LOGO_BASE}${c}.png`);
            homeRank = eventData.homeTeam.ranking ? String(eventData.homeTeam.ranking) : null;
            awayRank = eventData.awayTeam.ranking ? String(eventData.awayTeam.ranking) : null;
        }

        if (homeLogos.length === 0) homeLogos = [TENNIS_LOGO_BASE + "mc.png"];
        if (awayLogos.length === 0) awayLogos = [TENNIS_LOGO_BASE + "mc.png"];

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        const hasScore = statusType === 'inprogress' || statusType === 'finished';
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        let setScoresStr = "";
        if (e.homeScore && e.awayScore) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hSet = e.homeScore[`period${i}`];
                let aSet = e.awayScore[`period${i}`];
                if (hSet !== undefined && aSet !== undefined) sets.push(`${hSet}-${aSet}`);
            }
            setScoresStr = sets.join(", "); 
        }

        addToSummary("tennis", tourName);

        finalMatchesMap.set(e.id, {
            id: e.id,
            isElite: checkIsEliteMatch(tourName),
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: getTennisBroadcaster(tourName),
            homeTeam: { name: e.homeTeam.name || "Belli Değil", logos: homeLogos },
            awayTeam: { name: e.awayTeam.name || "Belli Değil", logos: awayLogos },
            homeRank: homeRank,
            awayRank: awayRank,
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || e.tournament?.category?.id) + ".png",
            homeScore: !hasScore ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: !hasScore ? "-" : String(e.awayScore?.display ?? "0"),
            setScores: setScoresStr,
            tournament: tourName
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync("matches_tennis.json", JSON.stringify({ 
        success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches 
    }, null, 2));

    printSportSummary("tennis");
}

async function runF1() {
    console.log("\n🏎️ F1 motoru başlatılıyor...");
    const statsFilePath = path.join(__dirname, 'f1_stats.json');
    let circuitStats = {};
    try {
        circuitStats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    } catch (err) {
        console.log("⚠️ f1_stats.json bulunamadı, varsayılanlar kullanılacak.");
    }

    try {
        const response = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
        if (!response.ok) throw new Error("API hatası: " + response.status);
        
        const data = await response.json();
        const races = data.MRData.RaceTable.Races;
        const finalEvents = [];

        const countryToCode = {
            "Bahrain": "bh", "Saudi Arabia": "sa", "Australia": "au", "Japan": "jp",
            "China": "cn", "USA": "us", "United States": "us", "Italy": "it", 
            "Monaco": "mc", "Canada": "ca", "Spain": "es", "Austria": "at", 
            "UK": "gb", "Hungary": "hu", "Belgium": "be", "Netherlands": "nl", 
            "Azerbaijan": "az", "Singapore": "sg", "Mexico": "mx", "Brazil": "br", 
            "Qatar": "qa", "UAE": "ae"
        };

        races.forEach(race => {
            const circuitId = race.Circuit.circuitId;
            const countryName = race.Circuit.Location.country;
            
            let flagCode = countryToCode[countryName] || countryName.toLowerCase().substring(0, 2);
            if (countryName.toLowerCase().includes("usa")) flagCode = "us";
            
            const stats = circuitStats[circuitId] || circuitStats["default"] || {};

            const addSession = (sessionName, dateStr, timeStr) => {
                if (!dateStr || !timeStr) return;
                const dateObj = new Date(`${dateStr}T${timeStr}`);
                const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
                const dayAndMonth = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

                finalEvents.push({
                    id: `${race.round}_${sessionName.replace(/\s/g, '')}`,
                    fixedDate: `${dayAndMonth} ${dayName}`,
                    fixedTime: dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    timestamp: dateObj.getTime(),
                    broadcaster: "beIN Sports / F1 TV",
                    grandPrix: race.raceName,
                    sessionName: sessionName,
                    trackName: race.Circuit.circuitName,
                    countryLogo: F1_LOGO_BASE + flagCode + ".png", 
                    tournamentLogo: F1_TOURNAMENT_BASE + circuitId + ".png",
                    circuitStats: stats 
                });
            };

            if (race.FirstPractice) addSession("1. Antrenman", race.FirstPractice.date, race.FirstPractice.time);
            if (race.SecondPractice) addSession("2. Antrenman", race.SecondPractice.date, race.SecondPractice.time);
            if (race.ThirdPractice) addSession("3. Antrenman", race.ThirdPractice.date, race.ThirdPractice.time);
            if (race.Qualifying) addSession("Sıralama", race.Qualifying.date, race.Qualifying.time);
            if (race.Sprint) addSession("Sprint", race.Sprint.date, race.Sprint.time);
            addSession("Yarış", race.date, race.time);
        });

        finalEvents.sort((a, b) => a.timestamp - b.timestamp);

        fs.writeFileSync(path.join(__dirname, "matches_f1.json"), JSON.stringify({ 
            success: true, lastUpdated: new Date().toISOString(), totalSessions: finalEvents.length, events: finalEvents 
        }, null, 2));

        console.log(`✅ F1 Tamamlandı: ${finalEvents.length} seans kaydedildi.`);
    } catch (e) { console.error("❌ F1 HATA OLUŞTU:", e.message); }
}

// =========================================================================
// 🚀 ORKESTRATÖR VE DÖNGÜ (Git Push Dahil)
// =========================================================================

async function scrapeAll(page) {
    resetSummary(); 
    try {
        await runFootball(page);
        await runBasketball(page);
        await runTennis(page);
        await runF1();
    } catch (e) {
        console.error("❌ KAZIMA HATASI:", e);
    }
}

async function loop() {
    console.log("🟢 Maç Saati MASTER SUNUCUSU BAŞLATILDI");
    
    // GÜVENLİ BROWSER ARGÜMANLARI
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-blink-features=AutomationControlled',
            '--lang=tr-TR,tr',
            '--window-size=1920,1080'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    // İlk gidişte cookie'lerin (çerezlerin) oluşması için ana sayfaya bir ping atalım
    await page.goto('https://www.sofascore.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>console.log("Ana sayfa pinglemesi tamamlandı."));
    await new Promise(r => setTimeout(r, 3000));

    while (true) {
        try {
            await scrapeAll(page);
            const simdi = new Date().toLocaleTimeString('tr-TR');
            
            // GitHub Push İşlemi
            const gitCmd = 'git add . && (git commit -m "Canlı Skor Güncellemesi: ' + simdi + '" || echo "Değişiklik yok") && git push origin main --force';
            exec(gitCmd, (error) => {
                if (error) console.error(`[${simdi}] ❌ GitHub Hatası: ${error.message}`);
                else console.log(`[${simdi}] ✅ GitHub Push BAŞARILI! Beklemeye geçiliyor...`);
            });
            
        } catch (e) {
            console.error("Döngü içerisinde hata:", e);
        }
        
        // Sunucuyu yormamak için her döngü sonrası 30 saniye bekle
        await new Promise(r => setTimeout(r, 30000));
    }
}

// Sistemi Başlat
loop().catch(e => {
    console.error("KRİTİK HATA:", e);
    process.exit(1);
});