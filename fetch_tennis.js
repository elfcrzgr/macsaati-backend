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
    3: "beIN Sports / Eurosport", 4: "beIN Sports", 5: "beIN Sports",
    1396: "beIN Sports", 1397: "beIN Sports", 1398: "beIN Sports",
    1399: "beIN Sports", 6: "beIN Sports", 7: "beIN Sports"
};

const targetCategoryIds = Object.keys(categoryConfigs).map(Number);

async function start() {
    console.log("🎾 Tenis motoru başlatılıyor (Karma Çiftler Derin Tarama Aktif)...");
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
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${date}`, { waitUntil: 'networkidle2', timeout: 60000 });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
            });
            if (data && data.events) {
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.category?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        if (duplicateTracker.has(`${e.id}`)) continue;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // --- KRİTİK DÜZELTME: DERİN TARAMA METODU ---
        const getLogosArray = (team) => {
            let flagList = [];
            
            // 1. Yol: Takım ana ülkesi (Tekler)
            if (team.country?.alpha2) {
                flagList.push(team.country.alpha2.toLowerCase());
            } 
            
            // 2. Yol: Oyuncuların içine gir (Çiftler)
            if (team.players && team.players.length > 0) {
                team.players.forEach(p => {
                    // SofaScore'un iki farklı veri yapısını da kontrol et:
                    // Yapı A: p.country.alpha2
                    // Yapı B: p.player.country.alpha2
                    const code = (p.country?.alpha2) || (p.player?.country?.alpha2);
                    if (code) {
                        flagList.push(code.toLowerCase());
                    }
                });
            }

            // Eğer hala boşsa default ekle
            if (flagList.length === 0) flagList.push("default");

            // Tekrar eden ülkeleri temizle (Aynı ülkeden çiftler için)
            let uniqueFlags = [...new Set(flagList)];
            
            return uniqueFlags.map(code => TENNIS_LOGO_BASE + code + ".png");
        };

        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: categoryConfigs[e.tournament?.category?.id] || "beIN / Eurosport",
            homeTeam: { 
                name: e.homeTeam.name, 
                logos: getLogosArray(e.homeTeam) 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logos: getLogosArray(e.awayTeam) 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + tId + ".png",
            homeScore: (e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            setDetails: "", 
            tournament: e.tournament.name
        });
        duplicateTracker.add(`${e.id}`);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: finalMatches }, null, 2));
    console.log(`✅ ${finalMatches.length} maç yazıldı.`);
    await browser.close();
}
start();