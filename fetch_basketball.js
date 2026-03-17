const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const BASKETBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/logos/`;
const BASKETBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/basketball/tournament_logos/`;
const OUTPUT_FILE = "matches_basketball.json";

const leagueConfigs = {
    3547: "S Sport / NBA TV", 138: "S Sport", 139: "beIN Sports", 
    9357: "beIN Sports / Tivibu", 168: "S Sport Plus / Tivibu", 
    215: "S Sport", 227: "beIN Sports", 141: "S Sport Plus", 
    235: "S Sport Plus", 262: "S Sport Plus", 264: "S Sport Plus", 
    405: "Spor SMART", 304: "S Sport Plus", 137: "Tivibu Spor"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (NBA Gece Maçları Fix)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // TR Saatine göre yyyy-mm-dd formatında tarih veren fonksiyon
    const getTRDateString = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const trToday = getTRDateString(0);
    const trTomorrow = getTRDateString(1);
    const trYesterday = getTRDateString(-1);

    let allEvents = [];
    // NBA maçları sabaha karşı bittiği için SofaScore onları 'Dün' (Yesterday) listesinde tutuyor olabilir.
    // Bu yüzden 3 günü de tarıyoruz.
    for (const date of [trYesterday, trToday, trTomorrow]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            // En stabil endpoint: scheduled-events
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return { events: [] }; }
            });
            
            if (data.events && data.events.length > 0) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
                console.log(`✅ ${date} için ${filtered.length} maç bulundu.`);
            }
        } catch (e) { console.error(`${date} verisi çekilemedi: ${e.message}`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateObject = new Date(e.startTimestamp * 1000);
        // Maçın TR takvimindeki gerçek günü ve saati
        const matchDateTR = dateObject.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const matchTimeTR = dateObject.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

        // Sadece BUGÜN ve YARIN takvim gününe düşen maçları alıyoruz (00:00 - 23:59 kuralı)
        if (matchDateTR !== trToday && matchDateTR !== trTomorrow) continue;

        const matchKey = `${matchDateTR}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        const tournamentName = e.tournament?.name || "";
        const utId = e.tournament?.uniqueTournament?.id;
        const isNBA = (utId === 3547 || tournamentName.toUpperCase().includes("NBA"));
        const logoFolder = isNBA ? "NBA/" : "";

        finalMatches.push({
            id: e.id,
            fixedDate: matchDateTR,
            fixedTime: matchTimeTR,
            timestamp: dateObject.getTime(),
            broadcaster: leagueConfigs[utId] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + logoFolder + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + (isNBA ? "3547" : utId) + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: isNBA ? "NBA" : (e.tournament.uniqueTournament.name || tournamentName)
        });

        duplicateTracker.add(matchKey);
    }

    // Saate göre sırala
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    const jsonOutput = { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        matches: finalMatches 
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`🏁 BİTTİ: Toplam ${finalMatches.length} maç JSON'a yazıldı.`);
    await browser.close();
}

start();