const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        console.log("📍 Sayfaya gidiliyor...");
        
        await page.goto('https://www.sporekrani.com/home/sport/futbol', { waitUntil: 'networkidle2' });
        console.log("✅ Sayfa açıldı");
        
        const scripts = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('script[type="application/ld+json"]')).length;
        });
        
        console.log(`📋 JSON-LD script sayısı: ${scripts}`);
        
        await browser.close();
    } catch (error) {
        console.error("❌ HATA:", error.message);
    }
})();
