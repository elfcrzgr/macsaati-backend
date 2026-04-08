const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const TEAM_FOLDER = "logos"; 
const TOURNAMENT_FOLDER = "tournament_logos"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TEAM_FOLDER}/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TOURNAMENT_FOLDER}/`;
const OUTPUT_FILE = "matches_football.json";

// --- ÜLKE ÇEVİRİ SÖZLÜĞÜ ---
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

// --- AKILLI YAYINCI MANTIĞI ---
const getBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = hName.toLowerCase();
    const an = aName.toLowerCase();
    const tn = tName.toLowerCase();
    const utn = utName.toLowerCase();

    const isTurkey = hn.includes("turkey") || an.includes("turkey") || 
                     hn.includes("türkiye") || an.includes("türkiye");

    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || 
                      utn.includes("play-off") || utn.includes("playoff");

    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    
    if (utId === 11 || utn.includes("world cup qual") || utn.includes("dünya kupası eleme")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }

    const staticConfigs = {
        34: "beIN Sports", 52: "beIN Sports", 238: "S Sport Plus", 
        242: "Apple TV", 938: "S Sport / S Sport Plus", 
        17: "beIN Sports", 8: "S Sport", 23: "S Sport", 7: "TRT / Tabii", 
        11: "TRT 1 / Tabii", 351: "TRT Spor / Tabii", 37: "S Sport Plus / TV+", 
        10: "Exxen / S Sport+", 13: "Spor Smart", 393: "CBC Sport", 
        155: "Spor Smart / Exxen", 10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 
        98: "beIN Sports / TRT Spor", 97: "TFF YouTube", 11417: "TFF YouTube", 
        11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube", 
        696: "DAZN / YouTube", 13363: "USL YouTube", 10783: "S Sport Plus / TRT", 
        232: "S Sport Plus / DAZN", 1: "TRT 1 / Tabii"
    };

    if (staticConfigs[utId]) return staticConfigs[utId];

    if (utn.includes("j1 league")) return "YouTube (J.League Int.)";
    if (utn.includes("baller league")) return "Twitch / YouTube (Global)";
    if (utn.includes("primera a") || utn.includes("primera división")) return "TV Yayını Yok (Yerel)";
    if (utn.includes("mls next pro")) return "Apple TV / OneFootball";

    return "Resmi Yayıncı / Canlı Skor";
};

const ELITE_LEAGUE_IDS = [
    52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1
];

const REGULAR_LEAGUE_IDS = [
    10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618
];

const ALL_TARGET_IDS = [...ELITE_LEAGUE_IDS, ...REGULAR_LEAGUE_IDS];
const stubbornLeagueIds = [11, 351, 10, 97, 750, 13, 393, 52, 238, 242, 938];

async function start() {
    console.log("🚀 MAÇ SAATİ AKILLI MOTOR BAŞLATILDI...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 180); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const validDates = [getTRDate(0), getTRDate(1), getTRDate(2)];
    let allEvents = [];
    
    for (const date of validDates) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament;
                    if (!ut) return false;
                    const utId = ut.id;
                    return ALL_TARGET_IDS.includes(utId) || ut.hasEventPlayerStatistics || ut.priority > 20;
                });
                const correctlyDated = filtered.filter(e => {
                    const dateTR = new Date(e.startTimestamp * 1000);
                    const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                    return validDates.includes(dayStrTR);
                });
                allEvents = allEvents.concat(correctlyDated);
            }
        } catch (e) { }
    }

    for (const id of stubbornLeagueIds) {
        try {
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/seasons`, { waitUntil: 'networkidle2' });
            const seasonsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            if (seasonsData?.seasons?.length > 0) {
                const sId = seasonsData.seasons[0].id;
                for (const type of ['next/0', 'last/0']) {
                    await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${id}/season/${sId}/events/${type}`, { waitUntil: 'networkidle2' });
                    const eventsData = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
                    if (eventsData?.events) {
                        const targetEvents = eventsData.events.filter(e => {
                            const dateTR = new Date(e.startTimestamp * 1000);
                            const dayStrTR = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                            return validDates.includes(dayStrTR);
                        });
                        allEvents = allEvents.concat(targetEvents);
                    }
                }
            }
        } catch (e) { }
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament;
        if (!ut) continue;
        
        const utId = ut.id;
        const utName = ut.name || "";
        const lowerName = utName.toLowerCase();
        const tName = e.tournament.name || "";
        const hName = e.homeTeam.name;
        const aName = e.awayTeam.name;
        const dateTR = new Date(e.startTimestamp * 1000);
        const matchKey = `${hName}_${aName}_${utId}`;
        
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';
        const isCanceled = statusType === 'canceled' || statusType === 'postponed';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (isInProgress) {
            timeString = `${timeString}\nCANLI`; 
        } else if (isCanceled) {
            timeString = `İPTAL`;
        }

        const isExcludedCategory = lowerName.includes("u19") || lowerName.includes("u21") || lowerName.includes("women");

        const matchObj = {
            id: e.id,
            isElite: ELITE_LEAGUE_IDS.includes(utId) && !isExcludedCategory, 
            status: statusType, // <--- iOS İÇİN EKLENEN ORTAK FORMAT
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString, 
            timestamp: e.startTimestamp * 1000,
            broadcaster: getBroadcaster(utId, hName, aName, tName, utName), 
            homeTeam: { 
                name: translateTeam(hName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: translateTeam(aName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-",
            tournament: utName
        };
        finalMatchesMap.set(matchKey, matchObj);
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`✅ İŞLEM TAMAMLANDI: Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();
