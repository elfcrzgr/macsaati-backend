const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const OUTPUT_FILE = "matches_f1.json";

async function start() {
    console.log("🏎️ Formula 1 motoru başlatılıyor (Kategori Odaklı - ID: 40)...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let allEvents = [];

    try {
        console.log(`📡 F1 Turnuva verileri çekiliyor...`);
        
        // YÖNTEM 1: Doğrudan F1 Özel Turnuva API'si (F1 Unique Tournament ID genelde 12473'tür)
        // Bu endpoint doğrudan "Sıradaki (Next)" yarışları getirir, tarih aramaya gerek kalmaz.
        await page.goto('https://api.sofascore.com/api/v1/unique-tournament/12473/events/next/0', { waitUntil: 'networkidle2' });
        let data = await page.evaluate(() => { try { return JSON.parse(document.body.innerText); } catch(e) { return null; } });
        
        if (data && data.events) {
            allEvents = data.events;
            console.log(`✅ Veri API'den başarıyla çekildi.`);
        }

        // YÖNTEM 2: Eğer API boş dönerse, SENİN VERDİĞİN URL'ye gidip sayfadaki verileri yakalayalım
        if (allEvents.length === 0) {
            console.log("⚠️ API boş döndü, paylaştığın Kategori sayfasına gidilip veriler ayıklanıyor...");
            
            // Sofascore'un arka planda attığı istekleri dinle
            page.on('response', async (response) => {
                const resUrl = response.url();
                if (resUrl.includes('api.sofascore.com') && resUrl.includes('/events')) {
                    try {
                        const json = await response.json();
                        if (json && json.events) {
                            allEvents = allEvents.concat(json.events);
                        }
                    } catch (e) {}
                }
            });

            // Senin paylaştığın kategori linki
            await page.goto('https://www.sofascore.com/motorsport/category/formula-1/40', { waitUntil: 'networkidle2', timeout: 15000 });
            await new Promise(r => setTimeout(r, 3000)); // Verilerin gelmesi için biraz bekle
        }

    } catch (e) {
        console.error(`❌ Hata oluştu:`, e.message);
    }

    // 2. ADIM: DEDUPLİKASYON VE FORMATLAMA
    const finalEvents = [];
    const uniqueEventsMap = new Map();

    for (const e of allEvents) {
        // Sadece Formula 1 (Kategori ID: 40) olanları al
        if ((e.tournament?.category?.id === 40 || e.tournament?.uniqueTournament?.name?.includes("Formula 1")) && !uniqueEventsMap.has(e.id)) {
            uniqueEventsMap.set(e.id, true);

            const dateTR = new Date(e.startTimestamp * 1000);
            const dayStr = dateTR.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
            const tId = e.tournament?.id || "default";

            finalEvents.push({
                id: e.id,
                fixedDate: dayStr,
                fixedTime: dateTR.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
                timestamp: dateTR.getTime(),
                broadcaster: "beIN Sports", // Türkiye Yayıncısı
                
                grandPrix: e.tournament?.name || "Formula 1 Grand Prix", 
                sessionName: e.name || "Yarış", 
                
                matchStatus: {
                    type: e.status?.type || "notstarted",
                    description: e.status?.description || "-",
                    code: e.status?.code || 0
                },

                tournamentLogo: F1_TOURNAMENT_BASE + tId + ".png"
            });
        }
    }

    // Tarihe göre sırala
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
