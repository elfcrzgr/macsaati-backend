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
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} verileri API üzerinden yakalanıyor...`);
        const page = await browser.newPage();
        
        // Ağ trafiğini dinleyerek sitenin arka plandaki ham verisini avlıyoruz
        await page.setRequestInterception(true);
        
        let apiData = null;

        page.on('request', (request) => {
            request.continue();
        });

        // Sitenin çektiği tüm JSON cevaplarını filtrele
        page.on('response', async (response) => {
            const url = response.url();
            // Site backend'inden gelen ana maç listesi API'sini yakala
            if (url.includes('/api/') || response.headers()['content-type']?.includes('application/json')) {
                try {
                    const json = await response.json();
                    // Eğer dönen veri şeması bizim aradığımız maç listesiyse kaydet
                    if (Array.isArray(json) || json.data || json.matches || json['@graph']) {
                        apiData = json;
                    }
                } catch (e) {}
            }
        });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            
            // Eğer API yakalanamadıysa geleneksel yöntemle şemayı tekrar tara (Yedek Plan)
            if (!apiData) {
                apiData = await page.evaluate(() => {
                    const script = document.querySelector('script[type="application/ld+json"]');
                    return script ? JSON.parse(script.innerHTML) : null;
                });
            }

            if (!apiData) {
                console.log(`⚠️ ${sport}: Ham veri kaynağı bulunamadı.`);
                await page.close();
                continue;
            }

            // Derinlemesine obje tarama (Recursive)
            function extractBroadcasts(obj) {
                let found = [];
                if (!obj || typeof obj !== 'object') return found;
                if (obj['@type'] === 'BroadcastEvent' && obj.broadcastOfEvent) {
                    found.push(obj);
                }
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        found = found.concat(extractBroadcasts(obj[key]));
                    }
                }
                return found;
            }

            const broadcasts = extractBroadcasts(apiData);
            console.log(`🔍 ${sport.toUpperCase()}: ${broadcasts.length} adet yayın şeması çözümleniyor...`);

            broadcasts.forEach(event => {
                const subEvent = event.broadcastOfEvent;
                if (!subEvent) return;

                // Maç Adı Ayıklama
                let matchName = subEvent.name || '';
                if (!matchName && subEvent['@id']) {
                    const parts = subEvent['@id'].split('#')[0].split('/');
                    const slug = parts[parts.length - 1] || parts[parts.length - 2];
                    if (slug) {
                        matchName = slug.replace(/-hangi-kanalda/g, '').replace(/-/g, ' ').toUpperCase();
                    }
                }
                if (!matchName || matchName.length < 3) return;

                // Kara Liste Filtresi
                const nameLower = matchName.toLowerCase();
                if (nameLower.includes('iptal') || nameLower.includes('ertelendi')) return;

                // Tarih & Saat Ayıklama
                const dateRaw = event.startDate || subEvent.startDate;
                if (!dateRaw) return;

                const startDate = new Date(dateRaw);
                const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

                if (!allMatches[dateStr]) return; // Sadece hedef 4 gün

                const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                    timeZone, 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

                // Yayıncı Kanal Bilgisi Ayıklama (Geliştirilmiş Doğrulama)
                let channelNames = [];
                const channels = Array.isArray(event.broadcastChannel) ? event.broadcastChannel : [event.broadcastChannel];
                
                channels.forEach(ch => {
                    if (!ch) return;
                    if (ch.name) {
                        channelNames.push(ch.name);
                    } else if (ch['@id']) {
                        const chSlug = ch['@id'].split('#')[0].split('/').pop();
                        if (chSlug) {
                            const formatted = chSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            channelNames.push(formatted);
                        }
                    }
                });

                const finalChannel = channelNames.length > 0 ? channelNames.join(' / ') : 'Spor Ekranı Özel';

                allMatches[dateStr].matches.push({
                    saat: timeStr,
                    spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                    mac: matchName.trim(),
                    yayin: finalChannel
                });
            });

        } catch (error) {
            console.error(`🚨 ${sport} tarama hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Çıktıları Sırala ve Kaydet
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
    console.log("\n💾 yayinci_bilgisi.json güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
