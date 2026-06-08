const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
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

        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'tr-TR,tr;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const jsonLdData = await page.evaluate(() => {
                const script = document.querySelector('script[type="application/ld+json"]');
                if (script) {
                    try { return JSON.parse(script.innerHTML); } catch (e) { return null; }
                }
                return null;
            });
            
            if (!jsonLdData) {
                console.log(`⚠️ ${sport}: JSON-LD bulunamadı`);
                await browser.close();
                continue;
            }

            console.log(`✅ ${sport}: JSON-LD bulundu`);
            console.log("--- HAM VERİ (ilk 2000 karakter) ---");
            console.log(JSON.stringify(jsonLdData, null, 2).substring(0, 2000));
            console.log("--- HAM VERİ SONU ---");
            
            const events = Array.isArray(jsonLdData) ? jsonLdData : [jsonLdData];
            console.log(`📊 Toplam event sayısı: ${events.length}`);
            if (events.length > 0) {
                console.log(`📊 İlk event tipi: ${events[0]['@type']}`);
            }
            
            events.forEach(event => {
                if (event['@type'] !== 'BroadcastEvent') return;
                
                const broadcastEvent = event.broadcastOfEvent;
                if (!broadcastEvent) return;

                const eventNameLower = (broadcastEvent.name || '').toLowerCase();
                const isCancelled = eventNameLower.includes('iptal') || 
                                    eventNameLower.includes('ertelendi') || 
                                    eventNameLower.includes('postponed') || 
                                    eventNameLower.includes('cancelled');
                
                if (isCancelled) {
                    console.log(`🗑️ İptal edilen maç atlandı: ${broadcastEvent.name}`);
                    return;
                }
                
                const startDate = new Date(broadcastEvent.startDate);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                
                if (!allMatches[dateStr]) return;
                
                let channels = [];
                if (Array.isArray(event.broadcastChannel)) {
                    channels = event.broadcastChannel.map(ch => ch.name).filter(n => n);
                } else if (event.broadcastChannel?.name) {
                    channels = [event.broadcastChannel.name];
                }
                
                const channelStr = channels.length > 0 ? channels.join(' / ') : 'Bilinmiyor';
                let eventName = broadcastEvent.name || '';
                
                if (eventName.includes(' - ') || eventName.includes(' vs ')) {
                    const time = startDate.toLocaleTimeString('tr-TR', { 
                        timeZone, 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                    
                    allMatches[dateStr].matches.push({
                        saat: time,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: eventName,
                        yayin: channelStr
                    });
                }
            });
            
            await browser.close();
            
        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
            await browser.close();
        }
    }
    
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
