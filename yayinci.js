const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
    const d = new Date();
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };
    
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} verileri yeni API üzerinden çekiliyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Ağ trafiğini dinleyerek sitenin çektiği saf JSON'ı yakalıyoruz
        await page.setRequestInterception(true);
        let capturedJson = null;

        page.on('request', (request) => {
            request.continue();
        });

        page.on('response', async (response) => {
            const url = response.url();
            // Yeni altyapıda maç verilerini içeren API isteklerini avlıyoruz
            if (url.includes('/api/') && response.headers()['content-type']?.includes('application/json')) {
                try {
                    const json = await response.json();
                    // Gelen veri bir dizi ise ve içinde maç datası barındırıyorsa kaydet
                    if (Array.isArray(json) && json.length > 0) {
                        capturedJson = json;
                    } else if (json.data && Array.isArray(json.data)) {
                        capturedJson = json.data;
                    }
                } catch (e) {}
            }
        });

        try {
            // Sitenin yeni yönlendirmeli URL yapısı (?sport=...)
            const targetUrl = `https://www.sporekrani.com/?sport=${sport}`;
            await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 40000 });
            
            // Eğer networkidle0'a rağmen API hemen düşmediyse kısa bir es veriyoruz
            if (!capturedJson) {
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
            }

            if (!capturedJson) {
                console.log(`⚠️ ${sport.toUpperCase()}: Yeni API verisi yakalanamadı, DOM yedek planı çalıştırılıyor...`);
                
                // --- DOM YEDEK PLANI ---
                // Eğer API isteği bir şekilde ıskalanırsa ekrandaki güncel seçicilerden veriyi söküyoruz
                const domMatches = await page.evaluate(() => {
                    const res = [];
                    // Sitenin yeni arayüzündeki maç satırları ve kapsayıcıları
                    const cards = document.querySelectorAll('[class*="match-list-item"], [class*="MatchCard"], .match-item');
                    cards.forEach(card => {
                        const timeText = card.querySelector('[class*="time"], [class*="hour"]')?.innerText?.trim() || '';
                        const home = card.querySelector('[class*="home-team"]')?.innerText?.trim() || '';
                        const away = card.querySelector('[class*="away-team"]')?.innerText?.trim() || '';
                        const channels = Array.from(card.querySelectorAll('[class*="channel-name"], [class*="broadcaster"]')).map(el => el.innerText.trim()).filter(t => t);
                        
                        if (timeText && home && away) {
                            res.push({
                                saat: timeText,
                                mac: `${home} - ${away}`,
                                yayin: channels.length > 0 ? channels.join(' / ') : 'Spor Ekranı'
                            });
                        }
                    });
                    return res;
                });

                if (domMatches.length > 0) {
                    capturedJson = domMatches;
                }
            }

            if (capturedJson && Array.isArray(capturedJson)) {
                console.log(`🔍 ${sport.toUpperCase()}: ${capturedJson.length} adet ham maç verisi çözümleniyor...`);

                capturedJson.forEach(item => {
                    try {
                        let saat = item.saat || '';
                        let mac = item.mac || '';
                        let yayin = item.yayin || item.channels || item.broadcaster || 'Spor Ekranı';

                        // Eğer veri doğrudan bizim sakladığımız DOM formatında değilse, sitenin ham API şemasından parse et
                        if (item.startDate || item.matchDate) {
                            const matchDate = new Date(item.startDate || item.matchDate);
                            saat = matchDate.toLocaleTimeString('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });
                            
                            const home = item.homeTeam?.name || item.homeTeam || '';
                            const away = item.awayTeam?.name || item.awayTeam || '';
                            mac = `${home} - ${away}`;
                            
                            if (item.channels && Array.isArray(item.channels)) {
                                yayin = item.channels.map(c => c.name || c).join(' / ');
                            }
                        }

                        if (!saat || !mac || mac.length < 3) return;
                        
                        // Kara liste filtreleri
                        const macLower = mac.toLowerCase();
                        if (macLower.includes('iptal') || macLower.includes('ertelendi')) return;

                        // Tarih gruplaması (Gece yarısı kontrolü dahil)
                        const hourPrefix = parseInt(saat.split(':')[0]);
                        const targetStr = (hourPrefix >= 0 && hourPrefix < 4) ? tomorrowStr : todayStr;

                        allMatches[targetStr].matches.push({
                            saat: saat,
                            spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                            mac: mac.toUpperCase(),
                            yayin: typeof yayin === 'string' ? yayin : 'Spor Ekranı'
                        });
                    } catch (e) {}
                });
            } else {
                console.log(`❌ ${sport.toUpperCase()}: Hiçbir yöntemle veri alınamadı.`);
            }

        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Tablo Çıktısı
    [todayStr, tomorrowStr].forEach(key => {
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
    console.log("\n💾 yayinci_bilgisi.json başarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
