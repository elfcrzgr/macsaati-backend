const puppeteer = require('puppeteer');

async function debug() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    // 1. Futbol listesinden ilk 3 maç URL'sini al
    await page.goto('https://www.sporekrani.com/home/sport/futbol', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const matchUrls = await page.evaluate(() => {
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (!jsonLd) return [];
        const data = JSON.parse(jsonLd.innerHTML);
        const graph = data['@graph'] || [];
        const itemList = graph.find(item => item['@type'] === 'ItemList');
        return (itemList?.itemListElement || []).slice(0, 3).map(i => i.url).filter(Boolean);
    });

    console.log('İlk 3 URL:', matchUrls);

    // 2. İlk maç sayfasına git, tüm JSON-LD'yi göster
    if (matchUrls[0]) {
        await page.goto(matchUrls[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        const jsonLd = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            const results = [];
            scripts.forEach(s => {
                try { results.push(JSON.parse(s.innerHTML)); } catch(e) {}
            });
            return results;
        });

        console.log('\n--- MAÇ SAYFASI JSON-LD ---');
        console.log(JSON.stringify(jsonLd, null, 2).substring(0, 3000));
    }

    await browser.close();
}

debug().catch(e => { console.error(e); process.exit(1); });
