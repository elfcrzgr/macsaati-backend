const puppeteer = require('puppeteer');

async function debugMain() {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto('https://www.sporekrani.com/home/sport/futbol', { waitUntil: 'networkidle2' });
    
    const result = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        console.log("📋 Toplam JSON-LD script sayısı:", scripts.length);
        
        let allData = [];
        scripts.forEach((script, idx) => {
            try {
                const data = JSON.parse(script.innerHTML);
                console.log(`\n--- JSON-LD #${idx} ---`);
                console.log("@type:", Array.isArray(data['@graph']) ? 'Graph' : data['@type']);
                
                if (data['@graph']) {
                    data['@graph'].forEach((item, i) => {
                        console.log(`  Item ${i}: ${item['@type']}`);
                        if (item['@type'] === 'CollectionPage') {
                            console.log("    ✓ CollectionPage bulundu!");
                            console.log("    mainEntity:", !!item.mainEntity);
                            if (item.mainEntity?.itemListElement) {
                                console.log("    Item sayısı:", item.mainEntity.itemListElement.length);
                                // İlk 3 item'ı göster
                                item.mainEntity.itemListElement.slice(0, 3).forEach((li, j) => {
                                    console.log(`      [${j}] position: ${li.position}, url: ${li.url?.substring(0, 80)}`);
                                });
                            }
                        }
                    });
                }
                
                allData.push(data);
            } catch (e) {
                console.log(`❌ Parse hatası: ${e.message}`);
            }
        });
        
        return allData;
    });
    
    await browser.close();
}

debugMain().catch(console.error);
