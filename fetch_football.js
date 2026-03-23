const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

const FOOTBALL_TEAM_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/logos/`;
const FOOTBALL_TOURNAMENT_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/football/tournament_logos/`;
const OUTPUT_FILE = "matches_football.json";

// --- 2026 GÜNCEL YAYINCI BELİRLEME FONKSİYONU ---
function getBroadcaster(tournamentName) {
    const name = tournamentName.toLowerCase();
    
    // 1. Avrupa Kupaları ve Milli Maçlar
    if (name.includes("champions league") || name.includes("europa league") || name.includes("conference league")) return "TRT / Tabii";
    if (name.includes("nations league")) return "TRT / Tabii / TV8";
    
    // 2. Türkiye (Karakter risksiz)
    if (name.includes("per lig") || name.includes("trendyol s")) return "beIN Sports";
    if (name.includes("1. lig") || name.includes("1.lig")) return "beIN Sports / TRT Spor";
    if (name.includes("kiye kupas")) return "A Spor / ATV";
    
    // 3. İngiltere
    if (name.includes("premier league")) return "beIN Sports";
    if (name.includes("championship")) return "beIN Sports";
    if (name.includes("fa cup")) return "TRT / Tabii";
    
    // 4. İspanya
    if (name.includes("laliga") || name.includes("la liga")) return "S Sport";
    if (name.includes("copa del rey")) return "Tivibu Spor";
    
    // 5. İtalya
    if (name.includes("serie a")) return "S Sport";
    
    // 6. Almanya
    if (name.includes("2. bundesliga") || name.includes("bundesliga 2")) return "Tivibu / TRT Spor";
    if (name.includes("bundesliga")) return "beIN Sports / Tivibu Spor";
    
    // 7. Fransa
    if (name.includes("ligue 1")) return "beIN Sports";
    
    // 8. Portekiz ve Arabistan
    if (name.includes("portugal") || name.includes("primeira liga")) return "Tivibu Spor / Spor Smart";
    if (name.includes("saudi")) return "S Sport / TV+";

    return "Yerel Yayın";
}

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (Sadece Elit Ligler & İsme Göre Filtre)...");
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
    
    // Bugün ve Yarının maçlarını çekiyoruz
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data && data.events) {
                const filtered = data.events.filter(e => {
                    const tName = (e.tournament?.uniqueTournament?.name || e.tournament?.name || "").toLowerCase();
                    const categoryName = (e.tournament?.category?.name || "").toLowerCase();
                    
                    // 1. KESİN YASAKLILAR (Kadınlar, Gençler ve Brezilya/Ekvador/Hindistan çakışmaları)
                    const isForbidden = tName.includes("women") || tName.includes("frauen") || tName.includes("femenina") ||
                                        tName.includes("u19") || tName.includes("u20") || tName.includes("u21") || 
                                        tName.includes("amateur") || tName.includes("reserve") ||
                                        categoryName.includes("brazil") || categoryName.includes("ecuador") || categoryName.includes("india");

                    // 2. TAM SENİN LİSTEN (Sadece bu kelimeleri içeren ligler kabul edilecek)
                    const whitelist = [
                        "bundesliga",            // Almanya 1 ve 2
                        "ligue 1",               // Fransa Lig 1
                        "premier league",        // İngiltere Premier Lig
                        "championship",          // İngiltere Championship
                        "laliga", "la liga",     // İspanya La Liga
                        "serie a",               // İtalya Serie A
                        "liga portugal", "primeira liga", // Portekiz Liga Nos
                        "saudi",                 // Suudi Arabistan
                        "trendyol", "per lig", "1. lig", "1.lig", // Türkiye Ligleri
                        "kiye kupas",            // Ziraat Türkiye Kupası
                        "champions league",      // UEFA Şampiyonlar Ligi
                        "europa league",         // UEFA Avrupa Ligi
                        "conference league",     // UEFA Konferans Ligi
                        "nations league",        // UEFA Uluslar Ligi
                        "fa cup",                // FA Cup
                        "copa del rey"           // İspanya Kral Kupası
                    ];

                    // Turnuva adında whitelist kelimelerinden BİRİ varsa kabul et
                    const isTarget = whitelist.some(word => tName.includes(word));

                    // Hedef listedeyse VE yasaklı listesinde DEĞİLSE listeye ekle
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
        
        // Mükerrer kontrolü (Aynı maçın iki kez eklenmesini önler)
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
    
    console.log(`\n✅ İşlem Tamamlandı. SADECE hedeflenen ${finalMatches.length} elit maç kaydedildi.`);
    await browser.close();
}

start();