const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
    // Tarihleri Hesapla
    const d = new Date();
    const yesterday = new Date(d); yesterday.setDate(d.getDate() - 1);
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 2);
    
    const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone });
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    const nextDayStr = nextDay.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [yesterdayStr]: { title: `📅 DÜN (${yesterday.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [nextDayStr]: { title: `📅 ERTESİ GÜN (${nextDay.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };
    
    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...\n`);
        
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // YENİ YÖNTEМ: @graph içindeki ListItem'ları bul
            const matchUrls = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                const urls = [];
                
                scripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        if (data['@graph']) {
                            data['@graph'].forEach(item => {
                                // Schedule listini bul
                                if (item['@type'] === 'CollectionPage' && item.mainEntity) {
                                    const mainEntity = item.mainEntity;
                                    if (mainEntity.itemListElement && Array.isArray(mainEntity.itemListElement)) {
                                        mainEntity.itemListElement.forEach(listItem => {
                                            if (listItem.url) {
                                                urls.push(listItem.url);
                                            }
                                        });
                                    }
                                }
                            });
                        }
                    } catch (e) {}
                });
                
                return urls;
            });
            
            console.log(`📋 Bulunan ${matchUrls.length} maç URL'i`);
            
            // Her maç sayfasını aç ve detayları çek
            for (const matchUrl of matchUrls) {
                try {
                    const matchPage = await browser.newPage();
                    await matchPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                    await matchPage.goto(matchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    
                    const matchData = await matchPage.evaluate(() => {
                        // Maç detaylarını HTML'den çek
                        const titleEl = document.querySelector('h1, .match-title, [class*="title"]');
                        const timeEl = document.querySelector('.match-time, [class*="time"], [class*="saat"]');
                        const channelEl = document.querySelector('.channel, [class*="channel"], [class*="yayin"]');
                        
                        // JSON-LD'den de kontrol et
                        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                        let eventData = null;
                        
                        scripts.forEach(script => {
                            try {
                                const data = JSON.parse(script.innerHTML);
                                if (data['@type'] === 'SportsEvent' || data['@graph']) {
                                    if (data['@type'] === 'SportsEvent') {
                                        eventData = data;
                                    } else if (data['@graph']) {
                                        const event = data['@graph'].find(item => item['@type'] === 'SportsEvent');
                                        if (event) eventData = event;
                                    }
                                }
                            } catch (e) {}
                        });
                        
                        return {
                            title: titleEl?.innerText || '',
                            time: timeEl?.innerText || '',
                            channel: channelEl?.innerText || '',
                            eventData: eventData
                        };
                    });
                    
                    console.log(`  ✓ ${matchData.title || 'Bilinmiyor'}`);
                    
                    await matchPage.close();
                } catch (error) {
                    console.log(`  ✗ Maç açılamadı: ${error.message}`);
                }
            }
            
            await browser.close();
            
        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
            await browser.close();
        }
    }
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
