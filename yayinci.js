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
                document.querySelectorAll('img').forEach(img => {
                    let alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                    let src = img.getAttribute('src') || '';

                    // 🛑 REKLAM VE MOBİL BANNER ENGELİ: Alakasız görselleri kesinlikle es geç
                    if (
                        src.match(/google-play|app-store|mobil|banner|reklam|advertisement|logo-site|site-logo|header|footer|avatar/i) ||
                        alt.match(/indir|download|store|banner|reklam|logo|icon|chevron|arrow/i)
                    ) {
                        return;
                    }

                    // Alt etiketi boşsa görsel url'inden ismi kurtar
                    if ((!alt || alt.length < 2) && src) {
                        let match = src.match(/\/([^\/?#]+)\.(png|jpe?g|webp|gif)/i);
                        if (match && match[1]) {
                            alt = match[1].replace(/[-_]/g, ' ');
                        }
                    }

                    if (alt && alt.length > 2) {
                        const cleanAlt = alt.replace(/logosu|logo|icon/gi, '').trim();
                        if (cleanAlt && !cleanAlt.match(/chevron|arrow|play|menu|search|user/i)) {
                            const txt = document.createTextNode(`\n${cleanAlt}\n`);
                            img.parentNode.insertBefore(txt, img);
                        }
                    }
                });

                const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                const matches = [];
                let currentDateStr = ''; 

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                        currentDateStr = line.toUpperCase();
                    }

                    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                        const chunk = [];
                        for(let j = 1; j <= 8; j++) { 
                            const nextLine = lines[i+j];
                            if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine) || nextLine.match(/Bugün|Yarın/i)) break;
                            chunk.push(nextLine);
                        }

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
                let targetDate = null; 
                
                if (m.dateSection.includes('BUGÜN')) {
                    targetDate = todayStr;
                } else if (m.dateSection.includes('YARIN')) {
                    targetDate = tomorrowStr;
                } else {
                    const matchedKey = [todayStr, tomorrowStr, nextDayStr].find(str => {
                        const dayNum = new Date(str).getDate().toString();
                        return new RegExp(`\\b${dayNum}\\b`).test(m.dateSection);
                    });
                    if (matchedKey) targetDate = matchedKey;
                }

                if (!targetDate) return; 

                let mac = '';
                let rawChannels = [];

                const matchIdx = m.lines.findIndex(l => l.includes('-') || l.toLowerCase().includes(' vs '));
                if (matchIdx !== -1) {
                    mac = m.lines[matchIdx];
                    rawChannels = m.lines.filter((_, idx) => idx !== matchIdx);
                } else {
                    mac = m.lines[0];
                    rawChannels = m.lines.slice(1);
                }

             // 🌟 AKILLI BEYAZ LİSTE (WHITELIST) FİLTRESİ
                // Kara liste yerine sadece bildiğimiz gerçek kanalları tutan aşılmaz duvar.
                // yayinci.js içerisindeki validChannels güncellenmiş hali:
const validChannels = [
    "trt", "bein", "beın", "s sport", "ssport", "tivibu", "smart spor", "spor smart",
    "d-smart", "euroleague tv", "nba tv", "nba league pass", "prime video", "amazon", "youtube", 
    "exxen", "tv8", "a spor", "eurosport", "içtimai", "cbc sport", "idman", "az tv", 
    "fb tv", "gs tv", "bjk tv", "kanal d", "star tv", "show tv", "atv", "ntv", "tabii", 
    "red bull", "wta tv", "atp tv", "fiba tv", "tbf tv", "tv100", "yayın yok"
];


                let filteredChannels = rawChannels.filter(line => {
                    if (!line || line.length < 2) return false;
                    const l = line.toLowerCase();
                    
                    // Sitenin en altındaki anlamsız footer metinleri kanalların arasına sızmasın
                    if (l.match(/canlı tv|yayın akışı|video|kupalar|oyun|futbolu|tenisin|aboneliği/i)) {
                        return false;
                    }

                    // Satırın içinde geçerli bir kanal adı var mı? (Örn: "Bein Sports Max 1" -> "bein" içeriyor, KABUL ET!)
                    // İçermiyorsa (Örn: "Stuttgart Yarı", "İtalya Play-Off") -> REDDET!
                    return validChannels.some(channel => l.includes(channel));
                });

                // Kalan tertemiz kanalları birleştir
                let cleanYayin = filteredChannels.join(' / ')
                    .replace(/chevron_right/gi, '')
                    .replace(/^[ \/]+|[ \/]+$/g, '')    // Baştaki/sondaki yalnız slash'leri sil
                    .replace(/\s*\/\s*\/\s*/g, ' / ')   // Aralarda kalan / / gibi çoklu slashleri teke düşür
                    .trim();

                if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) cleanYayin = 'Yayın Yok';

               

                const lowerMac = mac.toLowerCase();
                
                if (
                    lowerMac.includes('izle') || 
                    lowerMac.includes('program') || 
                    lowerMac.includes('stüdyo') ||
                    lowerMac.includes('bülten') ||
                    lowerMac.includes('özet') ||
                    lowerMac.includes('haber') ||
                    mac.length < 5
                ) return;

                // 🔄 TAKIM İSMİ DÜZELTME SÖZLÜĞÜ (MAPPING)
                const teamNameDictionary = {
                    "BARCELONA": "Barça Basket",
                    "IBEROSTAR TENERIFE": "La Laguna Tenerife"
                    // İhtiyaç duydukça buraya "ESKİ İSİM": "YENİ İSİM" şeklinde ekleme yapabilirsin
                };

                // Önce ana maç metnini büyük harflere çevirip boşluklarını alıyoruz
                let finalMac = mac.toUpperCase().trim();
                
                // Sözlükteki kelimeleri sırayla arayıp, bulursa Firebase'deki isimle değiştiriyoruz
                Object.keys(teamNameDictionary).forEach(sporekraniName => {
                    if (finalMac.includes(sporekraniName)) {
                        finalMac = finalMac.replace(sporekraniName, teamNameDictionary[sporekraniName]);
                    }
                });

                

                if (allMatches[targetDate]) {
                    allMatches[targetDate].matches.push({
                        saat: m.saat,
                        spor: sportName,
                        mac: finalMac,
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlar ve taze kanallarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
