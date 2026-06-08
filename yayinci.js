const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    const MAX_CONCURRENT = 5; // Eşzamanlı açık browser sayısı
    
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
    
    // Maçı aç ve veri çek
    async function fetchMatchData(matchUrl, browser) {
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.goto(matchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const matchData = await page.evaluate(() => {
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
            
            await page.close();
            return matchData;
        } catch (error) {
            console.log(`  ✗ ${error.message}`);
            return null;
        }
    }
    
    // Maçları işle
    async function processMatches(matchUrls, sport) {
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        // Chunk'lar halinde işle
        for (let i = 0; i < matchUrls.length; i += MAX_CONCURRENT) {
            const chunk = matchUrls.slice(i, i + MAX_CONCURRENT);
            const promises = chunk.map(url => fetchMatchData(url, browser));
            const results = await Promise.all(promises);
            
            results.forEach(matchData => {
                if (!matchData?.sportsEvent) return;
                
                const event = matchData.sportsEvent;
                const startDate = new Date(event.startDate);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                
                if (!allMatches[dateStr]) return;
                
                // İptal kontrolü
                const eventNameLower = (event.name || '').toLowerCase();
                const isCancelled = eventNameLower.includes('iptal') || 
                                  eventNameLower.includes('ertelendi') || 
                                  eventNameLower.includes('postponed') || 
                                  eventNameLower.includes('cancelled');
                
                if (isCancelled) return;
                
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
                
                console.log(`  ✓ ${matchName} - ${time}`);
            });
            
            console.log(`  ${Math.min(i + MAX_CONCURRENT, matchUrls.length)}/${matchUrls.length}`);
        }
        
        await browser.close();
    }
    
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
            
            await browser.close();
            
            console.log(`📋 Bulunan ${matchUrls.length} maç URL'i (paralel işleniyor...)\n`);
            await processMatches(matchUrls, sport);
            
        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
            await browser.close();
        }
    }
    
    // Çıktı
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
