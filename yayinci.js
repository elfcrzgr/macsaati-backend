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
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası açılıyor...`);
        
        const browser = await puppeteer.launch({ 
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            const jsonLdData = await page.evaluate(() => {
                const script = document.querySelector('script[type="application/ld+json"]');
                if (script) {
                    try { return JSON.parse(script.innerHTML); } catch (e) { return null; }
                }
                return null;
            });
            
            if (!jsonLdData) {
                console.log(`⚠️ ${sport}: JSON-LD bulunamadı.`);
                await browser.close();
                continue;
            }
            
            // Hiyerarşi ne olursa olsun tüm yayın eventlerini derinlemesine bulan recursive fonksiyon
            function extractEvents(obj) {
                let found = [];
                if (!obj || typeof obj !== 'object') return found;
                
                if (obj.broadcastOfEvent || obj['@type'] === 'BroadcastEvent') {
                    found.push(obj);
                }
                
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        found = found.concat(extractEvents(obj[key]));
                    }
                }
                return found;
            }
            
            const events = extractEvents(jsonLdData);
            console.log(`🔍 ${sport.toUpperCase()}: ${events.length} adet ham yayın verisi yakalandı.`);
            
            events.forEach(event => {
                const broadcastEvent = event.broadcastOfEvent;
                if (!broadcastEvent) return;
                
                // --- 1. MAÇ İSMİNİ AYIKLAMA ---
                let eventName = broadcastEvent.name || '';
                
                if (!eventName && broadcastEvent['@id']) {
                    const cleanUrl = broadcastEvent['@id'].split('#')[0];
                    const urlParts = cleanUrl.split('/');
                    let slug = urlParts[urlParts.length - 1];
                    
                    if (!isNaN(slug) && urlParts.length > 1) {
                        slug = urlParts[urlParts.length - 2];
                    }
                    
                    if (slug) {
                        eventName = slug
                            .replace(/-hangi-kanalda/g, '')
                            .replace(/-hazirlik-maci/g, ' (Hazırlık)')
                            .replace(/-/g, ' ')
                            .toUpperCase();
                    }
                }
                
                // 🛑 KARA LİSTE FİLTRESİ
                const eventNameLower = eventName.toLowerCase();
                const isCancelled = eventNameLower.includes('iptal') || 
                                    eventNameLower.includes('ertelendi') || 
                                    eventNameLower.includes('postponed') || 
                                    eventNameLower.includes('cancelled');
                
                if (isCancelled || !eventName) return; 
                
                // Tarih verisini al
                const startDateStr = event.startDate || broadcastEvent.startDate;
                if (!startDateStr) return;

                const startDate = new Date(startDateStr);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                
                if (!allMatches[dateStr]) return;
                
                // --- 2. KANAL İSMİNİ AYIKLAMA ---
                let channels = [];
                const channelList = Array.isArray(event.broadcastChannel) ? event.broadcastChannel : [event.broadcastChannel];
                
                channelList.forEach(ch => {
                    if (!ch) return;
                    if (ch.name) {
                        channels.push(ch.name);
                    } else if (ch['@id']) {
                        const cleanChUrl = ch['@id'].split('#')[0];
                        const chParts = cleanChUrl.split('/');
                        const chSlug = chParts[chParts.length - 1];
                        if (chSlug) {
                            const formattedName = chSlug
                                .split('-')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            channels.push(formattedName);
                        }
                    }
                });
                
                const channelStr = channels.length > 0 ? channels.join(' / ') : 'Bilinmiyor';
                
                if (eventName.length > 3) {
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
