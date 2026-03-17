const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- AYARLAR ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const BASKETBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/`;
const BASKETBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/`;
const OUTPUT_FILE = "matches_basketball.json";

// Liglerin Yayıncı Bilgileri ve ID'leri
const leagueConfigs = {
    138: "S Sport",                // EuroLeague
    3547: "NBA",                   // NBA
    139: "beIN Sports",            // Basketbol Süper Ligi (BSL)
    9357: "beIN Sports / Tivibu",  // Champions League (BCL)
    168: "S Sport Plus / Tivibu",  // EuroCup
    215: "S Sport",                // İspanya ACB
    132: "S Sport Plus",           // Adriyatik ABA Ligi
    137: "Tivibu Spor"             // İtalya Lega A
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (2 Günlük & NBA Klasör Destekli)...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    let allEvents = [];
    // Bugün ve Yarın için döngü
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} basketbol verisi SofaScore'dan çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            
            const data = await page.evaluate(() => {
                return JSON.parse(document.body.innerText);
            });

            if (data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) {
            console.error(`${date} tarihinde hata: ${e.message}`);
        }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Mükerrer kontrolü (Aynı gün, aynı maç)
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        // --- NBA KLASÖR AYRIMI ---
        // Eğer lig NBA (3547) ise "NBA/" klasörünü yola ekle
        const isNBA = e.tournament.uniqueTournament.id === 3547;
        const logoPathSuffix = isNBA ? "NBA/" : "";

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoPathSuffix + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoPathSuffix + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + e.tournament.uniqueTournament.id + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey);
    }

    // Zaman sıralaması yap
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        sport: "basketball",
        matches: finalMatches 
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`✅ İşlem başarıyla bitti. ${finalMatches.length} basketbol maçı ${OUTPUT_FILE} dosyasına yazıldı.`);
    
    await browser.close();
}

start();