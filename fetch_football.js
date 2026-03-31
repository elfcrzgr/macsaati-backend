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

// --- SENİN KESİN ELİT LİG LİSTEN (SADECE BUNLAR TRUE OLUR) ---
const MY_PERSONAL_ELITE_IDS = [
    52,    // Trendyol Süper Lig (Türkiye)
    351,   // Trendyol 1. Lig (Türkiye)
    98,    // Ziraat Türkiye Kupası (Türkiye)
    17,    // Premier League (İngiltere)
    8,     // La Liga (İspanya)
    23,    // Serie A (İtalya)
    35,    // Bundesliga (Almanya)
    11,    // Ligue 1 (Fransa)
    34,    // Liga Portugal (Portekiz)
    54,    // Eredivisie (Hollanda)
    13,    // Pro League (Belçika)
    7,     // UEFA Şampiyonlar Ligi
    750,   // UEFA Avrupa Ligi
    10248, // UEFA Konferans Ligi
    10783, // UEFA Uluslar Ligi (Nations League)
    844,   // Euro (Avrupa Şampiyonası)
    238,   // Saudi Pro League (Suudi Arabistan)
    938    // Super League (Yunanistan)
];

// --- YAYINCI AYARLARI ---
const getBroadcaster = (utId) => {
    const staticConfigs = {
        52: "beIN Sports", 351: "TRT Spor / Tabii", 17: "beIN Sports", 8: "S Sport / S Sport Plus",
        23: "S Sport / S Sport Plus", 35: "beIN / Tivibu", 11: "beIN Sports", 
        7: "TRT 1 / Tabii", 750: "TRT Spor / Tabii", 10248: "TRT Spor / Tabii", 
        10783: "TRT / Tabii", 98: "beIN Sports / TRT Spor", 238: "S Sport Plus"
    };
    return staticConfigs[utId] || "Resmi Yayıncı / Canlı Skor";
};

async function start() {
    console.log("🚀 MAÇ SAATİ: >20 ÖNCELİKLİ SAF ID MOTORU BAŞLATILDI...");
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
            console.log(`📡 ${date} için veriler toplanıyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 2000));
            const rawContent = await page.evaluate(() => document.body.innerText);
            let data = JSON.parse(rawContent);
            
            if (data && data.events) {
                // SADECE ÖNCELİĞİ 20 ÜSTÜ OLANLAR (DÜNYA GENELİ ÖNEMLİ MAÇLAR)
                const filteredEvents = data.events.filter(e => {
                    const ut = e.tournament?.uniqueTournament || e.tournament;
                    return ut && (ut.priority > 20);
                });
                allEvents = allEvents.concat(filteredEvents);
            }
        } catch (e) { console.error(`Hata: ${date}`); }
    }

    const finalMatchesMap = new Map();
    for (const e of allEvents) {
        const ut = e.tournament.uniqueTournament || e.tournament;
        const utId = ut.id;
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        const dateTR = new Date(e.startTimestamp * 1000);
        const statusType = e.status?.type; 
        const isFinished = statusType === 'finished';

        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";

        finalMatchesMap.set(matchKey, {
            id: e.id,
            // KESİN KONTROL: Sadece listedeyse TRUE, değilse FALSE
            isElite: MY_PERSONAL_ELITE_IDS.includes(utId), 
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: timeString,
            timestamp: e.startTimestamp * 1000,
            broadcaster: getBroadcaster(utId), 
            homeTeam: { name: e.homeTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" },
            awayTeam: { name: e.awayTeam.name, logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" },
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

    console.log(`✅ İŞLEM TAMAM: Toplam ${finalMatches.length} kaliteli maç kaydedildi.`);
    await browser.close();
}

start();
