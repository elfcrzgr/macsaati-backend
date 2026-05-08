const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    
    // Sistem saatine göre bugün ve yarını hesapla
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // 🚀 DÜZELTME 1: toISOString() yerine Türkiye saat dilimine göre YYYY-MM-DD alıyoruz
    const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    
    console.log(`📅 Bugün: ${todayStr}`);
    console.log(`📅 Yarın: ${tomorrowStr}\n`);
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };
    
    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...\n`);
        
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // JSON-LD'yi al
            const jsonLdData = await page.evaluate(() => {
                const script = document.querySelector('script[type="application/ld+json"]');
                if (script) {
                    try {
                        return JSON.parse(script.innerHTML);
                    } catch (e) {
                        return null;
                    }
                }
                return null;
            });
            
            if (!jsonLdData) {
                console.log(`⚠️ ${sport}: JSON-LD bulunamadı`);
                await browser.close();
                continue;
            }
            
            // BroadcastEvent'leri işle
            const events = Array.isArray(jsonLdData) ? jsonLdData : [jsonLdData];
            console.log(`✅ ${sport}: ${events.length} event bulundu`);
            
            events.forEach(event => {
                if (event['@type'] !== 'BroadcastEvent') return;
                
                const broadcastEvent = event.broadcastOfEvent;
                if (!broadcastEvent) return;
                
                const startDate = new Date(broadcastEvent.startDate);
                
                // 🚀 DÜZELTME 2: Maçın gününü de Türkiye saatine göre belirliyoruz (Gece maçları dünün listesine düşmesin diye)
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                
                if (!allMatches[dateStr]) return;
                
                // broadcastChannel ARRAY olabilir veya single object
                let channels = [];
                if (Array.isArray(event.broadcastChannel)) {
                    channels = event.broadcastChannel.map(ch => ch.name).filter(n => n);
                } else if (event.broadcastChannel?.name) {
                    channels = [event.broadcastChannel.name];
                }
                
                const channelStr = channels.length > 0 ? channels.join(' / ') : 'Bilinmiyor';
                
                // Maç adı
                let eventName = broadcastEvent.name || '';
                
                // Eğer maç gibi görünüyorsa
                if (eventName.includes(' - ') || eventName.includes(' vs ')) {
                    // 🚀 DÜZELTME 3: İŞTE 3 SAAT FARKINI ÇÖZEN SATIR!
                    const time = startDate.toLocaleTimeString('tr-TR', { 
                        timeZone: 'Europe/Istanbul', // Saati Türkiye'ye zorla
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
    
    // Sonuçları göster
    console.log("\n" + "=".repeat(100));
    [todayStr, tomorrowStr].forEach(key => {
        const group = allMatches[key];
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        
        if (group.matches.length === 0) {
            console.log("   ⚠️ Maç bulunamadı.");
        } else {
            // Mükerrer kontrol
            const uniqueMatches = Array.from(
                new Set(group.matches.map(JSON.stringify))
            ).map(JSON.parse);
            
            // Saate göre sırala
            const sorted = uniqueMatches.sort((a, b) => 
                a.saat.localeCompare(b.saat)
            );
            
            console.table(sorted);
            console.log(`   ✅ Toplam ${sorted.length} maç`);
        }
    });
    
    // Dosyaya kaydet
    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json dosyasına kaydedildi");
}

getBroadcasterData().catch(e => {
    console.error("🚨 Fatal Error:", e);
    process.exit(1);
});
