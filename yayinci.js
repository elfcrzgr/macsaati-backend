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
    
    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...\n`);
        
        const browser = await puppeteer.launch({ 
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Docker/Actions ortamlarında bellek hatasını önler
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            console.log(`📍 Ana liste açılıyor: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
            
            const matchUrls = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                const urls = [];
                
                scripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        if (data['@graph']) {
                            const itemList = data['@graph'].find(item => item['@type'] === 'ItemList');
                            if (itemList && itemList.itemListElement) {
                                itemList.itemListElement.forEach(listItem => {
                                    if (listItem.url) urls.push(listItem.url);
                                });
                            }
                        }
                    } catch (e) {}
                });
                
                return urls;
            });
            
            console.log(`📋 Toplam ${matchUrls.length} maç URL'i bulundu.\n`);
            await page.close(); // Ana listeyle işimiz bitti, RAM gitmesin diye kapatıyoruz.
            
            // Performans için tek bir detay sayfası açıp döngüde onu devridaim ettireceğiz
            const matchPage = await browser.newPage();
            await matchPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            // ⚡ HIZLANDIRICI: Resim, CSS, font ve reklamları engelleyerek RAM dolmasını engelliyoruz
            await matchPage.setRequestInterception(true);
            matchPage.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type) || req.url().includes('google') || req.url().includes('analytics')) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            matchPage.setDefaultNavigationTimeout(20000);
            matchPage.setDefaultTimeout(20000);
            
            let counter = 0;
            for (const matchUrl of matchUrls) {
                counter++;
                try {
                    // Aynı sekmeyi kullanarak sırayla gidiyoruz, bellek şişmiyor
                    await matchPage.goto(matchUrl, { waitUntil: 'domcontentloaded' });
                    
                    const matchData = await matchPage.evaluate(() => {
                        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                        let sportsEvent = null;
                        let broadcasts = [];
                        
                        scripts.forEach(script => {
                            try {
                                const data = JSON.parse(script.innerHTML);
                                if (data['@graph']) {
                                    data['@graph'].forEach(item => {
                                        if (item['@type'] === 'SportsEvent') {
                                            sportsEvent = item;
                                        }
                                        if (item['@type'] === 'BroadcastEvent') {
                                            broadcasts.push(item);
                                        }
                                    });
                                }
                            } catch (e) {}
                        });
                        
                        return { sportsEvent, broadcasts };
                    });
                    
                    if (matchData.sportsEvent) {
                        const event = matchData.sportsEvent;
                        const startDate = new Date(event.startDate);
                        const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                        
                        if (allMatches[dateStr]) {
                            const time = startDate.toLocaleTimeString('tr-TR', { 
                                timeZone, 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            });
                            
                            let channels = [];
                            matchData.broadcasts.forEach(broadcast => {
                                const channelName = broadcast.broadcastChannel?.name || '';
                                if (channelName && !channels.includes(channelName)) {
                                    channels.push(channelName);
                                }
                            });
                            
                            const channelStr = channels.length > 0 ? channels.join(' / ') : 'Bilinmiyor';
                            const matchName = `${event.homeTeam?.name || ''} - ${event.awayTeam?.name || ''}`;
                            
                            allMatches[dateStr].matches.push({
                                saat: time,
                                spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                                mac: matchName,
                                yayin: channelStr
                            });
                            
                            console.log(`[${counter}/${matchUrls.length}] ✓ ${matchName} - ${time}`);
                        }
                    }
                } catch (error) {
                    console.log(`[${counter}/${matchUrls.length}] ✗ Pas geçildi: ${error.message}`);
                    // Hata durumunda sekmenin kilitlenmesini önlemek için blank sayfaya yönlendiriyoruz
                    try { await matchPage.goto('about:blank'); } catch(e) {}
                }
            }
            
            await browser.close();
            
        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
            await browser.close();
        }
    }
    
    // Çıktı ve Dosya Kayıt
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
