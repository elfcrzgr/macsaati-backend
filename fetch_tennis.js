const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/tennis/tournament_logos/`;
const OUTPUT_FILE = "matches_tennis.json";

const categoryConfigs = {
    3: "S Sport",          // ATP Tour (Masters, 500, 250)
    4: "beIN Sports",      // WTA Tour
    5: "Eurosport",        // Genel Grand Slam verisi
    1396: "Eurosport",     // Australian Open
    1397: "Eurosport",     // Roland Garros
    1398: "S Sport",       // Wimbledon (Türkiye'de ana yayıncı S Sport'tur)
    1399: "Eurosport",     // US Open
    6: "beIN Sports",      // Davis Cup / Billie Jean King Cup
    7: "S Sport"           // ATP Finals / Next Gen
};

const targetCategoryIds = Object.keys(categoryConfigs).map(Number);

// --- ÇIFTLER MAÇLARI İÇİN: subTeams'den ülke kodlarını çıkar ---
function getCountriesFromSubTeams(team) {
    if (!team.subTeams || team.subTeams.length === 0) {
        return ["default"];
    }
    
    const countries = team.subTeams
        .map(player => {
            const code = player.country?.alpha2;
            return code ? code.toLowerCase() : null;
        })
        .filter(Boolean);
    
    return countries.length > 0 ? countries : ["default"];
}

// --- TEKLİ MAÇLAR İÇİN: Takımın ülkesini al ---
function getCountriesSingles(team) {
    const code = team.country?.alpha2;
    return code ? [code.toLowerCase()] : ["default"];
}

async function start() {
    console.log("🚀 Tenis motoru başlatılıyor (Çiftler + Tekler)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} listesi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            if (data && data.events) {
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { 
            console.error(`${date} hatası:`, e.message); 
        }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        if (duplicateTracker.has(`${e.id}`)) continue;

        let homeCodes = [];
        let awayCodes = [];
        const isDouble = e.homeTeam.name.includes("/");

        if (isDouble) {
            console.log(`🔍 Çiftler: ${e.homeTeam.name} vs ${e.awayTeam.name}`);
            try {
                await page.goto(`https://api.sofascore.com/api/v1/event/${e.id}`, { 
                    waitUntil: 'networkidle2', 
                    timeout: 5000 
                });
                const detail = await page.evaluate(() => JSON.parse(document.body.innerText));
                
                if (detail?.event) {
                    // subTeams'den bayrakları al
                    homeCodes = getCountriesFromSubTeams(detail.event.homeTeam);
                    awayCodes = getCountriesFromSubTeams(detail.event.awayTeam);
                    console.log(`   ✅ Home: [${homeCodes.join(", ")}], Away: [${awayCodes.join(", ")}]`);
                }
            } catch (err) {
                console.error(`   ⚠️  Detay sayfası hatası, default kullanılıyor`);
                homeCodes = ["default"];
                awayCodes = ["default"];
            }
        } else {
            // Tekler
            console.log(`🎾 Tekler: ${e.homeTeam.name} vs ${e.awayTeam.name}`);
            homeCodes = getCountriesSingles(e.homeTeam);
            awayCodes = getCountriesSingles(e.awayTeam);
            console.log(`   ✅ Home: [${homeCodes.join(", ")}], Away: [${awayCodes.join(", ")}]`);
        }

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "beIN / Eurosport",
            isDoubles: isDouble,
            homeTeam: { 
                name: e.homeTeam.name, 
                countries: homeCodes,
                logos: homeCodes.map(c => TENNIS_LOGO_BASE + c + ".png") 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                countries: awayCodes,
                logos: awayCodes.map(c => TENNIS_LOGO_BASE + c + ".png") 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tId + ".png",
            homeScore: (e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.name
        });
        duplicateTracker.add(`${e.id}`);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ ${finalMatches.length} maç başarıyla yazıldı!`);
    await browser.close();
}

start();