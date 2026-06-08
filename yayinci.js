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

    console.log("🚀 Sağ Menü Yokedici ve Saf Metin Okuma Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası hedefleniyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 1024 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        try {
            // URL'ye herhangi bir parametre eklemiyoruz ki site bizi engellemesin
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 });
            
            // Yarın ve Ertesi günü tetiklemek için hafif bir kaydırma yapıyoruz (Sonsuz kaydırma yok)
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 500;
                    let scrolls = 0;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        scrolls++;
                        // Sadece 6 kere kaydırıp duruyoruz, böylece gelecek haftanın maçlarını çekmiyoruz
                        if (scrolls >= 6 || totalHeight >= document.body.scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 300);
                });
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // 🎯 EKRANDAKİ ÇÖPLERİ SİL VE TEMİZ METNİ OKU
            const textFallback = await page.evaluate(() => {
                // 1. ADIM: "Öne Çıkanlar", "Popüler", "Sidebar" gibi yan menüleri bulup SİTE ÜZERİNDEN SİLİYORUZ!
                // Böylece bu maçlar "Bugün" listesine asla karışamaz.
                const headers = document.querySelectorAll('h1, h2, h3, h4, h5, h6, .title, [class*="title"]');
                headers.forEach(h => {
                    const text = h.innerText.toLowerCase();
                    if (text.includes('öne çıkan') || text.includes('popüler') || text.includes('puan durumu') || text.includes('haftanın')) {
                        let parent = h.parentElement;
                        for(let i=0; i<3; i++) { 
                            if(parent && parent.parentElement && parent.tagName !== 'BODY') parent = parent.parentElement;
                        }
                        if(parent) parent.remove();
                    }
                });
                document.querySelectorAll('aside, [class*="sidebar"], [id*="sidebar"], [class*="widget"]').forEach(el => el.remove());

                // 2. ADIM: Logoları metne çevir
                document.querySelectorAll('img').forEach(img => {
                    const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                    if (alt && alt.length > 2) {
                        const cleanAlt = alt.replace(/logosu|logo/gi, '').trim();
                        if (cleanAlt) {
                            const txt = document.createTextNode(` ${cleanAlt} `);
                            img.parentNode.insertBefore(txt, img);
                        }
                    }
                });

                // 3. ADIM: Çöp kutuları silinmiş temiz ekranı satır satır oku
                const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                const matches = [];
                let currentDateStr = 'BUGÜN';

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Tarih başlıklarını tespit etme
                    if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                        currentDateStr = line.toUpperCase();
                    }

                    // Saati bulursan altındaki satırları takım ve kanal olarak topla
                    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                        const chunk = [];
                        for(let j = 1; j <= 5; j++) {
                            const nextLine = lines[i+j];
                            if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine) || nextLine.match(/Bugün|Yarın/i)) break;
                            chunk.push(nextLine);
                        }

                        if (chunk.length >= 2) {
                            matches.push({ saat: line, dateSection: currentDateStr, lines: chunk });
                        }
                    }
                }
                return matches;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Ekranda ${textFallback.length} adet maç bloğu okundu.`);

            const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);

            textFallback.forEach(m => {
                // Gelen tarihin gerçekten Bugün/Yarın veya Ertesi Gün olduğundan emin olma
                let targetDate = null;
                if (m.dateSection.includes('BUGÜN')) targetDate = todayStr;
                else if (m.dateSection.includes('YARIN')) targetDate = tomorrowStr;
                else {
                    const nextDayNum = new Date(nextDay).getDate().toString();
                    if (m.dateSection.includes(nextDayNum + ' ') || m.dateSection.includes(nextDayNum + '.') || m.dateSection.includes('ERTESI')) {
                        targetDate = nextDayStr;
                    }
                }

                // Sadece istediğimiz 3 gün içindeyse işleme al
                if (!targetDate) return;

                let mac = '';
                let rawChannels = [];

                const matchIdx = m.lines.findIndex(l => l.includes('-') || l.toLowerCase().includes(' vs '));
                if (matchIdx !== -1) {
                    mac = m.lines[matchIdx];
                    rawChannels = m.lines.slice(matchIdx + 1);
                } else {
                    mac = m.lines[0];
                    rawChannels = m.lines.slice(1);
                }

                // 🛑 LİG VE KATEGORİ TEMİZLEYİCİ
                let filteredChannels = rawChannels.filter(line => {
                    let l = line.toLowerCase();
                    return !(
                        l === 'futbol' || l === 'basketbol' || l === 'tenis' ||
                        l.includes('kupas') || l.includes('lig') || l.includes('championship') ||
                        l.includes('elemeler') || l.includes('hazirlik') || l.includes('hazırlık') ||
                        l.includes('final') || l.includes('turnuva') || l.includes('şampiyon') ||
                        l.includes('wta') || l.includes('atp') || l.includes('wnba') ||
                        l.includes('maçi') || l.includes('maçı') || l.includes('nba') || l.includes('olympic')
                    );
                });

                let cleanYayin = filteredChannels.join(' / ')
                    .replace(/chevron_right/gi, '')
                    .replace(/Daha fazlasını keşfedin/gi, '')
                    .replace(/\d{2}\.\d{2}\.\d{4}.*/g, '')
                    .replace(/^[ \/]+|[ \/]+$/g, '')
                    .replace(/\s+\/\s+/g, ' / ')
                    .trim();

                if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) cleanYayin = 'Bilinmiyor';

                const lowerMac = mac.toLowerCase();
                
                // Çöp program filtresi
                if (
                    lowerMac.includes('izle') || 
                    lowerMac.includes('program') || 
                    lowerMac.includes('stüdyo') ||
                    lowerMac.includes('bülten') ||
                    lowerMac.includes('özet') ||
                    lowerMac.includes('haber') ||
                    mac.length < 5
                ) return;

                allMatches[targetDate].matches.push({
                    saat: m.saat,
                    spor: sportName,
                    mac: mac.toUpperCase().trim(),
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlar ve temiz kanallarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
