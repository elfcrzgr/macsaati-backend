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

    console.log("🚀 Maç Saati DOM Kazıma ve Gelecek Günleri Kurtarma Modu...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--blink-features=AutomationControlled']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası kazınıyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            // Tam olarak istediğin, gelecek günleri de barındıran orijinal URL yapısı
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            
            // Sayfanın tamamen yüklenmesi ve listelerin oturması için es veriyoruz
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 4000)));

            // Ekrandaki HTML elementlerinden canlı kazıma yapıyoruz
            const scrapedItems = await page.evaluate(() => {
                const results = [];
                // Sitedeki maç satırlarını temsil eden kart elemanları
                const items = document.querySelectorAll('.match-list-item, .match-item, [class*="match-list"]');
                
                items.forEach(item => {
                    try {
                        // 1. Saat tespiti
                        const timeEl = item.querySelector('.time, .hour, [class*="time"]');
                        const saat = timeEl ? timeEl.innerText.trim() : '';

                        // 2. Maç/Program metni tespiti
                        const nameEl = item.querySelector('.match-name, .title, .teams, h3, h4, [class*="name"]');
                        let mac = nameEl ? nameEl.innerText.trim() : '';

                        // Takımlar alt kırılımdaysa birleştir
                        if (!mac) {
                            const home = item.querySelector('.home-team-name, [class*="home"]')?.innerText?.trim() || '';
                            const away = item.querySelector('.away-team-name, [class*="away"]')?.innerText?.trim() || '';
                            if (home && away) mac = `${home} - ${away}`;
                        }

                        // 3. Yayıncı kanal tespiti
                        let yayin = '';
                        const channelEl = item.querySelector('.channel-name-text, .channels, [class*="channel"]');
                        if (channelEl && channelEl.innerText.trim()) {
                            yayin = channelEl.innerText.trim();
                        } else {
                            // Text yoksa logolara bak
                            const imgs = item.querySelectorAll('img');
                            const channelList = [];
                            imgs.forEach(img => {
                                const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                                if (alt && !alt.toLowerCase().includes('logo') && alt.length > 2) {
                                    channelList.push(alt.replace(/logosu/gi, '').trim());
                                }
                            });
                            if (channelList.length > 0) yayin = channelList.join(' / ');
                        }

                        // Tarih tespiti: Bu satır hangi günün başlığı altında duruyor?
                        // DOM ağacında yukarı doğru çıkıp en yakın tarih başlığını (Örn: "9 Haziran Salı") bulmaya çalışıyoruz
                        let dateText = '';
                        let parent = item.parentElement;
                        while (parent) {
                            const dateHeader = parent.querySelector('.date-header, .match-date-title, [class*="date"]');
                            if (dateHeader && dateHeader.innerText.trim()) {
                                dateText = dateHeader.innerText.trim();
                                break;
                            }
                            parent = parent.parentElement;
                        }

                        if (saat && mac) {
                            results.push({ saat, mac, yayin: yayin || 'Spor Ekranı', dateText });
                        }
                    } catch (e) {}
                });
                return results;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Sayfadan ${scrapedItems.length} adet satır okundu. Filtreleniyor...`);

            scrapedItems.forEach(item => {
                const matchName = item.mac.trim();
                const matchLower = matchName.toLowerCase();

                // 🛑 PROGRAM, BÜLTEN VE REKLAM TEMİZLEYİCİ KESİN FİLTRE
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
                    matchLower.includes('özeti') ||
                    !matchLower.includes('-') // İçinde takım ayracı (tire) olmayan düz programları eler
                ) {
                    return; 
                }

                // Voleybol veya diğer sporların sızmasını önleme doğrulaması
                if (matchLower.includes('vnl') || matchLower.includes('voleybol') || matchLower.includes('padel')) {
                    return;
                }

                // 🎯 TARİH DOĞRULAMA VE GÜNLERE DAĞITMA
                let targetKey = todayStr; // Varsayılan bugün
                const dtLower = item.dateText.toLowerCase();
                
                // Sayfadaki tarih başlığı metnine göre Yarın veya Ertesi günü buluyoruz
                if (dtLower.includes('yarın') || dtLower.includes(new Date(tomorrow).getDate().toString())) {
                    targetKey = tomorrowStr;
                } else if (dtLower.includes('ertesi') || dtLower.includes(new Date(nextDay).getDate().toString())) {
                    targetKey = nextDayStr;
                }

                allMatches[targetKey].matches.push({
                    saat: item.saat,
                    spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                    mac: matchName.toUpperCase(),
                    yayin: item.yayin
                });
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Konsol Tabloları
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
    console.log("\n💾 yayinci_bilgisi.json sadece gerçek maçlarla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
