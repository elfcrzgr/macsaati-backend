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
            
            // Ana sayfadan maç URL'lerini çek
            const matchUrls = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                const urls = [];
                
                scripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        if (data['@graph']) {
                            // ItemList'i bul (CollectionPage değil!)
                            const itemList = data['@graph'].find(item => item['@type'] === 'ItemList');
                            if (itemList && itemList.itemListElement && Array.isArray(itemList.itemListElement)) {
                                itemList.itemListElement.forEach(listItem => {
                                    if (listItem.url) {
                                        urls.push(listItem.url);
                                    }
                                });
                            }
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
                        
                        // Sadece 4 günün verisini al
                        if (!allMatches[dateStr]) {
                            await matchPage.close();
                            continue;
                        }
                        
                        // İptal edilen maçları filtrele
                        const eventNameLower = (event.name || '').toLowerCase();
                        const isCancelled = eventNameLower.includes('iptal') || 
                                          eventNameLower.includes('ertelendi') || 
                                          eventNameLower.includes('postponed') || 
                                          eventNameLower.includes('cancelled');
                        
                        if (isCancelled) {
                            console.log(`🗑️ İptal edilen maç atlandı: ${event.name}`);
                            await matchPage.close();
                            continue;
                        }
                        
                        const time = startDate.toLocaleTimeString('tr-TR', { 
                            timeZone, 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        });
                        
                        // Kanalları topla
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
                        
                        console.log(`  ✓ ${matchName} - ${time}`);
                    }
                    
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
    
    // Çıktı ve Kayıt
    [yesterdayStr, todayStr, tomorrowStr, nextDayStr].forEach(key => {
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
