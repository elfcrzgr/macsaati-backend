const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const timeZone = 'Europe/Istanbul';
    const d = new Date();
    const todayStr = d.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${d.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };

    console.log("🚀 Sadece Bugünün Gerçek Maçları DOM Üzerinden Toplanıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 1024 }); // Sayfa kartları net yüklensin diye dikey boyutu büyüttük

    try {
        // Doğrudan ana sayfayı açıyoruz, her şey zaten orada listeleniyor
        const url = `https://www.sporekrani.com/`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
        
        // Sayfanın ve resimlerin/ikonların tam oturması için 4 saniye kesin bekleme
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 4000)));

        // 🎯 EKANDAKİ GERÇEK KARTLARI İKONLARINA GÖRE AYIKLAYAN DOM ALGORİTMASI
        const scrapedMatches = await page.evaluate(() => {
            const results = [];
            // Sitedeki her bir maç/yayın satırını yakala
            const items = document.querySelectorAll('.match-list-item, [class*="match-list-item"]');
            
            items.forEach(item => {
                try {
                    // 1. İkon üzerinden gerçek spor dalını tespit etme
                    // Site futbol için top ikonu, basket için basketbol topu ikonu kullanıyor
                    let detectedSport = '';
                    const icon = item.querySelector('i[class*="fa-"]');
                    if (icon) {
                        const iconClass = icon.className.toLowerCase();
                        if (iconClass.includes('soccer') || iconClass.includes('football')) {
                            detectedSport = 'Futbol';
                        } else if (iconClass.includes('basket')) {
                            detectedSport = 'Basketbol';
                        } else if (iconClass.includes('tennis') || iconClass.includes('ball')) {
                            // Sitenin tenis için kullandığı özel ikon veya top sınıfı
                            detectedSport = 'Tenis';
                        }
                    }

                    // Eğer spor dalı bizim istediklerimizden biri değilse (Voleybol, F1, At yarışı vb.) direkt atla
                    if (!detectedSport) return;

                    // 2. Saat tespiti
                    const timeEl = item.querySelector('.time, [class*="time"], [class*="hour"]');
                    const saat = timeEl ? timeEl.innerText.trim() : '';

                    // 3. Takımlar / Maç Adı tespiti
                    const home = item.querySelector('.home-team-name, [class*="home-team"]')?.innerText?.trim() || '';
                    const away = item.querySelector('.away-team-name, [class*="away-team"]')?.innerText?.trim() || '';
                    let mac = (home && away) ? `${home} - ${away}` : '';

                    if (!mac) {
                        const titleEl = item.querySelector('.match-name, .title, h3');
                        if (titleEl) mac = titleEl.innerText.trim();
                    }

                    // 4. Yayıncı kanal tespiti (Yazı veya Logo alt metni)
                    let yayin = '';
                    const channelEl = item.querySelector('.channel-name-text, [class*="channel-name"]');
                    if (channelEl && channelEl.innerText.trim()) {
                        yayin = channelEl.innerText.trim();
                    } else {
                        const imgs = item.querySelectorAll('img');
                        const channelList = [];
                        imgs.forEach(img => {
                            const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                            if (alt && !alt.toLowerCase().includes('logo') && alt.length > 1) {
                                channelList.push(alt.replace(/logosu/gi, '').trim());
                            }
                        });
                        if (channelList.length > 0) yayin = channelList.join(' / ');
                    }

                    if (saat && mac && mac.includes('-')) {
                        results.push({ saat, spor: detectedSport, mac, yayin: yayin || 'Spor Ekranı' });
                    }
                } catch (e) {}
            });
            return results;
        });

        console.log(`🔍 Ekranda görünür durumdaki ${scrapedMatches.length} adet ham kart analiz ediliyor...`);

        scrapedMatches.forEach(m => {
            const matchLower = m.mac.toLowerCase();
            
            // Stüdyo programı temizliği (Hala sızan varsa diye filtre odası)
            if (
                matchLower.includes('bülteni') || 
                matchLower.includes('stüdyosu') || 
                matchLower.includes('ana haber') ||
                matchLower.includes('programı') ||
                matchLower.includes('maçın ardından')
            ) {
                return;
            }

            allMatches[todayStr].matches.push({
                saat: m.saat,
                spor: m.spor,
                mac: m.mac.toUpperCase().trim(),
                yayin: m.yayin
            });
        });

    } catch (error) {
        console.error(`🚨 Hata oluştu:`, error.message);
    } finally {
        await page.close();
    }

    await browser.close();

    // Tabloyu Yazdır
    const group = allMatches[todayStr];
    console.log(`\n\x1b[33m${group.title}\x1b[0m`);
    
    if (group.matches.length === 0) {
        console.log("   ⚠️ Maç bulunamadı.");
    } else {
        const uniqueMatches = Array.from(new Set(group.matches.map(JSON.stringify))).map(JSON.parse);
        const sorted = uniqueMatches.sort((a, b) => a.saat.localeCompare(b.saat));
        console.table(sorted);
    }

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json sadece bugünün net maçlarıyla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
