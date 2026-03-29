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

// --- DEV ÜLKE ÇEVİRİ SÖZLÜĞÜ ---
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
    "venezuela": "Venezuela", "bolivia": "Bolivya", "usa": "ABD", "mexico": "Meksika"
};

const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) {
            return name.replace(new RegExp(eng, 'i'), tr);
        }
    }
    return name;
};

// --- AKILLI YAYINCI MANTIĞI ---
const getBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = hName.toLowerCase(), an = aName.toLowerCase(), tn = tName.toLowerCase(), utn = utName.toLowerCase();
    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");
    const isPlayoff = tn.includes("play-off") || tn.includes("playoff") || utn.includes("play-off") || utn.includes("playoff");

    if (utId === 748 || utId === 750) return isTurkey ? "TRT Spor / Tabii" : "Exxen";
    if (utId === 704 || utn.includes("world cup qual")) {
        if (isTurkey) return isPlayoff ? "TV8" : "TRT 1 / Tabii";
        return isPlayoff ? "Exxen" : "S Sport Plus";
    }
    if (utId === 13) return "Spor Smart";
    if (utId === 393) return "CBC Sport";

    const staticConfigs = {
        155: "Spor Smart / Exxen", 54: "S Sport Plus / TV+", 10: "Exxen / S Sport+", 10618: "Exxen / FIFA+",
        351: "TRT Spor / Tabii", 4664: "S Sport+ / TV+", 11: "TRT 1 / Tabii", 52: "beIN Sports",
        98: "beIN Sports / TRT Spor", 97: "TFF YouTube", 11417: "TFF YouTube", 11416: "TFF YouTube",
        11415: "TFF YouTube", 15938: "TFF YouTube", 17: "beIN Sports", 8: "S Sport", 23: "S Sport",
        7: "TRT / Tabii", 696: "DAZN / YouTube", 13363: "USL YouTube", 10783: "S Sport Plus / TRT"
    };
    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

const targetLeagueIds = [748, 750, 704, 13, 393, 155, 54, 10, 10618, 351, 4664, 11, 52, 98, 97, 11417, 11416, 11415, 15938, 17, 8, 23, 7, 696, 13363, 10783];
const stubbornLeagueIds = [11, 351, 10, 97, 748, 750, 704, 13, 393];

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
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id) || (e.tournament?.uniqueTournament?.priority > 100));
                allEvents = allEvents.concat(filtered);
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
                        const targetEvents = eventsData.events.filter(e => validDates.includes(new Date(e.startTimestamp * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })));
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
        
        const hName = e.homeTeam.name, aName = e.awayTeam.name;
        const dateTR = new Date(e.startTimestamp * 1000);
        
        // --- DURUM KONTROLÜ (REVIZE EDILDI) ---
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished'; // Sadece bitmişse skor çek

        const matchObj = {
            id: e.id,
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: e.startTimestamp * 1000,
            matchStatus: statusType, // 'finished', 'inprogress', 'notstarted', 'postponed' vb.
            broadcaster: getBroadcaster(ut.id, hName, aName, e.tournament.name, ut.name), 
            homeTeam: { 
                name: translateTeam(hName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: translateTeam(aName), 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + ut.id + ".png",
            // Maç bitmemişse (canlı olsa bile) skoru "-" bas:
            homeScore: isFinished ? String(e.homeScore.display) : "-",
            awayScore: isFinished ? String(e.awayScore.display) : "-",
            tournament: ut.name
        };
        finalMatchesMap.set(`${hName}_${aName}_${ut.id}`, matchObj);
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), totalMatches: finalMatches.length, matches: finalMatches }, null, 2));
    
    console.log(`✅ İŞLEM TAMAMLANDI: Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();
