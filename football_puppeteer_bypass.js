const puppeteer = require('puppeteer');
const fs = require('fs');

let browser = null;
let page = null;

const initBrowser = async () => {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        page = await browser.newPage();
        
        // User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'tr-TR,tr;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
        });
    }
    return page;
};

async function fetchDataWithPuppeteer(url, retryCount = 0) {
    try {
        const pageInstance = await initBrowser();
        
        console.log(`🌐 [${retryCount}] Puppeteer ile çekiliyor: ${url.substring(0, 70)}...`);
        
        // Random delay
        await new Promise(r => setTimeout(r, Math.random() * 2000 + 500));
        
        // Sayfayı aç
        const response = await pageInstance.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        if (response.status() === 403) {
            console.log(`⚠️ 403 Hatası (deneme ${retryCount + 1})`);
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 5000 * (retryCount + 1)));
                return fetchDataWithPuppeteer(url, retryCount + 1);
            }
            return null;
        }

        if (response.status() === 404) {
            return { is404: true };
        }

        if (response.status() !== 200) {
            console.log(`⚠️ HTTP ${response.status()}`);
            return null;
        }

        // JSON'u al
        const data = await pageInstance.evaluate(() => {
            return JSON.parse(document.body.innerText || '{}');
        });

        console.log(`✅ Başarılı (Puppeteer)!`);
        return data;

    } catch (error) {
        console.error(`❌ Puppeteer Hatası: ${error.message}`);
        
        if (retryCount < 3) {
            return fetchDataWithPuppeteer(url, retryCount + 1);
        }
        return null;
    }
}

// Cleanup
process.on('exit', async () => {
    if (browser) {
        await browser.close();
    }
});

module.exports = {
    fetchDataWithPuppeteer
};
