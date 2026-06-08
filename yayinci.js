const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto('https://www.sporekrani.com/home/sport/futbol', { waitUntil: 'networkidle2' });
        
        const jsonData = await page.evaluate(() => {
            const script = document.querySelector('script[type="application/ld+json"]');
            if (script) {
                try {
                    return JSON.parse(script.innerHTML);
                } catch (e) {
                    return { error: "Parse hatası" };
                }
            }
            return { error: "Script bulunamadı" };
        });
        
        console.log("📋 JSON-LD Veri:");
        console.log(JSON.stringify(jsonData, null, 2));
        
        // CollectionPage kontrolü
        if (jsonData['@graph']) {
            const collectionPage = jsonData['@graph'].find(item => item['@type'] === 'CollectionPage');
            if (collectionPage) {
                console.log("\n✅ CollectionPage bulundu!");
                console.log("mainEntity var mı?", !!collectionPage.mainEntity);
                if (collectionPage.mainEntity?.itemListElement) {
                    console.log("Item sayısı:", collectionPage.mainEntity.itemListElement.length);
                    console.log("\n🔗 İlk 5 maç URL'i:");
                    collectionPage.mainEntity.itemListElement.slice(0, 5).forEach((item, idx) => {
                        console.log(`${idx + 1}. ${item.url}`);
                    });
                }
            } else {
                console.log("\n❌ CollectionPage bulunamadı");
                console.log("Mevcut types:", jsonData['@graph'].map(i => i['@type']));
            }
        }
        
        await browser.close();
    } catch (error) {
        console.error("❌ HATA:", error.message);
    }
})();
