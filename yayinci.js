const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
    const d = new Date();
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 2);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    const nextDayStr = nextDay.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [nextDayStr]: { title: `📅 ERTESİ GÜN (${nextDay.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };

    console.log("🚀 Maç Saati Kesin Arındırma ve Takvim Senkronizasyonu başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--blink-features=AutomationControlled']
    });

    // 🎯 SİSTEMİ TARİHLERE GÖRE DÖNDÜRÜYORUZ (Gelecek günler bu sayede dolacak)
    const targetDates = [todayStr, tomorrowStr, nextDayStr];

    for (const dateKey of targetDates) {
        console.log(`\n📅 ${dateKey} tarihi için maçlar toplanıyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            // Sitenin tarih bazlı çalışan güncel dinamik URL yapısı
            const url = `https://www.sporekrani.com/?date=${dateKey}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));

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

            // Gelen dataları filtreleme odasına alıyoruz
            extractedData.forEach(item => {
                const matchName = item.macName.trim();
                const matchLower = matchName.toLowerCase();
                const channelLower = item.yayin.toLowerCase();
                
                // 🛑 1. PROGRAM, REKLAM VE SEO LİNK TEMİZLİĞİ
                if (
                    matchLower.includes('izle') || 
                    matchLower.includes('bülteni') || 
                    matchLower.includes('stüdyosu') ||
                    matchLower.includes('vuruşu') ||
                    matchLower.includes('baski') ||
                    matchLower.includes('sporu') ||
                    matchLower.includes('ortasi') ||
                    matchLower.includes('ana haber') ||
                    matchLower.includes('raporu') ||
                    matchLower.includes('etap') ||
                    matchLower.includes('arasi') ||
                    matchLower.includes('ardından') ||
                    matchLower.includes('ekranı') ||
                    matchLower.includes('indirimle') ||
                    matchName.length < 5
                ) {
                    return; 
                }

                // 🛑 2. DİĞER SPOR DALLARINI (VOLEYBOL, PADEL, F1, MOTOR SPORLARI) TEMİZLEME
                if (
                    matchLower.includes('vnl') || 
                    matchLower.includes('voleybol') || 
                    matchLower.includes('padel') || 
                    matchLower.includes('nascar') || 
                    matchLower.includes('f1') || 
                    matchLower.includes('formula') || 
                    matchLower.includes('moto gp') ||
                    matchLower.includes('/') // Tenis çiftler maçı pürüzlerini (Metin/Metin formatı) ayıklar
                ) {
                    return;
                }

                // İptal Filtresi
                if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

                // Tarih & Saat Doğrulaması
                const startDate = new Date(item.rawDate);
                if (isNaN(startDate.getTime()) || startDate.getFullYear() < 2024) return;
                
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                if (dateStr !== dateKey) return; // Sadece o günün sayfasına ait maçı al

                const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                    timeZone, 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

                // 🎯 3. SPOR DALINI METİN ANALİZİYLE DOĞRU TESPİT ETME
                let detectedSport = 'Futbol'; // Varsayılan
                if (
                    matchLower.includes('nba') || 
                    matchLower.includes('euroleague') || 
                    matchLower.includes('basketbol') || 
                    matchLower.includes('tbl') || 
                    channelLower.includes('basket')
                ) {
                    detectedSport = 'Basketbol';
                } else if (
                    matchLower.includes('wta') || 
                    matchLower.includes('atp') || 
                    matchLower.includes('tenis') || 
                    matchLower.includes('wimbledon') || 
                    matchLower.includes('open')
                ) {
                    detectedSport = 'Tenis';
                }

                const formattedChannel = item.yayin
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');

                allMatches[dateKey].matches.push({
                    saat: timeStr,
                    spor: detectedSport,
                    mac: matchName.toUpperCase(),
                    yayin: formattedChannel
                });
            });

        } catch (error) {
            console.error(`🚨 ${dateKey} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Tabloyu Yazdır ve Dosyayı Kaydet
    [todayStr, tomorrowStr, nextDayStr].forEach(key => {
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
    console.log("\n💾 yayinci_bilgisi.json sadece futbol, basketbol ve tenis maçlarıyla güncellendi!");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
