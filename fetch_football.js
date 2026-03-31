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

// --- SENİN KİŞİSEL ELİT LİSTEN (Sadece bunlar isElite: true olacak) ---
// --- SENİN KİŞİSEL ELİT LİSTEN (Hatalar Giderildi) ---
const MY_PERSONAL_ELITE_IDS = [
    52,    // Trendyol Süper Lig
    351,   // Trendyol 1. Lig
    17,    // İngiltere Premier Lig
    8,     // İspanya La Liga
    23,    // İtalya Serie A
    35,    // Almanya Bundesliga 
    11,    // Fransa Ligue 1
    34,    // Portekiz Ligi
    54,    // Hollanda Eredivisie
    13,    // Belçika Ligi
    98,    // Ziraat Türkiye Kupası
    7,     // UEFA Şampiyonlar Ligi
    750,   // UEFA Avrupa Ligi
    10248, // UEFA Avrupa Konferans Ligi
    10515, // UEFA Uluslar Ligi (A Milli)
    844,   // Avrupa Şampiyonası (A Milli)
    704,   // Dünya Kupası Elemeleri (A Milli)
    238,   // Suudi Arabistan Profesyonel Ligi
    938    // Yunanistan Süper Ligi
];

// --- TAKİP EDİLEN EKSTRA LİGLER (Zaten çekilecek olanlar) ---
const EXTRA_TRACKED_IDS = [
    10, 393, 242, 696, 10618, 10783, 97, 11415, 11416, 11417, 13363, 15938, 4664
];

// --- YAYINCI AYARLARI ---
const getBroadcaster = (utId, hName, aName, utName) => {
    const staticConfigs = {
        52: "beIN Sports", 351: "TRT Spor / Tabii", 17: "beIN Sports", 8: "S Sport / S Sport Plus",
        23: "S Sport / S Sport Plus", 7: "beIN Sports / Tivibu", 11: "beIN Sports", 34: "beIN Sports",
        54: "S Sport Plus / TV+", 748: "TRT 1 / Tabii", 750: "TRT Spor / Tabii",
        10248: "TRT Spor / Tabii", 10515: "TRT / Tabii", 98: "beIN Sports / TRT Spor",
        238: "S Sport Plus", 242: "Apple TV", 938: "S Sport Plus", 704: "TRT / Tabii", 393: "CBC Sport"
    };
    if (staticConfigs[utId]) return staticConfigs[utId];
    return "Resmi Yayıncı / Canlı Skor";
};

// --- ÇEVİRİ MANTIĞI ---
const teamTranslations = { "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere", "spain": "İspanya", "italy": "İtalya" };
const translateTeam = (name) => {
    if (!name) return name;
    const cleanSearch = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
    for (const [eng, tr] of Object.entries(teamTranslations)) {
        if (cleanSearch.includes(eng)) return name.replace(new RegExp(eng, 'i'), tr);
    }
    return name;
};

async function start() {
    console.log("🚀 MAÇ SAATİ: HİBRİT ELİT MOTORU ÇALIŞIYOR...");
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
                // ÇEKME AŞAMASI: Hem bizim listedekiler hem de SofaScore'un önemli dedikleri gelsin
                const filtered = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament;
                    if (!ut) return false;
                    const utId = ut.id;
                    return MY_PERSONAL_ELITE_IDS.includes(utId) || 
                           EXTRA_TRACKED_IDS.includes(utId) || 
                           ut.priority > 40; // Gürcistan, U19 vb. buradan girer
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
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        const isInProgress = statusType === 'inprogress';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (isInProgress) timeString = `${timeString}\nCANLI`;

        finalMatchesMap.set(matchKey, {
            id: e.id,
            // --- İŞARETLEME AŞAMASI: Sadece senin listen true olur ---
            // Gürcistan maçı listeye girer ama isElite false kalır.
            isElite: MY_PERSONAL_ELITE_IDS.includes(utId), 
            
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: getBroadcaster(utId, e.homeTeam.name, e.awayTeam.name, ut.name), 
            homeTeam: { name: translateTeam(e.homeTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: translateTeam(e.awayTeam.name), logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
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
