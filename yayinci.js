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

    console.log("🚀 URL-Tarih Bazlı Saf Metin ve Görsel Çevirici Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const targetDates = [todayStr, tomorrowStr, nextDayStr];

    // 🎯 SİSTEMİ DOĞRUDAN TARİHLERLE LİNKLİYORUZ
    for (const sport of sports) {
        const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
        
        for (const dateKey of targetDates) {
            console.log(`\n📡 ${sportName} - ${dateKey} tarihi hedefleniyor...`);
            const page = await browser.newPage();
            
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 1024 });

            try {
                // Senin taktik: Direkt spor ve tarih bazlı linke gidiyoruz!
                const url = `https://www.sporekrani.com/home/sport/${sport}?date=${dateKey}`;
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 });
                
                // Sadece ekrandaki resimlerin yüklenmesi için ufak bir kaydırma
                await page.evaluate(async () => {
                    window.scrollBy(0, 800);
                });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const scrapedData = await page.evaluate(() => {
                    // Logoları kanal ismine çevir
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

                    // Sadece ana maç listesinin olduğu kutuyu al, sağdaki reklam çöplerini alma
                    const mainContent = document.querySelector('.match-list, .daily-matches, main, [class*="content"]') || document.body;
                    
                    const lines = mainContent.innerText.split('\n').map(l => l.trim()).filter(l => l);
                    const matches = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        
                        // Saati bulursak altındaki satırlar direkt takımlar ve kanaldır
                        if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                            const chunk = [];
                            for(let j = 1; j <= 4; j++) {
                                const nextLine = lines[i+j];
                                if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine)) break;
                                chunk.push(nextLine);
                            }

                            if (chunk.length >= 2) {
                                matches.push({ saat: line, lines: chunk });
                            }
                        }
                    }
                    return matches;
                });

                console.log(`🔍 ${sportName} - ${dateKey}: Ekranda ${scrapedData.length} maç bulundu.`);

                scrapedData.forEach(m => {
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

                    // 🛑 ÇÖP LİG İSİMLERİNİ VE KATEGORİLERİ KANAL LİSTESİNDEN SİLİYORUZ
                    let filteredChannels = rawChannels.filter(line => {
                        let l = line.toLowerCase();
                        return !(
                            l === 'futbol' || l === 'basketbol' || l === 'tenis' ||
                            l.includes('kupas') || l.includes('lig') || l.includes('championship') ||
                            l.includes('elemeler') || l.includes('hazirlik') || l.includes('hazırlık') ||
                            l.includes('final') || l.includes('turnuva') || l.includes('şampiyon') ||
                            l.includes('wta') || l.includes('atp') || l.includes('wnba') ||
                            l.includes('maçi') || l.includes('maçı') || l.includes('nba')
                        );
                    });

                    // Kanal satırını rötuşla
                    let cleanYayin = filteredChannels.join(' / ')
                        .replace(/chevron_right/gi, '')
                        .replace(/Daha fazlasını keşfedin/gi, '')
                        .replace(/\d{2}\.\d{2}\.\d{4}.*/g, '')
                        .replace(/^[ \/]+|[ \/]+$/g, '')
                        .replace(/\s+\/\s+/g, ' / ')
                        .trim();

                    if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) cleanYayin = 'Bilinmiyor';

                    const lowerMac = mac.toLowerCase();
                    
                    // Program, Reklam ve Kötü Maç İsimleri Filtresi
                    if (
                        lowerMac.includes('izle') || 
                        lowerMac.includes('program') || 
                        lowerMac.includes('stüdyo') ||
                        lowerMac.includes('bülten') ||
                        lowerMac.includes('özet') ||
                        lowerMac.includes('haber') ||
                        lowerMac.includes('kürsü') ||
                        mac.length < 5
                    ) return;

                    // 🎯 URL bize tarihi kesin olarak verdiği için direkt o günün listesine pushluyoruz!
                    allMatches[dateKey].matches.push({
                        saat: m.saat,
                        spor: sportName,
                        mac: mac.toUpperCase().trim(),
                        yayin: cleanYayin
                    });
                });

            } catch (error) {
                console.error(`🚨 ${sportName} - ${dateKey} hatası:`, error.message);
            } finally {
                await page.close();
            }
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
    console.log("\n💾 yayinci_bilgisi.json tamamen tarihe sabitlenmiş gerçek maçlarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
