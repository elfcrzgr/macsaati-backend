const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol']; // Test başarılı olunca 'basketbol', 'tenis' ekleyebilirsin
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
        
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        // Hız için gereksiz istekleri engelle (CSS'i bırakıyoruz çünkü DOM elementleri etkilenebilir)
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
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 });
            
            console.log("⏳ Dinamik maçların yüklenmesi için sayfa aşağı kaydırılıyor (Scroll)...");
            
            // 🔄 SOSNLU KAYDIRMA (SCROLL) FONKSİYONU
            // Sayfayı parça parça aşağı kaydırarak tüm maçların DOM'a basılmasını tetikliyoruz
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight || totalHeight > 20000) { // Güvenlik sınırı
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // Kaydırma sonrası elementlerin oturması için kısa bir es veriyoruz
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));

            // 🎯 GÜNCEL DOM PARSING (Bizzat siteden çıkarılan class isimleri)
            const matchesScraped = await page.evaluate(() => {
                const results = [];
                // Sitedeki her bir maç satırının ana kapsayıcısı
                const items = document.querySelectorAll('.match-list-item');
                
                items.forEach(item => {
                    try {
                        // 1. Saat
                        const timeEl = item.querySelector('.time');
                        const saat = timeEl ? timeEl.innerText.trim() : '';
                        
                        // 2. Maç Adı (Takımlar)
                        const homeTeam = item.querySelector('.home-team-name')?.innerText?.trim() || '';
                        const awayTeam = item.querySelector('.away-team-name')?.innerText?.trim() || '';
                        let mac = (homeTeam && awayTeam) ? `${homeTeam} - ${awayTeam}` : '';
                        
                        if (!mac) {
                            const generalTitle = item.querySelector('.match-name, .title, h3')?.innerText?.trim();
                            if (generalTitle) mac = generalTitle;
                        }

                        // 3. Yayıncı Kanallar
                        // Sitede kanallar '.channel-name-text' class'ı içinde ya da logoların alt attribute'unda tutuluyor
                        const channelList = [];
                        const channelElements = item.querySelectorAll('.channel-name-text, .channel-link');
                        
                        channelElements.forEach(el => {
                            const txt = el.innerText?.trim();
                            if (txt && !channelList.includes(txt)) channelList.push(txt);
                        });

                        // Eğer text bulamazsa logolara bak
                        if (channelList.length === 0) {
                            const imgs = item.querySelectorAll('img');
                            imgs.forEach(img => {
                                const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                                if (alt && !alt.toLowerCase().includes('logo') && alt.length > 1) {
                                    const cleanAlt = alt.replace(/logosu/gi, '').trim();
                                    if (!channelList.includes(cleanAlt)) channelList.push(cleanAlt);
                                }
                            });
                        }

                        const yayin = channelList.length > 0 ? channelList.join(' / ') : 'Spor Ekranı Özel';

                        if (saat && mac) {
                            results.push({ saat, mac, yayin });
                        }
                    } catch (e) {}
                });
                
                return results;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Siteden toplam ${matchesScraped.length} adet maç başarıyla söküldü.`);

            // Gruplama ve Filtreleme
            matchesScraped.forEach(m => {
                const macLower = m.mac.toLowerCase();
                if (macLower.includes('iptal') || macLower.includes('ertelendi')) return;

                // Gece 00:00 ile 04:00 arası maçları YARIN grubuna, kalanları BUGÜN grubuna atıyoruz
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

    // Konsol Tablosu Oluşturma
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
    console.log("\n💾 Maç Saati için 'yayinci_bilgisi.json' başarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
