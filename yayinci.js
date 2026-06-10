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

    console.log("🚀 Sarsılmaz İnsan Gözü (Saf Metin) ve Lig Temizleyici Modu Başlatılıyor...");

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
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Sitenin gizlediği o devasa global listeyi açığa çıkarmak için tam kaydırma yapıyoruz
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight || totalHeight > 15000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 150);
                });
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

                        // 🎯 EKRANDAKİ LOGOLARI VE METİNLERİ OKUYAN ANA MOTOR
            const textFallback = await page.evaluate(() => {
                // Sitedeki tüm logoları bul ve yanlarına kanal ismini görünmez metin olarak yaz
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

                const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                const matches = [];
                let currentDateStr = ''; // 🌟 DEĞİŞİKLİK: Başlangıçta boş bırakıyoruz ki üstteki tarihsiz öne çıkanlar bugüne sızmasın

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                        currentDateStr = line.toUpperCase();
                    }

                    // Saati bulursan altındaki satırları maç verisi olarak topla
                    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                        const chunk = [];
                        for(let j = 1; j <= 5; j++) {
                            const nextLine = lines[i+j];
                            if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine) || nextLine.match(/Bugün|Yarın/i)) break;
                            chunk.push(nextLine);
                        }

                        // 🌟 DEĞİŞİKLİK: Sadece net bir gün başlığı altına girildiyse veriyi kabul et
                        if (currentDateStr && chunk.length >= 2) {
                            matches.push({ saat: line, dateSection: currentDateStr, lines: chunk });
                        }
                    }
                }
                return matches;
            });


                        console.log(`🔍 ${sport.toUpperCase()}: Ekrandan ${textFallback.length} adet ham maç bloğu okundu. Ligler temizleniyor...`);

            const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);

            textFallback.forEach(m => {
                // 🌟 DEĞİŞİKLİK: Kusursuz Tarih Eşleme Mantığı
                let targetDate = todayStr;
                if (m.dateSection.includes('YARIN')) {
                    targetDate = tomorrowStr;
                } else if (!m.dateSection.includes('BUGÜN')) {
                    // "11 HAZİRAN" gibi sayı içeren gün başlıklarını doğru tarihe yönlendirir
                    const matchedKey = [todayStr, tomorrowStr, nextDayStr].find(str => {
                        const dayNum = new Date(str).getDate().toString();
                        return m.dateSection.includes(dayNum);
                    });
                    if (matchedKey) targetDate = matchedKey;
                }

                let mac = '';
                let rawChannels = [];

                // Maç ismini bul
                const matchIdx = m.lines.findIndex(l => l.includes('-') || l.toLowerCase().includes(' vs '));
                if (matchIdx !== -1) {
                    mac = m.lines[matchIdx];
                    // 🌟 DEĞİŞİKLİK: Kanal ismi maçın üstünde de olsa altında da olsa yakala (Maç satırı hariç her şeyi kanal kabul et)
                    rawChannels = m.lines.filter((_, idx) => idx !== matchIdx);
                } else {
                    mac = m.lines[0];
                    rawChannels = m.lines.slice(1);
                }

                // 🛑 LİG VE KATEGORİ İSİMLERİNİ TEMİZLEYEN MUCİZE FİLTRE
                let filteredChannels = rawChannels.filter(line => {
                    let l = line.toLowerCase();
                    return !(
                        l === 'futbol' || l === 'basketbol' || l === 'tenis' ||
                        l.includes('kupas') || l.includes('lig') || l.includes('championship') ||
                        l.includes('elemeler') || l.includes('hazirlik') || l.includes('hazırlık') ||
                        l.includes('final') || l.includes('turnuva') || l.includes('şampiyon') ||
                        l.includes('wta') || l.includes('atp') || l.includes('wnba')
                    );
                });

                // Artıkları da tıraşla
                let cleanYayin = filteredChannels.join(' / ')
                    .replace(/chevron_right/gi, '')
                    .replace(/Daha fazlasını keşfedin/gi, '')
                    .replace(/\d{2}\.\d{2}\.\d{4}.*/g, '')
                    .replace(/(Futbol|Basketbol|Tenis) Maçları.*/gi, '')
                    .replace(/^[ \/]+|[ \/]+$/g, '')
                    .replace(/\s+\/\s+/g, ' / ')
                    .trim();

                if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) cleanYayin = 'Bilinmiyor';

                const lowerMac = mac.toLowerCase();
                
                // Program ve Reklam süzgeci
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
                        spor: sportName,
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlar ve temiz kanallarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
