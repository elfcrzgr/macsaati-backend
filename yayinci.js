const puppeteer = require('puppeteer');

async function debugSporekrani() {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    try {
        const url = 'https://www.sporekrani.com/home/sport/futbol';
        console.log(`🔍 Sayfa açılıyor: ${url}\n`);
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        // Sayfanın HTML'ini kontrol et
        const html = await page.content();
        console.log("📄 Sayfada 'BroadcastEvent' var mı?", html.includes('BroadcastEvent'));
        console.log("📄 Sayfada 'SportsEvent' var mı?", html.includes('SportsEvent'));
        console.log("📄 Sayfada 'Event' var mı?", html.includes('Event'));
        
        // TÜM JSON-LD scriptleri bul
        const allScripts = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            return scripts.map(s => s.innerHTML);
        });
        
        console.log(`\n🔗 Bulunan ${allScripts.length} JSON-LD script(i):`);
        allScripts.forEach((script, idx) => {
            console.log(`\n--- JSON-LD #${idx + 1} ---`);
            try {
                const parsed = JSON.parse(script);
                console.log(JSON.stringify(parsed, null, 2).substring(0, 500) + '...');
            } catch (e) {
                console.log("❌ Parse hatası:", e.message);
            }
        });
        
    } catch (error) {
        console.error('🚨 Hata:', error.message);
    } finally {
        await browser.close();
    }
}

debugSporekrani().catch(console.error);
