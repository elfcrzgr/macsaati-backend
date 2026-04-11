const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_tennis.json";
const TENNIS_LOGO_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/logos/`;
const TENNIS_TOURNAMENT_BASE = `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/tennis/tournament_logos/`;

// Sadece Monte Carlo Masters ID'si
const MONTE_CARLO_ID = 2391; 

async function start() {
    console.log("🎾 Monte Carlo Odaklı Motor Başlatıldı...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Bursa/TR saatiyle tarihleri alalım
    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    };

    const targetDates = [getTRDate(0), getTRDate(1), getTRDate(2)]; // Bugün, Yarın (12 Nis), Yarından Sonra
    console.log("📡 Hedeflenen Tarihler:", targetDates);

    let monteCarloEvents = [];

    try {
        console.log(`📡 Monte Carlo (ID: ${MONTE_CARLO_ID}) özel olarak sorgulanıyor...`);
        
        // 1. ADIM: Sezon ID'sini al
        await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${MONTE_CARLO_ID}/seasons`, { waitUntil: 'networkidle2' });
        const seasonsData = await page.evaluate(() => JSON.parse(document.body.innerText));
        
        if (seasonsData?.seasons?.length > 0) {
            const currentSeasonId = seasonsData.seasons[0].id;
            
            // 2. ADIM: Turnuvanın "Gelecek Maçlar" (next/0) listesini zorla çek
            // Bu API, günlük programda görünmeyen "Winner of..." maçlarını da verir.
            await page.goto(`https://api.sofascore.com/api/v1/unique-tournament/${MONTE_CARLO_ID}/season/${currentSeasonId}/events/next/0`, { waitUntil: 'networkidle2' });
            const eventsData = await page.evaluate(() => JSON.parse(document.body.innerText));
            
            if (eventsData?.events) {
                monteCarloEvents = eventsData.events;
            }
        }
    } catch (e) {
        console.error("❌ Monte Carlo verisi çekilirken hata:", e.message);
    }

    const finalMatches = [];

    for (const e of monteCarloEvents) {
        const startTimestamp = e.startTimestamp * 1000;
        const dateTR = new Date(startTimestamp);
        const fixedDate = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

        // Sadece 11, 12 ve 13 Nisan maçlarını alalım
        if (!targetDates.includes(fixedDate)) continue;

        const statusType = e.status?.type;
        let timeString = dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
        
        if (statusType === 'inprogress') timeString += "\nCANLI";
        else if (statusType === 'finished') timeString += "\nMS";

        // Rakipler belli değilse 'Winner of...' isimlerini Sofascore'dan geldiği gibi alır
        const homeName = e.homeTeam.name;
        const awayName = e.awayTeam.name;

        finalMatches.push({
            id: e.id,
            isElite: true, // Monte Carlo olduğu için direkt elit işaretledik
            status: statusType,
            fixedDate: fixedDate,
            fixedTime: timeString,
            timestamp: startTimestamp,
            broadcaster: "S Sport / S Sport Plus",
            homeTeam: { 
                name: homeName, 
                logos: [TENNIS_LOGO_BASE + (e.homeTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            awayTeam: { 
                name: awayName, 
                logos: [TENNIS_LOGO_BASE + (e.awayTeam.country?.alpha2?.toLowerCase() || "default") + ".png"] 
            },
            tournamentLogo: TENNIS_TOURNAMENT_BASE + MONTE_CARLO_ID + ".png",
            homeScore: statusType === 'notstarted' ? "-" : String(e.homeScore?.display ?? "0"),
            awayScore: statusType === 'notstarted' ? "-" : String(e.awayScore?.display ?? "0"),
            tournament: "Monte Carlo, Monaco"
        });
    }

    // Zamana göre sırala
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));
    
    await browser.close();
    console.log(`✅ İşlem bitti. Monte Carlo'dan ${finalMatches.length} maç JSON'a eklendi.`);
}

start();
