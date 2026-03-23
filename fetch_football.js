const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

const leagueConfigs = {
    // --- TÜRKİYE LİGLERİ ---
    52: "beIN Sports",             // Trendyol Süper Lig
    98: "beIN Sports / TRT Spor",  // Trendyol 1. Lig
    311: "A Spor / ATV",           // Ziraat Türkiye Kupası

    // --- İNGİLTERE LİGLERİ ---
    17: "beIN Sports",             // İngiltere Premier League
    18: "beIN Sports",             // İngiltere Championship
    41: "TRT / Tabii",             // İngiltere FA Cup

    // --- İSPANYA LİGLERİ ---
    8: "S Sport",                  // İspanya La Liga
    73: "Tivibu Spor",             // İspanya Copa del Rey

    // --- ALMANYA, İTALYA, FRANSA ---
    35: "beIN Sports",             // Almanya Bundesliga
    19: "Tivibu / TRT Spor",       // Almanya Bundesliga 2
    23: "S Sport",                 // İtalya Serie A
    34: "beIN Sports",             // Fransa Ligue 1

    // --- DİĞER ELİT LİGLER ---
    238: "Tivibu Spor / Spor Smart", // Portekiz Liga Portugal
    170: "S Sport / TV+",            // Suudi Arabistan Pro Lig

    // --- AVRUPA KUPALARI & MİLLİ MAÇLAR ---
    7: "TRT / Tabii",              // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",              // UEFA Avrupa Ligi
    848: "TRT / Tabii",            // UEFA Konferans Ligi (Eski ID)
    17015: "TRT / Tabii",          // UEFA Konferans Ligi (Yeni ID)
    1819: "TRT / Tabii / TV8",     // UEFA Uluslar Ligi (Nations League)
    7544: "TRT / Tabii",           // Dünya Kupası Avrupa Elemeleri
    4656: "TRT / Tabii"            // Avrupa Şampiyonası Elemeleri
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Katı ID Filtresi Aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); // Türkiye saati
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

                    // 1. EĞER ID BİZİM LİSTEDE YOKSA DİREKT AT
                    if (!targetLeagueIds.includes(utId)) return false;

                    // 2. GÜVENLİK SİGORTASI: SofaScore yanlışlıkla ID 848'i Hindistan'a verirse diye koruma
                    if (tName.includes("india") || tName.includes("women") || tName.includes("u19")) return false;

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
        
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // Benzersiz anahtar (Tarih + Ev Sahibi + Deplasman)
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;

        if (duplicateTracker.has(matchKey)) {
            continue;
        }

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId], // Yayıncıyı direkt listeden çekiyor
            homeTeam: { 
                name: e.homeTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: FOOTBALL_TEAM_LOGO_BASE + e.awayTeam.id + ".png" 
            },
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey); 
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    const jsonOutput = { success: true, lastUpdated: new Date().toISOString(), matches: finalMatches };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} benzersiz ve onaylı maç kaydedildi.`);
    await browser.close();
}

start();