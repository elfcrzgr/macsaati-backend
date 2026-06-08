const puppeteer = require('puppeteer');

async function debugSporekrani() {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    try {
        const url = 'https://www.sporekrani.com/home/sport/futbol';
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        const allScripts = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            return scripts.map(s => s.innerHTML);
        });
        
        // TÜM JSON-LD'yi tam olarak yazdır
        allScripts.forEach((script, idx) => {
            try {
                const parsed = JSON.parse(script);
                console.log(`\n--- JSON-LD #${idx + 1} (FULL) ---`);
                console.log(JSON.stringify(parsed, null, 2));
            } catch (e) {
                console.log("❌ Parse hatası");
            }
        });
        
        // Alternatif: HTML'de "match", "mac", "yayin" gibi veri bul
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log("\n\n--- SAYFA METNİNDEN İLK 1000 KARAKTER ---");
        console.log(bodyText.substring(0, 1000));
        
    } catch (error) {
        console.error('🚨 Hata:', error.message);
    } finally {
        await browser.close();
    }
}

debugSporekrani().catch(console.error);
