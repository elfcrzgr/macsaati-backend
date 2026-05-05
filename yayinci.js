const puppeteer = require('puppeteer');

async function getBroadcasterData() {
    console.log("🌐 Spor Ekranı verileri çekiliyor...");
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        // Bot engeline takılmamak için User-Agent ayarla
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto('https://www.sporekrani.com/', { waitUntil: 'networkidle2' });

        const data = await page.evaluate(() => {
            const results = [];
            // Sitedeki her bir maç satırı genellikle 'list-group-item' içinde bulunur
            const rows = document.querySelectorAll('.list-group-item');

            rows.forEach(row => {
                const time = row.querySelector('.saat')?.innerText.trim() || "";
                const title = row.querySelector('.mac-adi')?.innerText.trim() || "";
                const sport = row.querySelector('.spor-dali')?.innerText.trim() || "";
                
                // Yayıncı kanallar genellikle 'kanallar' divi içindeki img alt textleri veya text olarak bulunur
                const channels = [];
                row.querySelectorAll('.kanallar a, .kanallar img').forEach(channel => {
                    const name = channel.getAttribute('title') || channel.getAttribute('alt') || channel.innerText.trim();
                    if (name && !channels.includes(name)) {
                        channels.push(name);
                    }
                });

                if (title && time) {
                    results.push({
                        time,
                        sport,
                        match: title,
                        broadcasters: channels.join(' / ')
                    });
                }
            });
            return results;
        });

        console.log(`✅ Toplam ${data.length} yayıncı bilgisi bulundu.`);
        console.table(data.slice(0, 15)); // İlk 15 veriyi tablo olarak göster
        return data;

    } catch (error) {
        console.error("🚨 Hata oluştu:", error.message);
    } finally {
        await browser.close();
    }
}

getBroadcasterData();
