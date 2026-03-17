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

// Lig Yayıncıları - Tüm konuştuğumuz ligler eklendi
const leagueConfigs = {
    3547: "S Sport / NBA TV",      // NBA
    138: "S Sport",                // EuroLeague
    139: "beIN Sports",            // Türkiye BSL
    9357: "beIN Sports / Tivibu",  // Champions League
    141: "S Sport Plus",           // İtalya / EuroCup
    168: "S Sport Plus / Tivibu",  // EuroCup
    215: "S Sport",                // İspanya ACB
    227: "beIN Sports",            // Fransa Élite / Almanya
    235: "S Sport Plus",           // ABA / Litvanya
    132: "S Sport Plus",           // ABA Ligi
    405: "Spor SMART",             // Çin CBA
    304: "S Sport Plus",           // Avustralya NBL
    137: "Tivibu Spor"             // İtalya Lega A
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (Genişletilmiş Lig Listesi)...");
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
    // Gece biten NBA maçlarını kaçırmamak için: Dün, Bugün, Yarın
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return { events: [] }; }
            });

            if (data.events) {
                // Filtreleme: Ya ID listede olacak ya da isimde NBA geçecek
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    const tName = e.tournament?.name || "";
                    return targetLeagueIds.includes(utId) || tName.toUpperCase().includes("NBA");
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();
    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Sadece Bugün ve Yarın'ın maçlarını göster (00:00 - 23:59 kuralı)
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        // --- NBA KONTROLÜ ---
        const tournamentName = e.tournament?.name || "";
        const utId = e.tournament?.uniqueTournament?.id;
        const isNBA = (utId === 3547 || tournamentName.toUpperCase().includes("NBA"));
        
        const logoPathSuffix = isNBA ? "NBA/" : "";

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId] || (isNBA ? "S Sport / NBA TV" : "Yerel Yayın"),
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoPathSuffix + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoPathSuffix + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + (isNBA ? "3547" : utId) + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: isNBA ? "NBA" : (e.tournament.uniqueTournament.name || "Basketbol")
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, matches: finalMatches }, null, 2));
    
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();