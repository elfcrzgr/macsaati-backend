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

const leagueConfigs = {
    3547: "S Sport / NBA TV", 138: "S Sport", 139: "beIN Sports", 
    9357: "beIN Sports / Tivibu", 168: "S Sport Plus / Tivibu", 
    215: "S Sport", 227: "beIN Sports", 141: "S Sport Plus", 
    235: "S Sport Plus", 262: "S Sport Plus", 264: "S Sport Plus", 
    405: "Spor SMART", 304: "S Sport Plus", 137: "Tivibu Spor"
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (Futbol mantığıyla senkronize)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);

    let allEvents = [];
    // NBA sarkan maçları için dünü tara, ama sadece bugün/yarın olanları alacağız
    for (const date of [getTRDate(-1), trToday, trTomorrow]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return { events: [] }; }
            });

            if (data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    const tName = (e.tournament?.name || "").toUpperCase();
                    
                    // KRİTİK: Ana NBA ligi olsun, alt ligler (G League) gelmesin
                    const isMainNBA = tName.includes("NBA") && !tName.includes("G LEAGUE") && !tName.includes("WOMEN");
                    
                    return targetLeagueIds.includes(utId) || isMainNBA;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // SADECE BUGÜN VE YARIN (Futbol kodundaki gibi temiz liste)
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        const tournamentName = e.tournament?.name || "";
        const utId = e.tournament?.uniqueTournament?.id;
        const isNBA = (utId === 3547 || (tournamentName.toUpperCase().includes("NBA") && !tournamentName.toUpperCase().includes("G LEAGUE")));
        
        const isFinished = e.status?.type === 'finished';

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId] || (isNBA ? "S Sport / NBA TV" : "Yerel Yayın"),
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: BASKETBALL_TEAM_LOGO_BASE + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + (isNBA ? "3547" : utId) + ".png",
            homeScore: isFinished ? String(e.homeScore?.display || "-") : "-",
            awayScore: isFinished ? String(e.awayScore?.display || "-") : "-",
            tournament: isNBA ? "NBA" : (e.tournament.uniqueTournament.name || "Basketbol")
        });

        duplicateTracker.add(matchKey);
    }

    // Futbol kodundaki gibi Timestamp sıralaması
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: finalMatches }, null, 2));
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();