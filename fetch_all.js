const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function start() {
    console.log("🔍 Teşhis Modu Başlatıldı...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--window-size=1920,1080'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Gerçekçi bir kimlik
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    try {
        console.log("🛡️ SofaScore'a gidiliyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });
        
        // 🚀 Burası kritik: Botun karşısına ne çıktığını görmek için ekran görüntüsü alıyoruz
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'debug_main.png' }); 
        console.log("📸 Ana sayfa ekran görüntüsü alındı: debug_main.png");

        // Futbol API denemesi
        const date = new Date().toISOString().split('T')[0];
        console.log(`📡 API denemesi yapılıyor: ${date}`);
        
        await page.goto(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`);
        await new Promise(r => setTimeout(r, 3000));
        
        const content = await page.evaluate(() => document.body.innerText);
        
        if (content.includes('{"events":')) {
            console.log("✅ BAŞARILI! Veri çekilebiliyor.");
            fs.writeFileSync('matches_football.json', content);
        } else {
            console.log("❌ VERİ YOK! Bot muhtemelen engellendi.");
            await page.screenshot({ path: 'debug_api_error.png' });
            console.log("📸 Hata anı görüntülendi: debug_api_error.png");
        }

    } catch (e) {
        console.error("❌ Kritik Hata:", e.message);
    } finally {
        await browser.close();
    }
}
start();
