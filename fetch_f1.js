const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 

// Senin oluşturduğun klasör yapısına uygun GitHub raw linkleri
const F1_LOGO_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/logos/`;
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const OUTPUT_FILE = "matches_f1.json";

async function start() {
    console.log("🏎️ Formula 1 motoru başlatılıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    
    // F1 hafta sonu uzun sürdüğü için Dün, Bugün, Yarın ve Ertesi Günü tarıyoruz
    for (const date of [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)]) { 
        try {
            console.log(`⏳ ${date} listesi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/motorsport/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
            
            if (data && data.events) {
                // Sadece Formula 1 etkinliklerini filtrele
                const f1Events = data.events.filter(e => 
                    e.tournament?.uniqueTournament?.name?.includes("Formula 1")
                );
                allEvents = allEvents.concat(f1Events);
            }
        } catch (e) { console.error(`${date} hatası:`, e.message); }
    }

    const finalEvents = [];
    const uniqueEventsMap = new Map();

    for (const e of allEvents) {
        if (!uniqueEventsMap.has(e.id)) {
            uniqueEventsMap.set(e.id, true);

            const dateTR = new Date(e.startTimestamp * 1000);
            const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            
            // F1'de spesifik Grand Prix'nin ID'si
            const tId = e.tournament?.id || "default";

            finalEvents.push({
                id: e.id,
                fixedDate: dayStr,
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                timestamp: dateTR.getTime(),
                broadcaster: "beIN Sports", // Türkiye F1 Ana Yayıncısı
                
                grandPrix: e.tournament?.name || "Formula 1 Grand Prix", 
                sessionName: e.name || "Yarış", // Örn: "Practice 1", "Qualifying", "Race"
                
                matchStatus: {
                    type: e.status?.type || "notstarted",
                    description: e.status?.description || "-",
                    code: e.status?.code || 0
                },

                // Turnuva (GP/Pist) logosu yolu
                tournamentLogo: F1_TOURNAMENT_BASE + tId + ".png",
                
                // Eğer ileride takım/pilot logosu eklemek istersen f1/logos klasörü için hazır alan
                placeholderLogo: F1_LOGO_BASE + "default.png" 
            });
        }
    }

    // Zamana göre sırala
    finalEvents.sort((a, b) => a.timestamp - b.timestamp);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalSessions: finalEvents.length,
        events: finalEvents 
    }, null, 2));
    
    console.log(`\n✅ ${finalEvents.length} adet F1 seansı başarıyla yazıldı!`);
    await browser.close();
}

start();

