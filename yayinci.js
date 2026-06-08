const puppeteer = require('puppeteer');

async function debug() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    await page.goto('https://www.sporekrani.com/home/match/476636/2026/06/08/hollanda-ozbekistan-hazirlik-maci-hangi-kanalda', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Tüm JSON-LD scriptlerini göster
    const allJsonLd = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => s.innerHTML);
    });
    console.log('=== TÜM JSON-LD ===');
    allJsonLd.forEach((s, i) => console.log(`\n--- Script ${i+1} ---\n${s.substring(0, 1000)}`));

    // Sayfada "kanal" veya "yayın" geçen text içerikli elementler
    const kanalElements = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('*').forEach(el => {
            const text = el.innerText || '';
            if (text.length < 200 && text.length > 2 && 
                (text.toLowerCase().includes('sport') || text.toLowerCase().includes('bein') || 
                 text.toLowerCase().includes('trt') || text.toLowerCase().includes('kanal') ||
                 text.toLowerCase().includes('tv8') || text.toLowerCase().includes('a spor'))) {
                results.push({ tag: el.tagName, class: el.className?.substring(0,50), text: text.substring(0,100) });
            }
        });
        return results.slice(0, 20);
    });
    console.log('\n=== KANAL İÇEREN ELEMENTLER ===');
    kanalElements.forEach(e => console.log(e));

    await browser.close();
}

debug().catch(e => { console.error(e); process.exit(1); });
