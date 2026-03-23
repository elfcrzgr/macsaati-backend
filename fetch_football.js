const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- YAYINCI BELİRLEME FONKSİYONU (Zeki Mantık) ---
function getBroadcaster(tournamentName) {
    const name = tournamentName.toLowerCase();
    
    // 1. Avrupa Kupaları (ID bağımsız isim kontrolü)
    if (name.includes("champions league") || name.includes("europa league") || name.includes("conference league")) return "TRT / Tabii";
    
    // 2. Türkiye
    if (name.includes("süper lig")) return "beIN Sports";
    if (name.includes("1. lig")) return "beIN Sports / TRT Spor";
    if (name.includes("türkiye kupasi")) return "A Spor / ATV";
    
    // 3. İngiltere
    if (name.includes("premier league")) return "beIN Sports";
    if (name.includes("championship")) return "beIN Sports / Tivibu";
    if (name.includes("fa cup") || name.includes("efl cup")) return "beIN Sports / Tivibu";
    
    // 4. İspanya
    if (name.includes("laliga") || name.includes("la liga")) {
        if (name.includes("2")) return "S Sport Plus";
        return "S Sport";
    }
    if (name.includes("copa del rey")) return "Tivibu Spor";
    
    // 5. İtalya
    if (name.includes("serie a")) return "S Sport";
    if (name.includes("serie b") || name.includes("italy cup")) return "S Sport Plus";
    
    // 6. Almanya
    if (name.includes("bundesliga")) {
        if (name.includes("2")) return "Tivibu / TRT Spor";
        return "beIN Sports";
    }
    
    // 7. Fransa
    if (name.includes("ligue 1") || name.includes("ligue 2")) return "beIN Sports";
    
    // 8. Diğer Önemli Ligler
    if (name.includes("liga portugal") || name.includes("primeira liga")) return "S Sport Plus";
    if (name.includes("saudi professional league")) return "S Sport / TV+";
    
    // 9. Milli Takımlar
    if (name.includes("nations league") || name.includes("world cup") || name.includes("euro 20") || name.includes("european championship")) return "TRT / Tabii";

    return "Yerel Yayın";
}

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Filtreleme: Maksimum Seviye)...");
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
    // Bugün ve Yarın
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const tName = (e.tournament?.uniqueTournament?.name || e.tournament?.name || "").toLowerCase();
                    
                    // --- YASAKLI FİLTRE (Hindistan, Mizoram, Gençler, Kadınlar) ---
                    const isForbidden = tName.includes("india") || tName.includes("u19") || tName.includes("u21") || 
                                       tName.includes("women") || tName.includes("mizoram") || tName.includes("i-league");
                    
                    // --- BEYAZ LİSTE (Sadece istediğin liglerin anahtar kelimeleri) ---
                    const whitelist = [
                        "trendyol", "süper lig", "1. lig", "türkiye kupasi",
                        "premier league", "championship", "fa cup", "efl cup",
                        "bundesliga", "laliga", "la liga", "copa del rey",
                        "serie a", "serie b", "italy cup", "ligue 1", "ligue 2",
                        "liga portugal", "primeira liga", "saudi professional league",
                        "champions league", "europa league", "conference league",
                        "nations league", "world cup", "euro 20", "european championship"
                    ];

                    const isTarget = whitelist.some(word => tName.includes(word));

                    return isTarget && !isForbidden;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası:`, e.message); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const tName = e.tournament?.uniqueTournament?.name || e.tournament.name;
        const utId = e.tournament?.uniqueTournament?.id || "default";
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;

        if (duplicateTracker.has(matchKey)) continue;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: getBroadcaster(tName), 
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: (e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: tName
        });

        duplicateTracker.add(matchKey);
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    console.log(`\n✅ İşlem Tamamlandı. ${finalMatches.length} elit maç kaydedildi.`);
    await browser.close();
}

start();