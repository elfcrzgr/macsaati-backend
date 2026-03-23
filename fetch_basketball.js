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
    // --- AMERİKA ---
    3547: "S Sport / NBA TV",           // NBA
    9357: "S Sport Plus",               // NCAA

    // --- AVRUPA KUPALARI ---
    138: "S Sport / S Sport Plus",      // EuroLeague
    142: "S Sport Plus",                // EuroCup
    137: "TRT Spor / Tabii",            // FIBA Şampiyonlar Ligi
    168: "TRT Spor Yıldız",             // Euroleague Kadınlar
    167: "S Sport Plus / FIBA TV",      // FIBA Europe Cup

    // --- TÜRKİYE LİGLERİ ---
    132: "beIN Sports 5",               // Basketbol Süper Ligi (BSL)
    139: "beIN Sports / TRT Spor",      // Kadınlar Basketbol Süper Ligi (KBSL)
    11511: "TRT Spor Yıldız / TBF TV",  // Basketbol 1. Ligi (TBL)
    21511: "TBF TV (YouTube)",          // Basketbol 2. Ligi (TB2L)

    // --- AVRUPA YEREL LİGLERİ ---
    251: "S Sport Plus",                // İspanya Liga Endesa
    215: "S Sport Plus",                // İtalya Lega Basket A
    304: "S Sport Plus",                // Yunanistan Basket Ligi
    227: "beIN Sports",                 // Almanya BBL
    164: "beIN Sports",                 // Fransa LNB Pro A
    235: "S Sport Plus",                // ABA League
    405: "beIN Sports"                  // VTB United League
};

const targetLeagueIds = Object.keys(leagueConfigs).map(Number);

async function start() {
    console.log("🏀 Basketbol motoru başlatılıyor (NBA Klasör Ayrımı & Gece Maçı Koruması Aktif)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Türkiye Saati ayarı
    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    const trToday = getTRDate(0);
    const trTomorrow = getTRDate(1);

    let allEvents = [];
    
    // NBA sarkan maçları için dünü tara, ama filtrede sadece bugün/yarın olanları alacağız
    for (const date of [getTRDate(-1), trToday, trTomorrow]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/basketball/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
            });

            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const utId = e.tournament?.uniqueTournament?.id;
                    // SADECE LİSTEDE OLAN ID'LER GEÇEBİLİR
                    return targetLeagueIds.includes(utId); 
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} hatası:`, e.message); }
    }

    const finalMatches = [];
    const duplicateTracker = new Set();

    for (const e of allEvents) {
        const utId = e.tournament?.uniqueTournament?.id;
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // --- KRİTİK FİLTRE: Dünden gelen eski maçları ekrana basma ---
        if (dayStr !== trToday && dayStr !== trTomorrow) continue;

        const matchKey = `${dayStr}_${e.homeTeam.name}_${e.awayTeam.name}_${utId}`;
        if (duplicateTracker.has(matchKey)) continue;

        // --- NBA KONTROLÜ (Klasör ayrımı için) ---
        const isNBA = (utId === 3547);

        finalMatches.push({
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            broadcaster: leagueConfigs[utId], 
            homeTeam: { 
                name: e.homeTeam.name, 
                // Eğer maç NBA ise araya NBA/ klasörünü ekle
                logo: BASKETBALL_TEAM_LOGO_BASE + (isNBA ? "NBA/" : "") + e.homeTeam.id + ".png" 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                // Aynı şekilde deplasman takımı için de
                logo: BASKETBALL_TEAM_LOGO_BASE + (isNBA ? "NBA/" : "") + e.awayTeam.id + ".png" 
            },
            tournamentLogo: BASKETBALL_TOURNAMENT_LOGO_BASE + utId + ".png",
            homeScore: (e.homeScore?.display !== undefined) ? String(e.homeScore.display) : "-",
            awayScore: (e.awayScore?.display !== undefined) ? String(e.awayScore.display) : "-",
            tournament: e.tournament?.uniqueTournament?.name || "Basketbol"
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
    
    console.log(`\n✅ İşlem tamam. Toplam ${finalMatches.length} elit basketbol maçı kaydedildi.`);
    await browser.close();
}

start();