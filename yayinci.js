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

    console.log("🚀 Puppeteer Filtreleme ve Saat Senkronizasyon Modu...");

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
        console.log(`\n📡 ${sport.toUpperCase()} sayfası analiz ediliyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            const url = `https://www.sporekrani.com/?sport=${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

            const extractedData = await page.evaluate(() => {
                const list = [];
                const allScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                
                allScripts.forEach(script => {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        
                        function scan(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            
                            if (obj['@type'] === 'BroadcastEvent' || obj.broadcastOfEvent) {
                                const subEvent = obj.broadcastOfEvent || {};
                                const rawName = subEvent.name || obj.name || '';
                                const rawDate = obj.startDate || subEvent.startDate || '';
                                
                                // Branş kontrolü için şemadaki alt kategorileri kovalıyoruz
                                const itemSport = obj.sport?.slug || obj.sport || subEvent.sport || '';
                                
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
                                        sportCategory: itemSport,
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

            extractedData.forEach(item => {
                const matchName = item.macName.trim();
                const matchLower = matchName.toLowerCase();
                
                // 🛑 GELİŞMİŞ FİLTRELEME: TV Programlarını, stüdyo yayınlarını ve reklamları uçurur
                if (
                    matchLower.includes('canlı maç izle') || 
                    matchLower.includes('haber bülteni') || 
                    matchLower.includes('spor stüdyosu') ||
                    matchLower.includes('başlama vuruşu') ||
                    matchLower.includes('ilk baski') ||
                    matchLower.includes('sabah sporu') ||
                    matchLower.includes('gün ortasi') ||
                    matchLower.includes('ana haber') ||
                    matchLower.includes('transfer raporu') ||
                    matchLower.includes('etap') ||
                    matchLower.includes('satir arasi') ||
                    matchLower.includes('izle') ||
                    matchName.length < 5
                ) {
                    return; 
                }

                // İptal Kontrolü
                if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

                // Tarih dönüşümünü güvenli yapıyoruz
                const startDate = new Date(item.rawDate);
                if (isNaN(startDate.getTime())) return;
                
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

                // Sadece hedeflediğimiz 4 günün verisiyse havuzuna ekle
                if (!allMatches[dateStr]) return;

                const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                    timeZone, 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

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

    // Çıktı ve Sıralama Kontrolü
    [yesterdayStr, todayStr, tomorrowStr, nextDayStr].forEach(key => {
        const group = allMatches[key];
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        
        if (group.matches.length === 0) {
            console.log("   ⚠️ Maç bulunamadı.");
        } else {
            // Tamamen benzersiz maçları filtrele ve saate göre diz
            const uniqueMatches = Array.from(new Set(group.matches.map(JSON.stringify))).map(JSON.parse);
            const sorted = uniqueMatches.sort((a, b) => a.saat.localeCompare(b.saat));
            console.table(sorted);
        }
    });

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json tamamen arındırılmış ve güncellenmiştir!");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
