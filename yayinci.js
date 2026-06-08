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

    console.log("🚀 Puppeteer Profesyonel Filtre Modu başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--blink-features=AutomationControlled'
        ]
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası işleniyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            const url = `https://www.sporekrani.com/?sport=${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            
            // Sayfanın belleğe oturması için kısa es
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

            const extractedData = await page.evaluate(() => {
                const list = [];
                const allScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                
                allScripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        
                        // Şemaları derinlemesine tarayan dahili fonksiyon
                        function scan(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            
                            // Tam aradığımız BroadcastEvent yapısını süzüyoruz
                            if (obj['@type'] === 'BroadcastEvent' || obj.broadcastOfEvent) {
                                const subEvent = obj.broadcastOfEvent || {};
                                const rawName = subEvent.name || obj.name || '';
                                const rawDate = obj.startDate || subEvent.startDate || '';
                                
                                // Kanal bilgisini toplama esnekliği
                                let channelNames = [];
                                const rawChannels = obj.broadcastChannel || obj.channels || [];
                                const channelArr = Array.isArray(rawChannels) ? rawChannels : [rawChannels];
                                
                                channelArr.forEach(c => {
                                    if (!c) return;
                                    if (typeof c === 'string') channelNames.push(c);
                                    else if (c.name) channelNames.push(c.name);
                                    else if (c['@id']) {
                                        const slug = c['@id'].split('/').pop().split('#')[0];
                                        if (slug) channelNames.push(slug.replace(/-/g, ' '));
                                    }
                                });
                                
                                if (rawName && rawDate) {
                                    list.push({
                                        macName: rawName,
                                        rawDate: rawDate,
                                        yayin: channelNames.length > 0 ? channelNames.join(' / ') : 'Spor Ekranı'
                                    });
                                }
                            }
                            
                            for (const key in obj) {
                                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                                    scan(obj[key]);
                                }
                            }
                        }
                        
                        scan(data);
                    } catch (e) {}
                });
                return list;
            });

            console.log(`🔍 ${sport.toUpperCase()}: ${extractedData.length} adet ham maç verisi süzülüyor...`);

            // Verileri temizleme ve 4 günlük takvime dağıtma
            extractedData.forEach(item => {
                const matchName = item.macName.trim();
                
                // SEO Başlıklarını ve reklamları çöpe atıyoruz (Filtreleme)
                if (matchName.toLowerCase().includes('spor ekranı') || matchName.toLowerCase().includes('izle') || matchName.length < 5) {
                    return; 
                }

                // Kara Liste Filtresi
                const matchLower = matchName.toLowerCase();
                if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

                const startDate = new Date(item.rawDate);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

                if (!allMatches[dateStr]) return; // Hedef günler dışındaysa geç

                const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                    timeZone, 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

                // Güzel formatlama (Kanal isimlerinin baş harflerini büyüt)
                const formattedChannel = item.yayin
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');

                allMatches[dateStr].matches.push({
                    saat: timeStr,
                    spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                    mac: matchName.toUpperCase(),
                    yayin: formattedChannel
                });
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Çıktı ve Kayıt Düzeni
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
    console.log("\n💾 yayinci_bilgisi.json başarıyla güncellendi. İşlem tamam!");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
