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

    console.log("🚀 Görsel Çevirici ve Saf Metin Kazıma Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası hedefleniyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 1024 });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Sayfayı aşağı kaydırıp tüm resimlerin ve maçların yüklenmesini sağlıyoruz
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

            await new Promise(resolve => setTimeout(resolve, 3000));

            // 🎯 EKRAN OKUYUCU (Logoları metne çevirip okur)
            const extractedMatches = await page.evaluate(() => {
                // 1. ADIM: Sitedeki tüm logoları bul ve yanlarına kanal ismini metin olarak yaz!
                document.querySelectorAll('img').forEach(img => {
                    const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                    if (alt && alt.length > 2) {
                        const cleanAlt = alt.replace(/logosu|logo/gi, '').trim();
                        if (cleanAlt) {
                            // Resmin hemen önüne kanal ismini görünmez metin olarak ekliyoruz
                            const txt = document.createTextNode(` ${cleanAlt} `);
                            img.parentNode.insertBefore(txt, img);
                        }
                    }
                });

                // 2. ADIM: Artık logolar da metin olduğuna göre, tüm sayfayı baştan aşağı satır satır oku
                const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                const matches = [];
                let currentDateStr = 'BUGÜN';

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // Tarih başlıklarını tespit etme
                    if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                        currentDateStr = line.toUpperCase();
                    }

                    // Eğer satırda saat (Örn: 21:45) yazıyorsa, bu bir maçtır! Altındaki satırları topla
                    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                        const chunk = [];
                        for(let j = 1; j <= 5; j++) {
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

            console.log(`🔍 ${sport.toUpperCase()}: Ekrandan ${extractedMatches.length} adet ham maç bloğu okundu.`);

            extractedMatches.forEach(m => {
                // Tarih Eşleştirme (Bugün, Yarın, Ertesi Gün)
                let targetDate = todayStr;
                if (m.dateSection.includes('YARIN')) {
                    targetDate = tomorrowStr;
                } else if (!m.dateSection.includes('BUGÜN')) {
                    const nextDayNumber = new Date(nextDay).getDate().toString();
                    if (m.dateSection.includes(nextDayNumber)) targetDate = nextDayStr;
                }

                let mac = '';
                let yayin = '';

                // Maç ismini bul (İçinde - veya vs olan satır genellikle maçtır)
                const matchIdx = m.lines.findIndex(l => l.includes('-') || l.toLowerCase().includes(' vs '));
                if (matchIdx !== -1) {
                    mac = m.lines[matchIdx];
                    yayin = m.lines.slice(matchIdx + 1).join(' / ');
                } else {
                    mac = m.lines[0];
                    yayin = m.lines.slice(1).join(' / ');
                }

                // 🧹 İKON, TARİH VE LİNK ARTIKLARINI TEMİZLEME
                let cleanYayin = yayin
                    .replace(/chevron_right/gi, '')
                    .replace(/Daha fazlasını keşfedin/gi, '')
                    .replace(/\d{2}\.\d{2}\.\d{4}.*/g, '') // "11.06.2026 Perşembe" gibi yazıları siler
                    .replace(/(Futbol|Basketbol|Tenis) Maçları.*/gi, '')
                    .replace(/^[ \/]+|[ \/]+$/g, '') // Başta/sonda kalan fazlalık slash'leri uçurur
                    .replace(/\s+\/\s+/g, ' / ') // Slash aralarını düzeltir
                    .trim();

                // Eğer kanal metni silinip boş kaldıysa Spor Ekranı yaz
                if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) {
                    cleanYayin = 'Spor Ekranı';
                }

                const lowerMac = mac.toLowerCase();
                
                // Son Filtreleme (Sadece maçlar listeye girer)
                if (
                    lowerMac.includes('izle') || 
                    lowerMac.includes('program') || 
                    lowerMac.includes('stüdyo') ||
                    lowerMac.includes('bülten') ||
                    lowerMac.includes('özet') ||
                    lowerMac.includes('haber') ||
                    mac.length < 5
                ) return;

                if (allMatches[targetDate]) {
                    allMatches[targetDate].matches.push({
                        saat: m.saat,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: mac.toUpperCase().trim(),
                        yayin: cleanYayin
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlar ve gerçek kanallarıyla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
