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

    console.log("🚀 Görünmez API Avcısı ve Saf Metin Kazıma Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası hedefleniyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 1024 });

        // Bot korumalarından sıyrılmak için webdriver izini siliyoruz
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        let apiData = [];

        // 🎯 1. KATMAN: SAYFANIN ARKA PLANDA ÇEKTİĞİ GİZLİ VERİLERİ HAVADA YAKALAMA
        page.on('response', async (response) => {
            if (['fetch', 'xhr'].includes(response.request().resourceType())) {
                try {
                    const json = await response.json();
                    // Gelen JSON içindeki maç dizilerini bulmak için tüm objeyi tarar
                    function findMatchArray(obj) {
                        if (Array.isArray(obj)) {
                            if (obj.length > 0 && obj[0] && (obj[0].homeTeam || obj[0].matchDate || obj[0].broadcastChannels)) {
                                apiData.push(...obj);
                            } else {
                                obj.forEach(findMatchArray);
                            }
                        } else if (typeof obj === 'object' && obj !== null) {
                            Object.values(obj).forEach(findMatchArray);
                        }
                    }
                    findMatchArray(json);
                } catch(e) {}
            }
        });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Sayfayı yavaşça aşağı kaydırarak gizli API isteklerini (Lazy Load) tetikliyoruz
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight || totalHeight > 10000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 200);
                });
            });

            // İsteklerin tamamlanması için bekleme payı
            await new Promise(resolve => setTimeout(resolve, 3000));

            let extractedMatches = [];

            if (apiData.length > 0) {
                console.log(`✅ ${sport.toUpperCase()}: Arka plan API'sinden ${apiData.length} maç yakalandı!`);
                
                apiData.forEach(item => {
                    let matchName = item.name || '';
                    if (!matchName && item.homeTeam && item.awayTeam) {
                        matchName = `${item.homeTeam.name || item.homeTeam} - ${item.awayTeam.name || item.awayTeam}`;
                    }
                    if (!matchName) return;

                    let dateRaw = item.startDate || item.matchDate || item.date;
                    if (!dateRaw) return;

                    const mDate = new Date(dateRaw);
                    if (isNaN(mDate.getTime())) return;

                    const dStr = mDate.toLocaleDateString('en-CA', { timeZone });
                    if (!allMatches[dStr]) return;

                    const timeStr = mDate.toLocaleTimeString('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });

                    let channels = [];
                    const cList = item.broadcastChannels || item.channels || item.broadcastChannel || [];
                    const cArr = Array.isArray(cList) ? cList : [cList];
                    cArr.forEach(c => {
                        if (typeof c === 'string') channels.push(c);
                        else if (c && c.name) channels.push(c.name);
                    });

                    extractedMatches.push({
                        dateStr: dStr,
                        saat: timeStr,
                        mac: matchName,
                        yayin: channels.length > 0 ? channels.join(' / ') : 'Spor Ekranı'
                    });
                });
            } else {
                console.log(`⚠️ API yakalanamadı. Saf metin kazıma (İnsan Gözü) modu devreye giriyor...`);
                
                // 🎯 2. KATMAN: EKRANDAKİ SAF YAZILARI OKUMA (Hiçbir HTML Sınıfına İhtiyaç Duymaz)
                const textFallback = await page.evaluate(() => {
                    // Sayfadaki tüm yazıları satır satır alır
                    const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                    const matches = [];
                    let currentDateStr = 'BUGÜN';

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];

                        // Tarih başlıklarını tespit etme (Örn: "9 Haziran Cuma" veya "Yarın")
                        if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                            currentDateStr = line.toUpperCase();
                        }

                        // Saati yakalarsak altındaki satırlar takımlardır
                        if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                            const chunk = [];
                            for(let j = 1; j <= 4; j++) {
                                const nextLine = lines[i+j];
                                if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine) || nextLine.match(/Bugün|Yarın/i)) break;
                                chunk.push(nextLine);
                            }

                            if (chunk.length >= 2) {
                                matches.push({
                                    saat: line,
                                    dateSection: currentDateStr,
                                    lines: chunk
                                });
                            }
                        }
                    }
                    return matches;
                });

                textFallback.forEach(m => {
                    let targetDate = todayStr;
                    if (m.dateSection.includes('YARIN')) targetDate = tomorrowStr;
                    else if (!m.dateSection.includes('BUGÜN')) {
                        const nextDayNumber = new Date(nextDay).getDate().toString();
                        if (m.dateSection.includes(nextDayNumber)) targetDate = nextDayStr;
                    }

                    let mac = '';
                    let yayin = 'Spor Ekranı';

                    if (m.lines.length === 2) {
                        mac = m.lines[0];
                        yayin = m.lines[1];
                    } else if (m.lines.length >= 3) {
                        mac = `${m.lines[0]} - ${m.lines[1]}`;
                        yayin = m.lines.slice(2).join(' / ');
                    }

                    extractedMatches.push({
                        dateStr: targetDate,
                        saat: m.saat,
                        mac: mac,
                        yayin: yayin
                    });
                });
            }

            // Gelen verileri filtreleyip listeye yazma
            const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
            
            extractedMatches.forEach(m => {
                const lowerMac = m.mac.toLowerCase();
                
                // Stüdyo, Reklam ve Program filtresi
                if (
                    lowerMac.includes('izle') || 
                    lowerMac.includes('program') || 
                    lowerMac.includes('stüdyo') ||
                    lowerMac.includes('bülten') ||
                    lowerMac.includes('özet') ||
                    lowerMac.includes('haber') ||
                    m.mac.length < 5
                ) return;

                if (allMatches[m.dateStr]) {
                    allMatches[m.dateStr].matches.push({
                        saat: m.saat,
                        spor: sportName,
                        mac: m.mac.toUpperCase(),
                        yayin: m.yayin
                    });
                }
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Tabloları Yazdır
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
