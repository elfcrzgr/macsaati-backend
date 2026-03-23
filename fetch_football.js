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
    // --- TÜRKİYE ---
    52: "beIN Sports",           // Trendyol Süper Lig
    98: "beIn Sports / TRT Spor", // Trendyol 1. Lig
    13363: "TRT Spor / Tabii",    // TFF 2. Lig (Play-off ve özel maçlar)

    // --- AVRUPA KUPALARI (YENİ HAKLAR: TRT) ---
    7: "TRT / Tabii",            // UEFA Şampiyonlar Ligi
    3: "TRT / Tabii",            // UEFA Avrupa Ligi
    848: "TRT / Tabii",           // UEFA Konferans Ligi
    679: "TRT / Tabii",           // UEFA Süper Kupa
    17015: "TRT / Tabii",         // UEFA Kadınlar ŞL

    // --- AVRUPA LİGLERİ ---
    17: "beIN Sports",           // Premier League (İngiltere)
    8: "S Sport",                // La Liga (İspanya)
    23: "S Sport",                // Serie A (İtalya)
    35: "beIN Sports",           // Bundesliga (Almanya)
    34: "beIN Sports",           // Ligue 1 (Fransa)
    37: "S Sport Plus",          // Eredivisie (Hollanda - Yayıncı değişebiliyor)
    238: "D-Smart / Spor Smart", // Liga Portugal (Portekiz)
    
    // --- DİĞER ---
    19: "Tivibu Spor",           // Bundesliga (Bazen beIN ile ortak/alt lisans)
    481: "D-Smart / Spor Smart", // Arjantin Ligi
    325: "S Sport Plus",         // Suudi Arabistan Ligi
    155: "S Sport Plus",         // Copa Libertadores
    44: "Tivibu Spor",           // İskoçya Premier
    955: "beIN Sports",          // Yunanistan Ligi
    709: "CBC Sport / Yerel"     // Azerbaycan Ligi
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