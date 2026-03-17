const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GITHUB VE YOL AYARLARI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const BASKETBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/`;
const BASKETBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/`;
const OUTPUT_FILE = "matches_basketball.json";

// Lig Yayıncı Bilgileri (Tüm konuştuğumuz sabit ID'ler eklendi)
const leagueConfigs = {
    3547: "S Sport / NBA TV",      // NBA
    138: "S Sport",                // EuroLeague
    139: "beIN Sports",            // Türkiye BSL
    9357: "beIN Sports / Tivibu",  // BCL (Şampiyonlar Ligi)
    168: "S Sport Plus / Tivibu",  // EuroCup
    215: "S Sport",                // İspanya ACB
    227: "beIN Sports",            // Fransa Élite (LNB Pro A)
    141: "S Sport Plus",           // İtalya Serie A
    235: "S Sport Plus",           // Litvanya LKL
    262: "S Sport Plus",           // ABA Ligi
    264: "S Sport Plus",           // VTB United League
    405: "Spor SMART",             // Çin CBA
    304: "S Sport Plus",           // Avustralya NBL
    137: "Tivibu Spor"             // İtalya Lega A (Ekstra)
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (Tüm Ligler ve NBA Filtresi Aktif)...");
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
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                // Filtreleme: Tanımlı ligleri al
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası: ${e.message}`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;

        if (duplicateTracker.has(matchKey)) continue;

        // --- NBA YOLU VE İSİM KONTROLÜ ---
        const tournamentName = e.tournament?.name || "";
        const uniqueTournamentId = e.tournament?.uniqueTournament?.id;
        
        const isNBA = (uniqueTournamentId === 3547 || tournamentName.toUpperCase().includes("NBA"));
        const logoFolder = isNBA ? "NBA/" : "";

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[uniqueTournamentId] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.awayTeam.id + ".png" 
            },
            // NBA ise 3547.png'ye zorla, diğerleri için gelen ID'yi kullan
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + (isNBA ? "3547" : uniqueTournamentId) + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: isNBA ? "NBA" : (e.tournament.uniqueTournament.name || tournamentName)
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    const jsonOutput = { success: true, lastUpdated: new Date().toISOString(), matches: finalMatches };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    
    console.log(`✅ İşlem bitti. Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();