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

    console.log("🚀 Puppeteer Garanti Modu başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--blink-features=AutomationControlled'
        ]
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası yükleniyor...`);
        const page = await browser.newPage();
        
        // Bot engelini tamamen aşmak için gerçek cihaz taklidi
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            // Sitenin yönlendirme yaptığı güncel ana url parametresi
            const url = `https://www.sporekrani.com/?sport=${sport}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 50000 });
            
            // Sayfanın tamamen render olması için 4 saniye kesin bekleme süresi
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 4000)));

            // 🛠️ HİÇBİR SINIFA BAĞIMLI OLMAYAN ESNEK KAZIMA ALGORİTMASI
            const extractedData = await page.evaluate(() => {
                const list = [];
                
                // Sayfadaki tüm script etiketlerini tara, bazen veriler window.__NUXT__ veya benzeri nesnelerdedir
                const allScripts = Array.from(document.querySelectorAll('script'));
                for (const script of allScripts) {
                    const content = script.innerHTML;
                    if (content.includes('match') || content.includes('startDate')) {
                        // Eğer içeride saklı bir JSON string yakalarsak çıkarmaya çalışalım
                        const jsonMatch = content.match(/\{["'].*?\}/g);
                        if (jsonMatch) {
                            jsonMatch.forEach(str => {
                                try {
                                    const parsed = JSON.parse(str);
                                    if (parsed.startDate && (parsed.homeTeam || parsed.name)) {
                                        list.push({
                                            rawDate: parsed.startDate,
                                            macName: parsed.name || `${parsed.homeTeam?.name} - ${parsed.awayTeam?.name}`,
                                            kanallar: parsed.broadcastChannel?.name || parsed.channelName || 'Spor Ekranı'
                                        });
                                    }
                                } catch(e) {}
                            });
                        }
                    }
                }

                // EĞER SCRIPTTE BULAMAZSA DOĞRUDAN EKRANDAKİ METİNLERİ KAZI (Visual DOM Backup)
                if (list.length === 0) {
                    // Sitedeki tüm div'leri tara, içinde saat formatı (örn: "21:45") ve takım ayıracı olan her şeyi yakala
                    const divs = document.querySelectorAll('div, li, tr');
                    divs.forEach(el => {
                        // Eğer element doğrudan maç kartı büyüklüğündeyse text analizi yap
                        if (el.children.length >= 2 && el.children.length <= 10) {
                            const text = el.innerText || '';
                            const timeMatch = text.match(/([0-1]?[0-9]|2[0-3]):[0-5][0-9]/); // Saat kontrolü (21:45)
                            
                            if (timeMatch && (text.includes('-') || text.includes('vs'))) {
                                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                                if (lines.length >= 2) {
                                    list.push({
                                        rawText: lines.join(' | '),
                                        isDOM: true
                                    });
                                }
                            }
                        }
                    });
                }

                return list;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Kaynak seviyesinde ${extractedData.length} adet veri izi yakalandı.`);

            // Yakalanan ham izleri anlamlı verilere dönüştürüp temizleme
            if (extractedData.length > 0) {
                extractedData.forEach(item => {
                    if (!item.isDOM && item.rawDate) {
                        // JSON şemasından gelen tertemiz veriler
                        const mDate = new Date(item.rawDate);
                        const dateStr = mDate.toLocaleDateString('en-CA', { timeZone });
                        if (!allMatches[dateStr]) return;

                        const timeStr = mDate.toLocaleTimeString('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });
                        allMatches[dateStr].matches.push({
                            saat: timeStr,
                            spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                            mac: item.macName.toUpperCase().trim(),
                            yayin: item.kanallar
                        });
                    } else if (item.isDOM && item.rawText) {
                        // Düz ekrandan kazınan metinler (Hassas Regex Parse)
                        // Örnek format: "21:45 | Hollanda - Özbekistan | S Sport"
                        const parts = item.rawText.split('|').map(p => p.trim());
                        const saat = parts.find(p => p.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/));
                        const mac = parts.find(p => p.includes('-') && !p.match(/:/));
                        const yayin = parts.find(p => !p.includes('-') && !p.match(/:/) && p.length > 2) || 'Spor Ekranı';

                        if (saat && mac) {
                            allMatches[todayStr].matches.push({
                                saat: saat,
                                spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                                mac: mac.toUpperCase().trim(),
                                yayin: yayin
                            });
                        }
                    }
                });
            }

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Çıktı Tablosu oluşturma
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
    console.log("\n💾 yayinci_bilgisi.json başarıyla güncellendi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
