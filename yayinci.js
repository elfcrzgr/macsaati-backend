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

    const launchBrowser = () => puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const setupPage = async (browser) => {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'tr-TR,tr;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });
        return page;
    };

    const getJsonLd = async (page, url) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));
        return page.evaluate(() => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try { return JSON.parse(script.innerHTML); } catch (e) {}
            }
            return null;
        });
    };

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} sayfası işleniyor...`);
        
        let browser;
        try {
            browser = await launchBrowser();
            const page = await setupPage(browser);
            
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            const jsonLdData = await getJsonLd(page, url);
            
            if (!jsonLdData) {
                console.log(`⚠️ ${sport}: JSON-LD bulunamadı`);
                await browser.close();
                continue;
            }

            // @graph içindeki ItemList'i bul
            const graph = jsonLdData['@graph'] || [];
            const itemList = graph.find(item => item['@type'] === 'ItemList');
            
            if (!itemList || !itemList.itemListElement) {
                console.log(`⚠️ ${sport}: ItemList bulunamadı`);
                await browser.close();
                continue;
            }

            const matchUrls = itemList.itemListElement
                .map(item => item.url)
                .filter(Boolean);

            console.log(`  📋 ${matchUrls.length} maç URL'si bulundu, detaylar çekiliyor...`);

            // Her maç URL'sine gidip detay çek
            for (let i = 0; i < matchUrls.length; i++) {
                const matchUrl = matchUrls[i];
                try {
                    const matchData = await getJsonLd(page, matchUrl);
                    if (!matchData) continue;

                    // Maç sayfasındaki @graph veya direkt BroadcastEvent'i bul
                    let broadcastEvent = null;
                    
                    if (matchData['@graph']) {
                        broadcastEvent = matchData['@graph'].find(item => item['@type'] === 'BroadcastEvent');
                    } else if (matchData['@type'] === 'BroadcastEvent') {
                        broadcastEvent = matchData;
                    } else if (Array.isArray(matchData)) {
                        broadcastEvent = matchData.find(item => item['@type'] === 'BroadcastEvent');
                    }

                    if (!broadcastEvent) continue;

                    const broadcastOf = broadcastEvent.broadcastOfEvent;
                    if (!broadcastOf) continue;

                    const eventName = broadcastOf.name || '';
                    if (!eventName.includes(' - ') && !eventName.includes(' vs ')) continue;

                    const eventNameLower = eventName.toLowerCase();
                    if (eventNameLower.includes('iptal') || eventNameLower.includes('ertelendi') ||
                        eventNameLower.includes('postponed') || eventNameLower.includes('cancelled')) {
                        console.log(`  🗑️ İptal: ${eventName}`);
                        continue;
                    }

                    const startDate = new Date(broadcastOf.startDate);
                    const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                    
                    if (!allMatches[dateStr]) continue;

                    let channels = [];
                    if (Array.isArray(broadcastEvent.broadcastChannel)) {
                        channels = broadcastEvent.broadcastChannel.map(ch => ch.name).filter(Boolean);
                    } else if (broadcastEvent.broadcastChannel?.name) {
                        channels = [broadcastEvent.broadcastChannel.name];
                    }

                    const channelStr = channels.length > 0 ? channels.join(' / ') : 'Bilinmiyor';
                    const time = startDate.toLocaleTimeString('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });

                    allMatches[dateStr].matches.push({
                        saat: time,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: eventName,
                        yayin: channelStr
                    });

                    console.log(`  ✅ (${i+1}/${matchUrls.length}) ${eventName}`);

                } catch (err) {
                    console.warn(`  ⚠️ (${i+1}/${matchUrls.length}) Detay çekilemedi: ${matchUrl}`);
                }
            }

            await browser.close();

        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
            if (browser) await browser.close();
        }
    }
    
    // Çıktı
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
    console.log("\n💾 yayinci_bilgisi.json kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
