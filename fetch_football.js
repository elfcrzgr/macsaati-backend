const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GITHUB VE DOSYA AYARLARI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- SADECE BUNLAR ELİT OLACAK (İsim bazlı kesin liste) ---
const MY_ELITE_NAMES = [
    "Süper Lig", "1. Lig", "Premier League", "LaLiga", "Serie A", "Bundesliga", "Ligue 1",
    "Champions League", "Europa League", "Conference League", "Nations League", 
    "World Championship Qual", "Euro", "Ziraat Türkiye Kupası", "Eredivisie", "Liga Portugal",
    "Super League", "Saudi Pro League", "Major League Soccer"
];

// --- AKILLI YAYINCI MANTIĞI ---
const getBroadcaster = (utName) => {
    const name = utName.toLowerCase();
    if (name.includes("süper lig")) return "beIN Sports";
    if (name.includes("1. lig")) return "TRT Spor / Tabii";
    if (name.includes("premier league")) return "beIN Sports";
    if (name.includes("laliga") || name.includes("serie a")) return "S Sport / S Sport Plus";
    if (name.includes("champions league") || name.includes("europa league") || name.includes("nations league") || name.includes("world championship")) return "TRT / Tabii";
    if (name.includes("bundesliga")) return "beIN / Tivibu";
    if (name.includes("saudi")) return "S Sport Plus";
    return "Resmi Yayıncı / Canlı Skor";
};

async function start() {
    console.log("🚀 MAÇ SAATİ: SADELEŞTİRİLMİŞ AKILLI MOTOR BAŞLATILDI...");
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
                // SofaScore'un genel önceliğine göre tüm önemli maçları çek
                const filtered = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament || e.tournament;
                    return ut && ut.priority > 40; 
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} tarihinde hata oluştu.`); }
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament?.uniqueTournament || e.tournament;
        if (!ut) continue;
        
        const utId = ut.id;
        const utName = ut.name || "";
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        
        // --- ELİT KONTROLÜ (SADECE İSME BAKAR) ---
        // Eğer turnuva adı senin MY_ELITE_NAMES listendeki kelimelerden birini içeriyorsa TRUE, yoksa FALSE.
        const isElite = MY_ELITE_NAMES.some(kw => utName.includes(kw));

        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";

        finalMatchesMap.set(matchKey, {
            id: e.id,
            isElite: isElite, 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: getBroadcaster(utName), 
            homeTeam: { name: e.homeTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-",
            tournament: utName
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
