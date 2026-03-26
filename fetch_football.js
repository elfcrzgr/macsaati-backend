const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function inspectMatches() {
    console.log("🔍 İçerideki 3 Maç Nedir?\n");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    await page.goto('https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/all/0', { waitUntil: 'networkidle2' });
    const result = await page.evaluate(() => {
        const data = JSON.parse(document.body.innerText);
        return data.events.map(e => ({
            id: e.id,
            home: e.homeTeam.name,
            away: e.awayTeam.name,
            date: new Date(e.startTimestamp * 1000).toISOString().split('T')[0],
            status: e.status?.type
        }));
    });

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
}

inspectMatches();
