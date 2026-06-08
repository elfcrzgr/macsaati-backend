const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
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

    console.log("🚀 Ana Sayfa Şema Deşifre ve Temizlik Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    try {
        // Kesin açılan tek ve ana güvenli URL
        const url = `https://www.sporekrani.com/`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

        const rawDataList = await page.evaluate(() => {
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
                            
                            // Sitenin gizli tuttuğu spor branş parametreleri
                            const rawSport = obj.sport?.slug || obj.sport || subEvent.sport || '';
                            
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
                                    sportInfo: typeof rawSport === 'string' ? rawSport : (rawSport.name || ''),
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

        console.log(`🔍 Ana Sayfadan ${rawDataList.length} adet ham yayın verisi söküldü. Arındırma odasına alınıyor...`);

        rawDataList.forEach(item => {
            const matchName = item.macName.trim();
            const matchLower = matchName.toLowerCase();
            const sportLower = item.sportInfo.toLowerCase();
            const channelLower = item.yayin.toLowerCase();

            // 🛑 1. PROGRAM, REKLAM VE BÜLTEN SÜZGECİ
            if (
                matchLower.includes('canlı maç izle') || 
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
                matchLower.includes('özeti') ||
                matchLower.includes('programı') ||
                matchLower.includes('dergisi') ||
                matchName.length < 5
            ) {
                return; 
            }

            // 🛑 2. VOLEYBOL, MOTOR SPORLARI VE DİĞER BRANŞLARI ELİYORUZ
            if (
                matchLower.includes('vnl') || 
                matchLower.includes('voleybol') || 
                matchLower.includes('padel') ||
                matchLower.includes('f1') ||
                matchLower.includes('formula') ||
                matchLower.includes('nascar') ||
                matchLower.includes('motogp') ||
                sportLower.includes('voleybol') ||
                sportLower.includes('padel') ||
                sportLower.includes('motor')
            ) {
                return;
            }

            // İptal kontrolü
            if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

            // Tarih kontrolü ve senkronizasyonu
            const startDate = new Date(item.rawDate);
            if (isNaN(startDate.getTime()) || startDate.getFullYear() < 2024) return;

            const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

            // Eğer listedeki günlerin dışındaysa pas geç
            if (!allMatches[dateStr]) return;

            const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                timeZone, 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            // 🎯 3. METİN ANALİZİYLE BRANŞ TESPİTİ (FUTBOL / BASKETBOL / TENIS)
            let detectedSport = 'Futbol'; // Varsayılan futbol
            if (
                matchLower.includes('nba') || 
                matchLower.includes('euroleague') || 
                matchLower.includes('basketbol') || 
                matchLower.includes('tbl') || 
                sportLower.includes('basket') ||
                channelLower.includes('basket')
            ) {
                detectedSport = 'Basketbol';
            } else if (
                matchLower.includes('wta') || 
                matchLower.includes('atp') || 
                matchLower.includes('tenis') || 
                matchLower.includes('wimbledon') || 
                matchLower.includes('open') ||
                sportLower.includes('tenis')
            ) {
                detectedSport = 'Tenis';
            }

            // Eğer isme takılan çiftler maçı veya padel kalıntısı varsa temizle
            if (detectedSport === 'Tenis' && matchName.includes('/')) return;

            const formattedChannel = item.yayin
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');

            allMatches[dateStr].matches.push({
                saat: timeStr,
                spor: detectedSport,
                mac: matchName.toUpperCase(),
                yayin: formattedChannel
            });
        });

    } catch (error) {
        console.error(`🚨 Ana sayfa hatası:`, error.message);
    } finally {
        await page.close();
    }

    await browser.close();

    // Çıktı Ekranı
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
    console.log("\n💾 yayinci_bilgisi.json sadece futbol, basketbol ve tenis maçlarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
