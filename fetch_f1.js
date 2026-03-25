const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const OUTPUT_FILE = "matches_f1.json";

async function start() {
    console.log("🏎️ Formula 1 motoru: 30 Günlük Geniş Tarama Başlıyor...");
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
    
    console.log("📅 Dün ve önümüzdeki 30 gün taranıyor, F1 hafta sonu aranıyor...");
    
    // -1 (Dün) ile 30 gün sonrasını tara
    for (let i = -1; i <= 30; i++) {
        const targetDate = getTRDate(i);
        try {
            // Hızlı geçiş için domcontentloaded kullanıyoruz
            await page.goto(`https://api.sofascore.com/api/v1/sport/motorsport/scheduled-events/${targetDate}`, { waitUntil: 'domcontentloaded' });
            
            const data = await page.evaluate(() => { 
                try { return JSON.parse(document.body.innerText); } catch(e) { return null; } 
            });
            
            if (data && data.events) {
                // Kategori ID'si 40 olanları (Formula 1) filtrele
                const f1Events = data.events.filter(e => e.tournament?.category?.id === 40);
                if (f1Events.length > 0) {
                    console.log(`✅ ${targetDate} tarihinde ${f1Events.length} adet F1 seansı bulundu!`);
                    allEvents = allEvents.concat(f1Events);
                }
            }
        } catch (e) {
            // Hata olursa sessizce diğer güne geç
        }
    }

    if (allEvents.length === 0) {
        console.log("⚠️ 30 günlük taramada sonuç bulunamadı. API yanıt vermiyor olabilir.");
    }

    const finalEvents = [];
    const uniqueEventsMap = new Map();

    for (const e of allEvents) {
        if (!uniqueEventsMap.has(e.id)) {
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
                sessionName: e.name || "Seans", 
                
                matchStatus: {
                    type: e.status?.type || "notstarted",
                    description: e.status?.description || "-",
                    code: e.status?.code || 0
                },

                tournamentLogo: F1_TOURNAMENT_BASE + tId + ".png"
            });
        }
    }

    finalEvents.sort((a, b) => a.timestamp - b.timestamp);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ 
        success: true, 
        lastUpdated: new Date().toISOString(), 
        totalSessions: finalEvents.length,
        events: finalEvents 
    }, null, 2));
    
    console.log(`\n🏁 Toplam ${finalEvents.length} adet F1 seansı başarıyla JSON'a yazıldı!`);
    await browser.close();
}

start();
