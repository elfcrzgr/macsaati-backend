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
    52: "beIN Sports",             // Trendyol Süper Lig (Trabzon-GS, FB-BJK maçları)
    98: "beIN Sports / TRT Spor",  // Trendyol 1. Lig (Adana Demir, Sakarya vb.)
    13363: "TRT Spor / Tabii",     // TFF 2. Lig / Kadınlar Futbol Ligi (BJK-GS derbisi)

    // --- MİLLİ MAÇLAR & ELEMELER ---
    7544: "TRT / Tabii",           // 2026 Dünya Kupası Avrupa Elemeleri (Türkiye-Romanya vb.)
    48: "TRT Spor / Tabii",        // UEFA U19 Avrupa Şampiyonası Elemeleri
    12: "TRT Spor / S Sport",      // Hazırlık Maçları (İsviçre-Almanya vb.)

    // --- AVRUPA KUPALARI ---
    7: "TRT / Tabii",              // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",              // UEFA Avrupa Ligi
    848: "TRT / Tabii",            // UEFA Konferans Ligi
    17015: "TRT Spor / Tabii",     // UEFA Kadınlar Şampiyonlar Ligi (Real-Barça, Arsenal-Chelsea)

    // --- AVRUPA LİGLERİ ---
    17: "beIN Sports",             // İngiltere Premier League
    8: "S Sport",                  // İspanya La Liga (Atletico-Barça, Mallorca-Real)
    54: "S Sport Plus",            // İspanya La Liga 2 (Malaga-Leganes vb.)
    23: "S Sport",                 // İtalya Serie A (Inter-Roma, Napoli-Milan)
    35: "beIN Sports",             // Almanya Bundesliga (Bayer Leverkusen-Wolfsburg)
    34: "beIN Sports",             // Fransa Ligue 1 (PSG-Toulouse, Monaco-Marsilya)
    19: "Tivibu / TRT Spor",       // Almanya Bundesliga 2
    41: "beIN Sports / Tivibu",    // İngiltere FA Cup (Man City-Liverpool)

    // --- DİĞER LİGLER ---
    481: "Spor Smart / D-Smart",   // Arjantin Ligi (Boca Juniors maçı)
    325: "S Sport Plus",           // Brezilya Serie A (Corinthians-Flamengo)
    134: "S Sport Plus",           // ABD USL Championship (Lexington, Miami vb.)
    709: "CBC Sport / Yerel"       // Azerbaycan Premier Ligi
};
const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Mükerrer kontrolü aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
        } catch (e) { console.error(`${date} hatası.`); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set(); // Benzersizlik kontrolü için

    for (const e of allEvents) {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // --- KRİTİK NOKTA: Benzersiz bir anahtar oluşturuyoruz ---
        // Örn: "2026-03-17_Fenerbahçe_Beşiktaş"
        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}`;

        // Eğer bu maç (aynı gün, aynı takımlar) zaten eklenmişse pas geç
        if (duplicateTracker.has(matchKey)) {
            console.log(`⚠️ Çift kayıt engellendi: ${matchKey}`);
            continue;
        }

        const matchObject = {
            id: e.id,
            fixedDate: dayStr,
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
            tournamentLogo: FOOTBALL_TOURNAMENT_LOGO_BASE + e.tournament.uniqueTournament.id + ".png",
            homeScore: (e.homeScore && e.homeScore.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore && e.awayScore.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament.uniqueTournament.name
        };

        finalMatches.push(matchObject);
        duplicateTracker.add(matchKey); // Maçı anahtarıyla beraber sete ekle
    }

    finalMatches.sort((a, b) => a.timestamp - b.timestamp);
    const jsonOutput = { success: true, lastUpdated: new Date().toISOString(), matches: finalMatches };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`✅ İşlem tamam. Toplam ${finalMatches.length} benzersiz maç kaydedildi.`);
    await browser.close();
}

start();