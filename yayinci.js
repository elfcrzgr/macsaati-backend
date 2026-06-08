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

    console.log("🚀 Sadece Ana Gövdedeki Gerçek Maç Kartları Filtreleniyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--blink-features=AutomationControlled']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası kazınıyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 1024 });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

            // 🎯 NOKTA ATIŞI DOM SEÇİCİ (Sadece ana listedeki maçları alır, sağ-sol reklam kutularını engeller)
            const scrapedItems = await page.evaluate(() => {
                const results = [];
                
                // Sitenin orta gövdesindeki her bir gün bloğunu buluyoruz
                // Genellikle tarih başlığı ve altındaki maç kartları bir wrapper içindedir
                const dayBlocks = document.querySelectorAll('.match-list, [class*="match-list-container"], [class*="daily-matches"]');
                
                // Eğer site genel kapsayıcı kullanıyorsa doğrudan kartları kovala ama sadece orta sütundakileri
                const items = document.querySelectorAll('.match-list-item, .match-item');
                
                items.forEach(item => {
                    // Güvenlik Kontrolü: Eğer kart, sağ taraftaki "öne çıkanlar" veya "popüler" gibi bir yan menünün içindeyse İPTAL ET
                    if (item.closest('aside') || item.closest('.sidebar') || item.closest('[class*="sidebar"]') || item.closest('[class*="popular"]')) {
                        return; 
                    }

                    try {
                        // 1. Saat
                        const timeEl = item.querySelector('.time, .hour, [class*="time"]');
                        const saat = timeEl ? timeEl.innerText.trim() : '';

                        // 2. Takımlar
                        const home = item.querySelector('.home-team-name, [class*="home-team"]')?.innerText?.trim() || '';
                        const away = item.querySelector('.away-team-name, [class*="away-team"]')?.innerText?.trim() || '';
                        let mac = (home && away) ? `${home} - ${away}` : '';

                        if (!mac) {
                            const nameEl = item.querySelector('.match-name, .title, h3, h4');
                            if (nameEl) mac = nameEl.innerText.trim();
                        }

                        // 3. Kanal (Sadece logo alt etiketlerini veya temiz kanal yazılarını al)
                        let yayin = '';
                        const channelEl = item.querySelector('.channel-name-text, .channels, [class*="channel"]');
                        if (channelEl && channelEl.innerText.trim()) {
                            yayin = channelEl.innerText.trim();
                        } else {
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

                        // 4. Tarih Başlığı (Bu kart hangi günün altındaysa o metni yukarı doğru tırmanarak bul)
                        let dateText = '';
                        let sibling = item.previousElementSibling;
                        while (sibling) {
                            if (sibling.matches('.date-header, .match-date-title, [class*="date"], h2, h3')) {
                                dateText = sibling.innerText.trim();
                                break;
                            }
                            sibling = sibling.previousElementSibling;
                        }
                        
                        // Eğer sibling ile bulamadıysa üst kapsayıcının başlığına bak
                        if (!dateText) {
                            const parentHeader = item.closest('[class*="container"]')?.querySelector('[class*="title"], [class*="header"]');
                            if (parentHeader) dateText = parentHeader.innerText.trim();
                        }

                        if (saat && mac && mac.includes('-')) {
                            results.push({ saat, mac, yayin: yayin || 'Spor Ekranı', dateText });
                        }
                    } catch (e) {}
                });
                return results;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Ana listeden ${scrapedItems.length} adet maç kartı söküldü.`);

            scrapedItems.forEach(item => {
                const matchName = item.mac.trim();
                const matchLower = matchName.toLowerCase();

                // Stüdyo Programları Filtresi
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
                    matchLower.includes('özeti') ||
                    matchLower.includes('programı')
                ) {
                    return; 
                }

                // Voleybol / Diğer sporları sızma ihtimaline karşı engelleme
                if (matchLower.includes('vnl') || matchLower.includes('voleybol') || matchLower.includes('padel')) {
                    return;
                }

                // 🎯 Gün Dağılımını Sitedeki Gerçek Başlıklara Göre Yapma
                let targetKey = todayStr;
                const dtLower = item.dateText ? item.dateText.toLowerCase() : '';
                
                if (dtLower.includes('yarın') || dtLower.includes(new Date(tomorrow).getDate().toString())) {
                    targetKey = tomorrowStr;
                } else if (dtLower.includes('ertesi') || dtLower.includes(new Date(nextDay).getDate().toString())) {
                    targetKey = nextDayStr;
                }

                // 🧹 Yayıncı sütunundaki lig isimlerini ve artıkları temizleme (Rötuş)
                let cleanYayin = item.yayin
                    .replace(/fifa \d{4} dünya kupasi/gi, '')
                    .replace(/yunanistan süper ligi/gi, '')
                    .replace(/abd usl championship/gi, '')
                    .replace(/fiba dünya kupasi elemeleri/gi, '')
                    .replace(/i̇spanya la liga \d play-off yarı final/gi, '')
                    .replace(/basketbol süper ligi.*/gi, '')
                    .replace(/i̇talya basketbol.*/gi, '')
                    .replace(/wta londra/gi, '')
                    .replace(/atp halle/gi, '')
                    .replace(/atp stuttgart.*/gi, '')
                    .replace(/atp hertogenbosch.*/gi, '')
                    .replace(/wnba/gi, '')
                    .replace(/fiba tv/gi, '')
                    .replace(/[\/]+/g, '/') // Çift slash pürüzlerini teke indirir
                    .replace(/^[ \/]+|[ \/]+$/g, '') // Başta ve sondaki slash'leri siler
                    .trim();

                if (!cleanYayin || cleanYayin === '/') cleanYayin = 'Spor Ekranı';

                allMatches[targetKey].matches.push({
                    saat: item.saat,
                    spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                    mac: matchName.toUpperCase(),
                    yayin: cleanYayin
                });
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Tabloları Çıkar
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
    console.log("\n💾 yayinci_bilgisi.json sadece gerçek ve bugünkü maçlarla başarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
