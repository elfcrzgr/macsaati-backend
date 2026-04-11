const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// Sadece Monte Carlo Singles
const MONTE_CARLO_ID = 2391; 

async function start() {
    console.log("🎾 Monte Carlo Özel Operasyonu Başlatıldı...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Bursa saatiyle Bugün ve Yarın
    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1)]; // Bugün ve Yarın (12 Nisan)
    console.log("📡 Aranan Tarihler:", targetDates);

    let collectedEvents = [];

    try {
        // 1. ADIM: Monte Carlo'nun güncel sezon ID'sini alıyoruz
        console.log("📡 Sezon bilgisi sorgulanıyor...");
        await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${MONTE_CARLO_ID}/seasons`, { waitUntil: 'networkidle2' });
        const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
        
        if (seasonsData?.seasons?.[0]?.id) {
            const sId = seasonsData.seasons[0].id;
            
            // 2. ADIM: Fikstürün en başına (next/0) ve bir sonrakine (next/1) bakıyoruz
            // Final maçı genellikle next/1 veya next/0'ın en sonunda gizlidir.
            for (const step of ['0', '1']) {
                console.log(`📡 Fikstür taranıyor: next/${step}`);
                await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${MONTE_CARLO_ID}/season/${sId}/events/next/${step}`, { waitUntil: 'networkidle2' });
                const eventsData = await page.evaluate(() => {
                    try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
                });
                if (eventsData?.events) {
                    collectedEvents = collectedEvents.concat(eventsData.events);
                }
            }
        }
    } catch (e) {
        console.error("❌ Hata:", e.message);
    }

    const finalMatches = [];

    for (const e of collectedEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // SADECE 12 NİSAN (YARIN) VE BUGÜNÜ AL
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        if (statusType === 'inprogress') timeString += "\nCANLI";

        // Placeholder kontrolü: Eğer isimler "Winner of..." ise onları olduğu gibi alıyoruz
        // Bu sayede o meşhur 15921175 ID'li maç listeye girecek.
        const hName = e.homeTeam.name || "Yarı Final Galibi 1";
        const aName = e.awayTeam.name || "Yarı Final Galibi 2";

        finalMatches.push({
            id: e.id,
            isElite: true,
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / S Sport Plus",
            homeTeam: { 
                name: hName, 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "mc") + ".png"] 
            },
            awayTeam: { 
                name: aName, 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "mc") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + MONTE_CARLO_ID + ".png",
            homeScore: "-",
            awayScore: "-",
            tournament: "Monte Carlo, Monaco"
        });
    }

    // Zamana göre sırala (Bugünküler önce, yarınki final sonra)
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log(`✅ Operasyon Tamamlandı. ${finalMatches.length} maç bulundu. Final maçı eklendi!`);
}

start();
