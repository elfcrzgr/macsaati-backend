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
        
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2' });
            
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
            
            const events = Array.isArray(jsonLdData) ? jsonLdData : [jsonLdData];
            
            events.forEach(event => {
                if (event['@type'] !== 'BroadcastEvent') return;
                
                const broadcastEvent = event.broadcastOfEvent;
                if (!broadcastEvent) return;
                // 🛑 KARA LİSTE FİLTRESİ
    const eventNameLower = (broadcastEvent.name || '').toLowerCase();
    const isCancelled = eventNameLower.includes('iptal') || 
                        eventNameLower.includes('ertelendi') || 
                        eventNameLower.includes('postponed') || 
                        eventNameLower.includes('cancelled');
    
    if (isCancelled) {
        console.log(`🗑️ İptal edilen maç atlandı: ${broadcastEvent.name}`);
        return; // Bu maçı listeye hiç ekleme
    }
                
                
                const startDate = new Date(broadcastEvent.startDate);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                
                // Sadece listemizde olan 4 günün verisini al
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
