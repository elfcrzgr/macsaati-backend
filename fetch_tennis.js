const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- AYARLAR ---
const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

// Tenis Yayıncıları (Genelde beIN veya Eurosport)
const leagueConfigs = {
    3: "beIN Sports / Eurosport",  // Grand Slam (Örn: Wimbledon)
    4: "beIN Sports",              // ATP Tour
    5: "beIN Sports",              // WTA Tour
    1396: "beIN Sports",           // ATP Masters 1000
    1397: "beIN Sports"            // WTA 1000
};

// Takip edilecek Turnuva Kategorileri (3: ATP, 4: WTA, 5: Grand Slam)
const targetCategoryIds = [3, 4, 5];

async function start() {
    console.log("🎾 Tenis motoru başlatılıyor...");
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
    for (const date of [trToday, trTomorrow]) {
        try {
            console.log(`⏳ ${date} tenis verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return { events: [] }; }
            });

            if (data.events) {
                // Sadece ana kategorilerdeki (ATP/WTA) maçları filtrele
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;
        if (duplicateTracker.has(matchKey)) continue;

        // --- SET SKORLARINI BİRLEŞTİRME (TENİS ÖZEL) ---
        let setDetails = "";
        if (e.homeScore && e.homeScore.period1 !== undefined) {
            let sets = [];
            for (let i = 1; i <= 5; i++) {
                let hS = e.homeScore[`period${i}`];
                let aS = e.awayScore[`period${i}`];
                if (hS !== undefined && aS !== undefined) {
                    sets.push(`${hS}-${aS}`);
                }
            }
            if (sets.length > 0) setDetails = `(${sets.join(', ')})`;
        }

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[e.tournament?.category?.id] || "beIN Sports / Eurosport",
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: TENNIS_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: TENNIS_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + (e.tournament?.uniqueTournament?.id || "default") + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            setDetails: setDetails, // XML'deki txtSetScores için
            tournament: e.tournament.name
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        matches: finalMatches 
    }, null, 2));

    console.log(`✅ ${OUTPUT_FILE} oluşturuldu. (Toplam ${finalMatches.length} maç)`);
    await browser.close();
}

start();