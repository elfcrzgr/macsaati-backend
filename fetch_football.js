const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function testStages() {
    console.log("🔍 Stage Endpoint Test\n");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    const endpoints = [
        'https://api.sofascore.com/api/v1/unique-tournament/17011/seasons',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/stages',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/all/0'
    ];

    for (const endpoint of endpoints) {
        try {
            console.log(`\n📌 ${endpoint}`);
            await page.goto(endpoint, { waitUntil: 'networkidle2' });
            const response = await page.evaluate(() => {
                const data = JSON.parse(document.body.innerText);
                return {
                    keys: Object.keys(data),
                    hasStages: !!data.stages,
                    stageCount: data.stages ? data.stages.length : 0,
                    hasEvents: !!data.events,
                    eventCount: data.events ? data.events.length : 0
                };
            });
            console.log(`✅ ${JSON.stringify(response)}`);
        } catch (e) {
            console.log(`❌ ${e.message}`);
        }
    }

    await browser.close();
}

testStages();
