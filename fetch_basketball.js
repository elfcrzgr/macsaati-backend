const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- KONFİGÜRASYON ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const BASKETBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/`;
const BASKETBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/`;
const OUTPUT_FILE = "matches_basketball.json";

// Lig Yayıncıları ve ID'leri (NBA ID'si: 3547)
const leagueConfigs = {
    3547: "S Sport / NBA TV",      // NBA
    138: "S Sport",                // EuroLeague
    139: "beIN Sports",            // BSL (Türkiye)
    9357: "beIN Sports / Tivibu",  // BCL
    168: "S Sport Plus / Tivibu",  // EuroCup
    215: "S Sport",                // İspanya ACB
    132: "S Sport Plus",           // ABA Ligi
    137: "Tivibu Spor"             // İtalya Lega A
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (NBA Klasör Filtresi Aktif)...");
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
    // Bugün ve Yarın (2 Günlük Veri)
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} basketbol verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası: ${e.message}`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set(); // Mükerrer kontrolü

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Benzersiz anahtar: Tarih_Ev_Deplasman
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;

        if (duplicateTracker.has(matchKey)) {
            console.log(`⚠️ Çift kayıt engellendi: ${matchKey}`);
            continue;
        }

        // --- KRİTİK NBA KONTROLÜ ---
        const tournamentId = e.tournament?.uniqueTournament?.id;
        const isNBA = (tournamentId === 3547); 
        const logoFolder = isNBA ? "NBA/" : ""; // NBA ise klasörü ekle

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[tournamentId] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + tournamentId + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey);
    }

    // Maçları saate göre sırala
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        matches: finalMatches 
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`✅ İşlem tamam. ${finalMatches.length} benzersiz basketbol maçı kaydedildi.`);
    
    await browser.close();
}

start();