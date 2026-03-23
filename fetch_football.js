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
function getBroadcaster(tournamentName, utId) {
    const name = tournamentName.toLowerCase();
    
    // 1. Şampiyonlar Ligi, Avrupa Ligi, Konferans Ligi
    if (name.includes("champions league") || name.includes("europa league") || name.includes("conference league")) return "TRT / Tabii";
    
    // 2. Türkiye Ligleri
    if (name.includes("süper lig")) return "beIN Sports";
    if (name.includes("1. lig")) return "beIN Sports / TRT Spor";
    if (name.includes("tff 2") || name.includes("kadınlar futbol")) return "TRT Spor / Tabii";
    
    // 3. Avrupa Büyük Ligleri
    if (name.includes("premier league")) return "beIN Sports";
    if (name.includes("laliga") || name.includes("la liga")) return "S Sport";
    if (name.includes("serie a")) return "S Sport";
    if (name.includes("bundesliga")) return "beIN Sports";
    if (name.includes("ligue 1")) return "beIN Sports";
    
    // 4. Kupalar ve Elemeler
    if (name.includes("fa cup")) return "beIN Sports / Tivibu";
    if (name.includes("world cup qual") || name.includes("euro qual") || name.includes("avrupa şampiyonasi elemeleri")) return "TRT / Tabii";
    
    // 5. Diğerleri (Genişletilebilir)
    if (name.includes("usl championship") || name.includes("serie a") && name.includes("brazil")) return "S Sport Plus";

    // Fallback: Eğer hiçbir anahtar kelime tutmazsa ama ID tanıdıksa listeden al (Yedek Sistem)
    const leagueConfigs = { 481: "Spor Smart", 709: "CBC Sport" };
    return leagueConfigs[utId] || "Yerel Yayın";
}

async function start() {
    console.log("🚀 Futbol motoru başlatılıyor (ID Bağımsız Metin Filtresi Aktif)...");
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
    // 2 günlük veri çekiyoruz
    for (const date of [getTRDate(0), getTRDate(1)]) {
        try {
            console.log(`⏳ ${date} verisi SofaScore'dan çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (data && data.events) {
                // --- KRİTİK FİLTRELEME ---
                const filtered = data.events.filter(e => {
                    const tName = (e.tournament?.uniqueTournament?.name || e.tournament?.name || "").toLowerCase();
                    
                    // İstemediğimiz ligleri (Hindistan vb.) burada eliyoruz
                    const isForbidden = tName.includes("india") || tName.includes("i-league") || tName.includes("mizoram");
                    
                    // Sadece tanıdığımız popüler kelimeler geçiyorsa listeye al
                    const isTarget = tName.includes("league") || tName.includes("lig") || tName.includes("cup") || 
                                     tName.includes("la liga") || tName.includes("serie a") || tName.includes("bundesliga");

                    return isTarget && !isForbidden;
                });
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) { console.error(`${date} tarihinde hata oluştu:`, e.message); }
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
            broadcaster: getBroadcaster(tName, utId), // Zeki fonksiyon devrede
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
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ success: true, lastUpdated: new Date().toISOString(), matches: finalMatches }, null, 2));
    
    console.log(`\n✅ İşlem bitti! ${finalMatches.length} kaliteli maç kaydedildi.`);
    await browser.close();
}

start();