const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function debugPlayoff() {
    console.log("🔍 PLAYOFF DEBUG\n");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    // 17011 = Dünya Kupası Elemeleri
    const testEndpoints = [
        { name: 'Seasons', url: 'https://api.sofascore.com/api/v1/unique-tournament/17011/seasons' },
        { name: 'Stages', url: 'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/stages' },
        { name: 'Events All', url: 'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/all/0' },
        { name: 'Events Next', url: 'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/next/0' },
        { name: 'Events Last', url: 'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/last/0' }
    ];

    for (const test of testEndpoints) {
        try {
            await page.goto(test.url, { waitUntil: 'networkidle2' });
            const result = await page.evaluate(() => {
                const data = JSON.parse(document.body.innerText);
                return {
                    keys: Object.keys(data).slice(0, 5),
                    stages: data.stages ? data.stages.length : 0,
                    events: data.events ? data.events.length : 0
                };
            });
            console.log(`✅ ${test.name}: ${JSON.stringify(result)}`);
        } catch (e) {
            console.log(`❌ ${test.name}: ${e.message}`);
        }
    }

    await browser.close();
}

debugPlayoff();
