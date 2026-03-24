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
    97: "TFF YouTube",             // TFF 2. Lig (Ana ID)
    11417: "TFF YouTube",          // TFF 3. Lig 1. Grup
    11416: "TFF YouTube",          // TFF 3. Lig 2. Grup
    11415: "TFF YouTube",          // TFF 3. Lig 3. Grup
    15938: "TFF YouTube",          // TFF 3. Lig 4. Grup

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
    238: "Tivibu Spor / Spor Smart", // Portekiz Liga Portugal
    170: "S Sport / TV+",            // Suudi Arabistan Pro Lig
    13363: "USL YouTube",            // ABD USL Championship

    // --- AVRUPA VE MİLLİ MAÇLAR ---
    7: "TRT / Tabii",              // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",              // UEFA Avrupa Ligi
    17015: "TRT / Tabii",          // UEFA Konferans Ligi (Güncel ID)
    1819: "TRT / Tabii / TV8",     // UEFA Uluslar Ligi
    7544: "TRT / Tabii",           // Dünya Kupası Elemeleri
    4656: "TRT / Tabii",           // Avrupa Şampiyonası Elemeleri
    696: "DAZN / YouTube"          // UEFA Kadınlar Şampiyonlar Ligi
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Kaçak Lig Radarı Aktif)...");
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
                
                // --- 🕵️ KAÇAK LİG RADARI BAŞLANGICI ---
                data.events.forEach(e => {
                    const categoryName = e.tournament?.category?.name;
                    
                    // Sadece Türkiye kategorisindeki maçları kontrol et
                    if (categoryName === "Turkey" || categoryName === "Türkiye") {
                        const utId = e.tournament?.uniqueTournament?.id;
                        const tName = e.tournament?.uniqueTournament?.name;
                        
                        // Eğer maçın ID'si bizim "elit" listemizde yoksa terminale uyarı bas
                        if (!targetLeagueIds.includes(utId)) {
                            console.log(`🚨 EKSİK LİG YAKALANDI! -> Lig: ${tName} | ID: ${utId} | Maç: ${e.homeTeam.name} - ${e.awayTeam.name}`);
                        }
                    }
                });
                // --- 🕵️ KAÇAK LİG RADARI BİTİŞİ ---

                // Asıl filtreleme (Sadece senin listendekiler dosyaya yazılacak)
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    return targetLeagueIds.includes(utId);
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
            broadcaster: leagueConfigs[utId], 
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
    
    console.log(`\n✅ İşlem Tamamlandı. Hedeflenen maçlar dosyaya kaydedildi.`);
    await browser.close();
}

start();
