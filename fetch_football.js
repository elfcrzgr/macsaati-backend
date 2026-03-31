const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GITHUB VE DOSYA AYARLARI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const TEAM_FOLDER = "logos"; 
const TOURNAMENT_FOLDER = "tournament_logos"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TEAM_FOLDER}/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/${TOURNAMENT_FOLDER}/`;
const OUTPUT_FILE = "matches_football.json";

// --- SADECE GERÇEKTEN "ELİT" VE POPÜLER LİGLERİN ID LİSTESİ ---
const ELITE_FOOTBALL_IDS = [
    52,    // Trendyol Süper Lig
    351,   // Trendyol 1. Lig
    17,    // İngiltere Premier Lig
    8,     // İspanya La Liga
    23,    // İtalya Serie A
    7,     // Almanya Bundesliga
    11,    // Fransa Ligue 1
    34,    // Portekiz Ligi
    54,    // Hollanda Eredivisie
    13,    // Belçika Ligi
    98,    // Ziraat Türkiye Kupası
    704,   // Dünya Kupası Elemeleri (A Milli)
    844,   // Avrupa Şampiyonası (A Milli)
    238,   // Suudi Arabistan Profesyonel Ligi
    938,   // Yunanistan Süper Ligi
    748,   // UEFA Şampiyonlar Ligi
    750,   // UEFA Avrupa Ligi
    10248, // UEFA Avrupa Konferans Ligi
    10515  // UEFA Uluslar Ligi
];

// --- AKILLI YAYINCI MANTIĞI (2026 GÜNCEL) ---
const getBroadcaster = (utId, hName, aName, tName, utName) => {
    const hn = hName.toLowerCase();
    const an = aName.toLowerCase();
    const utn = utName.toLowerCase();

    const isTurkey = hn.includes("turkey") || an.includes("turkey") || hn.includes("türkiye") || an.includes("türkiye");

    const staticConfigs = {
        52: "beIN Sports",              // Süper Lig
        351: "TRT Spor / Tabii",         // 1. Lig
        17: "beIN Sports",               // Premier Lig
        8: "S Sport / S Sport Plus",     // La Liga
        23: "S Sport / S Sport Plus",    // Serie A
        7: "beIN Sports / Tivibu",       // Bundesliga
        11: "beIN Sports",               // Ligue 1
        34: "beIN Sports",               // Portekiz
        54: "S Sport Plus / TV+",        // Hollanda
        748: "TRT 1 / Tabii",            // Şampiyonlar Ligi
        750: "TRT Spor / Tabii",         // Avrupa Ligi
        10248: "TRT Spor / Tabii",       // Konferans Ligi
        10515: "TRT / Tabii",            // Uluslar Ligi
        98: "beIN Sports / TRT Spor",    // Türkiye Kupası
        97: "TFF YouTube",               // TFF 2. Lig
        238: "S Sport Plus",             // Suudi Arabistan
        242: "Apple TV (MLS)",           // MLS
        938: "S Sport Plus",             // Yunanistan
        704: isTurkey ? "TRT 1 / Tabii" : "S Sport Plus" // Milli Elemeler
    };

    if (staticConfigs[utId]) return staticConfigs[utId];
    if (utn.includes("j1 league")) return "YouTube (J.League)";
    return "Resmi Yayıncı / Canlı Skor";
};

// --- ÜLKE ÇEVİRİ SÖZLÜĞÜ ---
const teamTranslations = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "brazil": "Brezilya", "argentina": "Arjantin", "japan": "Japonya", "southkorea": "Güney Kore"
    // Gerekli görülen diğer ülkeler buraya eklenebilir...
};

const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

async function start() {
    console.log("🚀 FUTBOL MOTORU BAŞLATILDI (UEFA & ELİT FİLTRESİ AKTİF)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

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
                // Ön filtreleme: Sadece öncelikli veya hedef ID'deki maçlar
                const filtered = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament;
                    return ut && (ELITE_FOOTBALL_IDS.includes(ut.id) || ut.priority > 40);
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`Hata: ${date}`); }
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament;
        if (!ut) continue;
        
        const utId = ut.id;
        const hName = e.homeTeam.name;
        const aName = e.awayTeam.name;
        const dateTR = new Date(e.startTimestamp * 1000);
        const matchKey = `${hName}_${aName}_${utId}`;
        
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\nCANLI`;

        finalMatchesMap.set(matchKey, {
            id: e.id,
            isElite: ELITE_FOOTBALL_IDS.includes(utId), 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: getBroadcaster(utId, hName, aName, e.tournament.name, ut.name), 
            homeTeam: { name: translateTeam(hName), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(aName), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-",
            tournament: ut.name
        });
    }

    const finalMatches = Array.from(finalMatchesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`✅ İşlem bitti. Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();
