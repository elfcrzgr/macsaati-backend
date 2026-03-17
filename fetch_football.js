const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- GÜNCEL KLASÖR YAPISI ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// İsimleri sabitledik
const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";
// ----------------------------

const leagueConfigs = {
    52: "beIN Sports", 98: "beIN Sports / TRT Spor", 17: "beIN Sports",
    8: "S Sport", 54: "S Sport Plus", 23: "S Sport / Tivibu Spor",
    35: "beIN Sports / Tivibu Spor", 34: "beIN Sports", 37: "TV8.5 / Exxen",
    238: "D-Smart / Spor Smart", 709: "CBC Sport / Yerel", 13363: "TV8.5 / Exxen",
    19: "Tivibu / TRT Spor / Tabii", 481: "Spor Smart / D-Smart",
    7: "TRT / Tabii", 3: "TRT / Tabii", 848: "TRT / Tabii",
    679: "TRT / Tabii", 17015: "TRT / Tabii",
    325: "S Sport Plus / D-Smart", 155: "S Sport Plus / D-Smart",
    44: "beIN Sports / Tivibu", 955: "S Sport Plus / TV8.5"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Futbol veri çekme motoru başlatılıyor...");
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
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data.events) {
                const filtered = data.events.filter(e => targetLeagueIds.includes(e.tournament?.uniqueTournament?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} listesi alınamadı.`); }
    }

    const finalMatches = [];
    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        
        const matchObject = {
            id: e.id,
            fixedDate: dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }),
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[e.tournament.uniqueTournament.id] || "Yerel Yayın",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            // BURASI DÜZELTİLDİ: Değişken adı yukarıdakiyle aynı yapıldı.
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + e.tournament.uniqueTournament.id + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };
        finalMatches.push(matchObject);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    
    const jsonOutput = { 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        matches: finalMatches 
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`✅ ${OUTPUT_FILE} başarıyla oluşturuldu.`);
    await browser.close();
}

start();