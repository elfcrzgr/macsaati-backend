const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto('https://www.sporekrani.com/home/match/476636/2026/06/08/hollanda-ozbekistan-hazirlik-maci-hangi-kanalda', 
        { waitUntil: 'domcontentloaded' });
    
    const data = await page.evaluate(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        if (script) {
            const parsed = JSON.parse(script.innerHTML);
            return JSON.stringify(parsed, null, 2);
        }
        return "Bulunamadı";
    });
    
    console.log(data);
    
    await browser.close();
})();
