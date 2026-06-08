const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
    // Tarihleri Hesapla
    const d = new Date();
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        // Reklam ve gereksiz görselleri engelleyerek hızı artırıyoruz
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'media'].includes(req.resourceType()) || req.url().includes('google') || req.url().includes('analytics')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            // Sayfanın ve dinamik içeriklerin tamamen oturması için networkidle2 ile bekliyoruz
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
            
            // Sayfadaki maç kartlarını DOM üzerinden doğrudan topluyoruz
            const matchesScraped = await page.evaluate(() => {
                const results = [];
                
                // Sitedeki maç satırlarını yakalayabilecek tüm olası seçiciler
                const items = document.querySelectorAll('.match-list-item, .match-item, [class*="match-list"], [class*="match-card"]');
                
                items.forEach(item => {
                    try {
                        // 1. Saat Ayıklama
                        const timeEl = item.querySelector('.time, .hour, [class*="time"], [class*="hour"]');
                        const saat = timeEl ? timeEl.innerText.trim() : '';
                        
                        // 2. Maç Adı Ayıklama
                        const nameEl = item.querySelector('.match-name, .teams, .title, [class*="name"], [class*="title"], h3, h4');
                        let mac = nameEl ? nameEl.innerText.trim() : '';
                        
                        // Eğer takımlar ayrı alt elementlerdeyse birleştir
                        if (!mac) {
                            const home = item.querySelector('.home-team, [class*="home"]')?.innerText?.trim() || '';
                            const away = item.querySelector('.away-team, [class*="away"]')?.innerText?.trim() || '';
                            if (home && away) mac = `${home} - ${away}`;
                        }

                        // 3. Yayıncı Kanal Ayıklama
                        let yayin = '';
                        // Önce metin olarak yazan yerleri ara
                        const channelEl = item.querySelector('.channels, .channel, .broadcaster, [class*="channel"]');
                        if (channelEl && channelEl.innerText.trim()) {
                            yayin = channelEl.innerText.trim();
                        } else {
                            // Metin yoksa kanal logolarının alt/title elementlerine bak
                            const imgs = item.querySelectorAll('img');
                            const channelList = [];
                            imgs.forEach(img => {
                                const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                                if (alt && !alt.toLowerCase().includes('logo') && alt.length > 2) {
                                    channelList.push(alt.trim());
                                transformMatches}
                            });
                            if (channelList.length > 0) yayin = channelList.join(' / ');
                        }

                        if (saat && mac) {
                            results.push({ saat, mac, yayin: yayin || 'Spor Ekranı' });
                        }
                    } catch (e) {}
                });
                
                return results;
            });

            console.log(`🔍 ${sport.toUpperCase()}: DOM üzerinden ${matchesScraped.length} adet canlı maç satırı kazındı.`);

            // Çekilen verileri tarih gruplarına dağıtıyoruz
            matchesScraped.forEach(m => {
                const macLower = m.mac.toLowerCase();
                if (macLower.includes('iptal') || macLower.includes('ertelendi')) return;

                // DOM'dan çekilen maçlar kronolojik listelendiği için doğrudan BUGÜN listesine ekliyoruz.
                // Gece yarısını geçen maçlar için saat kontrolü yapıp YARIN grubuna paslayabiliriz.
                const hourPrefix = parseInt(m.saat.split(':')[0]);
                const targetStr = (hourPrefix >= 0 && hourPrefix < 4) ? tomorrowStr : todayStr;

                allMatches[targetStr].matches.push({
                    saat: m.saat,
                    spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                    mac: m.mac.toUpperCase(),
                    yayin: m.yayin
                });
            });

        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Çıktıları Konsola Bas ve Yazdır
    [todayStr, tomorrowStr].forEach(key => {
        const group = allMatches[key];
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        
        if (group.matches.length === 0) {
            console.log("   ⚠️ Maç bulunamadı.");
        } else {
            const uniqueMatches = Array.from(new Set(group.matches.map(JSON.stringify))).map(JSON.parse);
            const sorted = uniqueMatches.sort((a, b) => a.saat.localeCompare(b.saat));
            console.table(sorted);
        }
    });

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json başarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
