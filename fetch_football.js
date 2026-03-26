const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function debugAPI() {
    console.log("🔍 SofaScore API Debug Mode - Playoff Maçlarını Bulma\n");
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Network requestlerini yakala
    const requests = [];
    page.on('request', request => {
        if (request.url().includes('api.sofascore.com') && request.url().includes('17011')) {
            requests.push({
                url: request.url(),
                method: request.method()
            });
        }
    });

    const responses = [];
    page.on('response', response => {
        if (response.url().includes('api.sofascore.com') && response.url().includes('17011')) {
            responses.push({
                url: response.url(),
                status: response.status()
            });
        }
    });

    console.log("📍 Web Sitesi Açılıyor: https://www.sofascore.com/tr/football/tournament/europe/world-championship-qual-uefa/11");
    await page.goto('https://www.sofascore.com/tr/football/tournament/europe/world-championship-qual-uefa/11', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    console.log("\n🔗 Intercept Edilen API Çağrıları (17011 ile ilgili):\n");
    responses.forEach((r, i) => {
        console.log(`${i + 1}. ${r.url}`);
    });

    // Tüm 17011 API çağrılarını dene ve cevapları logla
    console.log("\n\n🧪 API Endpoint Testleri:\n");

    const testEndpoints = [
        'https://api.sofascore.com/api/v1/unique-tournament/17011/seasons',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/stages',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/next/0',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/last/0',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/events/all/0',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/standings',
        'https://api.sofascore.com/api/v1/unique-tournament/17011/season/36961/structure'
    ];

    for (const endpoint of testEndpoints) {
        try {
            console.log(`\n📌 Endpoint: ${endpoint}`);
            await page.goto(endpoint, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(() => { 
                try { 
                    const parsed = JSON.parse(document.body.innerText);
                    return {
                        hasData: !!parsed,
                        keys: Object.keys(parsed).slice(0, 5),
                        dataCount: parsed.events ? parsed.events.length : parsed.stages ? parsed.stages.length : 'N/A'
                    };
                } catch(e) { 
                    return { error: e.message }; 
                } 
            });
            console.log(`   ✅ Yanıt: ${JSON.stringify(data)}`);
        } catch (e) {
            console.log(`   ❌ Hata: ${e.message}`);
        }
    }

    await browser.close();
}

debugAPI();
