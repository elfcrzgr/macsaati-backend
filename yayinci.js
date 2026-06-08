const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol'];
    const timeZone = 'Europe/Istanbul';
    
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
        headless: true, // headless modu zorunlu sunucu için ama argümanları katılaştırdık
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080',
            '--disable-features=IsolateOrigins,site-per-process',
            '--blink-features=AutomationControlled'
        ]
    });

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...`);
        const page = await browser.newPage();
        
        // Gerçek kullanıcı simülasyonu
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // Tarayıcının bot olduğunu ele veren parametreyi gizliyoruz
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            // Sayfanın içindeki JavaScript'lerin tamamen çalışması için networkidle0 ile tam yükleme bekliyoruz
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
            
            // Sayfa açıldıktan sonra dinamik elementlerin gelmesi için fazladan 5 saniye bekleme süresi
            console.log("⏳ JavaScript render yapısı bekleniyor (5 saniye)...");
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)));

            // Sayfayı tamamen aşağı kaydır (Lazy load/Infinite scroll tetiklensin)
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 500;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight || totalHeight > 15000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 150);
                });
            });

            // Elementleri DOM'dan çekiyoruz
            const matchesScraped = await page.evaluate(() => {
                const results = [];
                // Sitedeki ana listeleme elemanlarını kapsayabilecek esnek seçiciler
                const items = document.querySelectorAll('.match-list-item, [class*="match-list-item"], .match-item');
                
                items.forEach(item => {
                    try {
                        // 1. Saat Seçimi
                        const timeEl = item.querySelector('.time, [class*="time"]');
                        const saat = timeEl ? timeEl.innerText.trim() : '';
                        
                        // 2. Takım İsimleri
                        const home = item.querySelector('.home-team-name, [class*="home-team"]')?.innerText?.trim() || '';
                        const away = item.querySelector('.away-team-name, [class*="away-team"]')?.innerText?.trim() || '';
                        let mac = (home && away) ? `${home} - ${away}` : '';
                        
                        if (!mac) {
                            const altTitle = item.querySelector('.match-name, h3, h4')?.innerText?.trim();
                            if (altTitle) mac = altTitle;
                        }

                        // 3. Kanal İsimleri
                        const channelList = [];
                        const channelTxts = item.querySelectorAll('.channel-name-text, [class*="channel-name"]');
                        channelTxts.forEach(el => {
                            if (el.innerText?.trim()) channelList.push(el.innerText.trim());
                        });

                        // Eğer yazı yoksa logoları tara
                        if (channelList.length === 0) {
                            const imgs = item.querySelectorAll('img');
                            imgs.forEach(img => {
                                const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                                if (alt && !alt.toLowerCase().includes('logo')) {
                                    channelList.push(alt.replace(/logosu/gi, '').trim());
                                }
                            });
                        }

                        const yayin = channelList.length > 0 ? channelList.join(' / ') : 'Spor Ekranı';

                        if (saat && mac) {
                            results.push({ saat, mac, yayin });
                        }
                    } catch (e) {}
                });
                
                return results;
            });

            console.log(`🔍 ${sport.toUpperCase()}: DOM üzerinden ${matchesScraped.length} maç verisi çekildi.`);

            matchesScraped.forEach(m => {
                const nameLower = m.mac.toLowerCase();
                if (nameLower.includes('iptal') || nameLower.includes('ertelendi')) return;

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

    // Konsola Yazdır
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
    console.log("\n💾 yayinci_bilgisi.json kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
