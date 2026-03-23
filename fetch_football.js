const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- SADECE SENİN İSTEDİĞİN ELİT LİGLER VE 2026 YAYINCILARI ---
const leagueConfigs = {
    // --- TÜRKİYE ---
    52: "beIN Sports",             // Trendyol Süper Lig
    98: "beIN Sports / TRT Spor",  // Trendyol 1. Lig
    311: "A Spor / ATV",           // Ziraat Türkiye Kupası

    // --- İNGİLTERE ---
    17: "beIN Sports",             // Premier League
    18: "beIN Sports",             // Championship
    41: "TRT / Tabii",             // FA Cup

    // --- İSPANYA ---
    8: "S Sport",                  // LaLiga
    54: "S Sport Plus",            // LaLiga 2
    73: "Tivibu Spor",             // Copa del Rey

    // --- İTALYA ---
    23: "S Sport",                 // Serie A
    53: "S Sport Plus",            // Serie B

    // --- ALMANYA ---
    35: "beIN Sports / Tivibu",    // Bundesliga
    19: "Tivibu / TRT Spor",       // Bundesliga 2

    // --- FRANSA ---
    34: "beIN Sports",             // Ligue 1
    33: "beIN Sports",             // Ligue 2

    // --- DİĞER ELİT LİGLER ---
    238: "Tivibu Spor / Spor Smart", // Portekiz Liga Portugal (Primeira Liga)
    170: "S Sport / TV+",            // Suudi Arabistan Pro Lig

    // --- AVRUPA VE MİLLİ MAÇLAR ---
    7: "TRT / Tabii",              // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",              // UEFA Avrupa Ligi
    17015: "TRT / Tabii",          // UEFA Konferans Ligi (Güncel ID)
    848: "TRT / Tabii",            // UEFA Konferans Ligi (Eski ID - SofaScore bazen bunu kullanıyor)
    1819: "TRT / Tabii / TV8",     // UEFA Uluslar Ligi (Nations League)
    7544: "TRT / Tabii",           // Dünya Kupası Elemeleri
    4656: "TRT / Tabii"            // Avrupa Şampiyonası Elemeleri
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Katı ID + Anti-Çöp Filtresi Aktif)...");
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
    
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    const tName = (e.tournament?.uniqueTournament?.name || "").toLowerCase();
                    
                    // 1. KURAL: Maçın ID'si bizim elit listemizde yoksa ASLA içeri alma!
                    if (!targetLeagueIds.includes(utId)) return false;

                    // 2. GÜVENLİK SİGORTASI: SofaScore API'si ID 848'i (Konferans Ligi) Hindistan'a verirse, isimden yakala ve yok et!
                    if (tName.includes("india") || 
                        tName.includes("i-league") || 
                        tName.includes("mizoram") || 
                        tName.includes("women") || 
                        tName.includes("frauen") || 
                        tName.includes("u19") || 
                        tName.includes("u20") || 
                        tName.includes("u21")) {
                        return false;
                    }

                    return true;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası:`, e.message); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const utId = e.tournament.uniqueTournament.id;
        
        const matchKey = `${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId], // Yayını direkt ID listemizden çekiyoruz
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
            tournament: e.tournament.uniqueTournament.name
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
    
    console.log(`\n✅ İşlem Tamamlandı. SADECE hedeflenen elit maçlar kaydedildi.`);
    await browser.close();
}

start();