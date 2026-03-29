const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_football.json";

// Takip ettiğin önemli liglerin ID'leri (Süper Lig, PL, CL, LaLiga vb.)
const targetCategoryIds = [7, 52, 17, 8, 35, 23, 34, 1465, 1470]; 

async function start() {
    console.log("⚽ Futbol motoru başlatılıyor (Skor Koruması: Sadece Bitmiş Maçlar)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Tarih ayarları (Dün, Bugün, Yarın)
    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); // TR Saati
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let allEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];

    for (const date of dates) {
        try {
            console.log(`⏳ ${date} futbol takvimi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
            });

            if (data && data.events) {
                // Sadece belirlediğin ligleri filtrele
                const filtered = data.events.filter(e => targetCategoryIds.includes(e.tournament?.uniqueTournament?.id || e.tournament?.category?.id));
                allEvents = allEvents.concat(filtered);
            }
        } catch (e) {
            console.error(`❌ ${date} hatası:`, e.message);
        }
    }

    const finalMatches = allEvents.map(e => {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // --- KRİTİK SKOR MANTIĞI ---
        // Maçın statüsü "finished" değilse skorlara "-" basıyoruz.
        // Bu sayede 17:00 maçının 18:07'deki ara skoru kullanıcıyı yanıltmaz.
        const isFinished = e.status?.type === 'finished';
        
        return {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            tournament: e.tournament.name,
            tournamentLogo: `https://api.sofascore.com/api/v1/unique-tournament/${e.tournament?.uniqueTournament?.id}/image`, // Master script bunu kontrol edecek
            
            matchStatus: {
                type: e.status?.type || "notstarted",
                description: e.status?.description || "-"
            },

            homeTeam: { 
                name: e.homeTeam.name, 
                logo: `https://api.sofascore.com/api/v1/team/${e.homeTeam.id}/image` 
            },
            awayTeam: { 
                name: e.awayTeam.name, 
                logo: `https://api.sofascore.com/api/v1/team/${e.awayTeam.id}/image` 
            },

            // Eğer maç bittiyse gerçek skoru yaz, bitmediyse (canlıysa bile) "-" yaz.
            homeScore: isFinished ? String(e.homeScore?.display || "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display || "0") : "-"
        };
    });

    // Zaman sıralaması
    finalMatches.sort((a, b) => a.timestamp - b.timestamp);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalMatches: finalMatches.length,
        matches: finalMatches 
    }, null, 2));

    console.log(`\n✅ ${finalMatches.length} maç kaydedildi. Skor koruması aktif.`);
    await browser.close();
}

start();
