const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const GITHUB_USER = "elfcrzgr"; 
const REPO_NAME = "macsaati-backend"; 
const F1_TOURNAMENT_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main/f1/tournament_logos/`;
const OUTPUT_FILE = "matches_f1.json";

async function start() {
    console.log("🏎️ Formula 1 motoru: Sayfa İçi Derin Veri (Next.js) Tarama Başlıyor...");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let allEvents = [];

    try {
        console.log("⏳ Sofascore F1 kategori sayfasına gidiliyor...");
        // API'ye değil, doğrudan kullanıcı sayfasına gidiyoruz
        await page.goto('https://www.sofascore.com/motorsport/category/formula-1/40', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Sayfanın içindeki gizli __NEXT_DATA__ JSON'unu çekiyoruz. Bütün veriler burada şifresiz durur.
        const nextData = await page.evaluate(() => {
            const script = document.getElementById('__NEXT_DATA__');
            if (script) {
                return JSON.parse(script.innerText);
            }
            return null;
        });

        if (nextData) {
            console.log("✅ Sayfa verileri yakalandı, seanslar ayıklanıyor...");
            
            // Tüm JSON ağacını tarayıp sadece F1 etkinliklerini bulan Özyineli (Recursive) Fonksiyon
            function findEvents(obj) {
                let results = [];
                if (typeof obj === 'object' && obj !== null) {
                    if (Array.isArray(obj)) {
                        for (let item of obj) {
                            results = results.concat(findEvents(item));
                        }
                    } else {
                        // Eğer bu obje bir F1 etkinliğiyse (id, startTimestamp ve kategori id 40 ise)
                        if (obj.id && obj.startTimestamp && obj.tournament && obj.tournament.category && obj.tournament.category.id === 40) {
                            results.push(obj);
                        }
                        // Alt objelere doğru inmeye devam et
                        for (let key in obj) {
                            results = results.concat(findEvents(obj[key]));
                        }
                    }
                }
                return results;
            }

            allEvents = findEvents(nextData);
        } else {
            console.log("⚠️ __NEXT_DATA__ bulunamadı!");
        }
    } catch (e) {
        console.error("❌ Sayfa yüklenirken hata oluştu:", e.message);
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

    // Tarih ve saate göre sırala
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
