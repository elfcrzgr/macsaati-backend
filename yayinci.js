const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol'];
    const timeZone = 'Europe/Istanbul';
    const MATCH_LIMIT = 50;
    
    const d = new Date();
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN`, matches: [] }
    };
    
    for (const sport of sports) {
        console.log(`🚀 ${sport.toUpperCase()} işleniyor...\n`);
        
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const matchUrls = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                const urls = [];
                
                scripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        if (data['@graph']) {
                            const itemList = data['@graph'].find(item => item['@type'] === 'ItemList');
                            if (itemList && itemList.itemListElement) {
                                itemList.itemListElement.slice(0, MATCH_LIMIT).forEach(listItem => {
                                    if (listItem.url) urls.push(listItem.url);
                                });
                            }
                        }
                    } catch (e) {}
                });
                
                return urls;
            });
            
            await page.close();
            console.log(`📋 ${matchUrls.length} maç işleniyor...\n`);
            
            let processed = 0;
            for (const matchUrl of matchUrls) {
                try {
                    const matchPage = await browser.newPage();
                    matchPage.setDefaultTimeout(10000);
                    
                    try {
                        await matchPage.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    } catch (e) {
                        await matchPage.close();
                        continue;
                    }
                    
                    const matchData = await matchPage.evaluate(() => {
                        const script = document.querySelector('script[type="application/ld+json"]');
                        if (!script) return null;
                        
                        try {
                            const data = JSON.parse(script.innerHTML);
                            let sportsEvent = null;
                            let broadcasts = [];
                            
                            if (data['@graph']) {
                                data['@graph'].forEach(item => {
                                    if (item['@type'] === 'SportsEvent') sportsEvent = item;
                                    if (item['@type'] === 'BroadcastEvent') broadcasts.push(item);
                                });
                            }
                            
                            return { sportsEvent, broadcasts };
                        } catch (e) {
                            return null;
                        }
                    });
                    
                    if (matchData?.sportsEvent) {
                        const event = matchData.sportsEvent;
                        const startDate = new Date(event.startDate);
                        const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                        
                        if (allMatches[dateStr]) {
                            const time = startDate.toLocaleTimeString('tr-TR', { 
                                timeZone, 
                                hour: '2-digit', 
                                minute: '2-digit' 
                            });
                            
                            // ✅ @id'den kanal adını çıkar
                            let channels = [];
                            matchData.broadcasts.forEach(broadcast => {
                                const broadcastId = broadcast.broadcastChannel?.['@id'] || '';
                                // "https://www.sporekrani.com/home/channel/s-sport-plus#broadcastservice"
                                // → "s-sport-plus"
                                const match = broadcastId.match(/\/channel\/([^\/]+)/);
                                if (match) {
                                    let channelName = match[1]
                                        .replace(/-/g, ' ')
                                        .split(' ')
                                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                                        .join(' ');
                                    
                                    if (!channels.includes(channelName)) {
                                        channels.push(channelName);
                                    }
                                }
                            });
                            
                            const matchName = `${event.homeTeam?.name || ''} - ${event.awayTeam?.name || ''}`;
                            
                            allMatches[dateStr].matches.push({
                                saat: time,
                                mac: matchName,
                                yayin: channels.join(' / ') || 'Bilinmiyor'
                            });
                            
                            console.log(`✓ ${matchName} → ${channels.join(' / ') || 'Bilinmiyor'}`);
                        }
                    }
                    
                    await matchPage.close();
                    processed++;
                    if (processed % 5 === 0) console.log(`  ${processed}/${matchUrls.length}`);
                    
                } catch (error) {
                    //
                }
            }
            
            await browser.close();
            
        } catch (error) {
            console.error(`🚨 Hata:`, error.message);
            await browser.close();
        }
    }
    
    // Çıktı
    Object.entries(allMatches).forEach(([key, group]) => {
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        if (group.matches.length === 0) {
            console.log("   Maç yok");
        } else {
            const sorted = group.matches.sort((a, b) => a.saat.localeCompare(b.saat));
            console.table(sorted);
        }
    });
    
    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json kaydedildi");
}

getBroadcasterData().catch(e => console.error(e));
