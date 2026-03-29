const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const OUTPUT_FILE = "matches_football.json";

async function start() {
    console.log("⚽ Futbol motoru başlatılıyor (Tüm Maçlar Modu + Skor Koruması)...");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    // Resim ve gereksiz dosyaları engelle (Hız için önemli)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const getTRDate = (offset = 0) => {
        const d = new Date();
        d.setHours(d.getHours() + 3); 
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
    };

    let rawEvents = [];
    const dates = [getTRDate(-1), getTRDate(0), getTRDate(1)];

    // 1. Verileri Çek
    for (const date of dates) {
        try {
            console.log(`⏳ ${date} listesi çekiliyor...`);
            await page.goto(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, { waitUntil: 'networkidle2' });
            
            const data = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
            });

            if (data && data.events) {
                rawEvents = rawEvents.concat(data.events);
            }
        } catch (e) {
            console.error(`❌ ${date} hatası:`, e.message);
        }
    }

    // 2. Tekilleştirme (Aynı maçın farklı tarihlerde tekrar gelmesini engeller)
    const uniqueEventsMap = new Map();
    rawEvents.forEach(e => {
        uniqueEventsMap.set(e.id, e);
    });

    // 3. Veriyi İşle
    const finalMatches = Array.from(uniqueEventsMap.values()).map(e => {
        const dateTR = new Date(e.startTimestamp * 1000);
        const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
        
        // MAÇ BİTTİ Mİ? (Skor sadece bittiğinde görünecek)
        const isFinished = e.status?.type === 'finished';
        
        // Turnuva ID'si (Logo için)
        const tId = e.tournament?.uniqueTournament?.id || e.tournament?.category?.id || "default";

        return {
            id: e.id,
            fixedDate: dayStr,
            fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
            timestamp: dateTR.getTime(),
            tournament: e.tournament.name,
            tournamentLogo: `https://api.sofascore.com/api/v1/unique-tournament/${tId}/image`,
            
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

            // Skor Kontrolü: Sadece resmen bitmişse skor yaz, aksi halde "-"
            homeScore: isFinished ? String(e.homeScore?.display ?? "0") : "-",
            awayScore: isFinished ? String(e.awayScore?.display ?? "0") : "-"
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

    console.log(`\n✅ İşlem Tamam: ${finalMatches.length} maç kaydedildi.`);
    await browser.close();
}

start();