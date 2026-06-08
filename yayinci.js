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
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const createPage = async () => {
        const p = await browser.newPage();
        await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
        await p.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
        return p;
    };

    // Bir URL'den JSON-LD içindeki SportsEvent + kanal bilgisini çek
    const fetchMatchData = async (page, url) => {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            return await page.evaluate(() => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of scripts) {
                    try {
                        const data = JSON.parse(script.innerHTML);
                        const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
                        const sportsEvent = graph.find(i => i['@type'] === 'SportsEvent');
                        if (!sportsEvent) continue;

                        // Kanal bilgisini WebPage description'dan veya başka bir yerden al
                        // Önce BroadcastEvent ara
                        const broadcast = graph.find(i => i['@type'] === 'BroadcastEvent');
                        let channels = [];
                        if (broadcast) {
                            if (Array.isArray(broadcast.broadcastChannel)) {
                                channels = broadcast.broadcastChannel.map(c => c.name).filter(Boolean);
                            } else if (broadcast.broadcastChannel?.name) {
                                channels = [broadcast.broadcastChannel.name];
                            }
                        }

                        return {
                            name: sportsEvent.name,
                            startDate: sportsEvent.startDate,
                            channels
                        };
                    } catch(e) {}
                }
                return null;
            });
        } catch(e) {
            return null;
        }
    };

    for (const sport of sports) {
        console.log(`\n🚀 ${sport.toUpperCase()} işleniyor...`);

        try {
            // 1. Liste sayfasından URL'leri al
            const listPage = await createPage();
            await listPage.goto(`https://www.sporekrani.com/home/sport/${sport}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            const matchUrls = await listPage.evaluate(() => {
                const jsonLd = document.querySelector('script[type="application/ld+json"]');
                if (!jsonLd) return [];
                const data = JSON.parse(jsonLd.innerHTML);
                const graph = data['@graph'] || [];
                const itemList = graph.find(i => i['@type'] === 'ItemList');
                return (itemList?.itemListElement || []).map(i => i.url).filter(Boolean);
            });
            await listPage.close();

            console.log(`  📋 ${matchUrls.length} maç bulundu, paralel çekiliyor...`);

            // 2. Paralel sayfalar aç (5'erli gruplar halinde)
            const CONCURRENCY = 5;
            let found = 0;

            for (let i = 0; i < matchUrls.length; i += CONCURRENCY) {
                const batch = matchUrls.slice(i, i + CONCURRENCY);
                const pages = await Promise.all(batch.map(() => createPage()));
                
                const results = await Promise.all(
                    batch.map((url, idx) => fetchMatchData(pages[idx], url))
                );

                await Promise.all(pages.map(p => p.close()));

                results.forEach(match => {
                    if (!match || !match.startDate || !match.name) return;

                    const eventNameLower = match.name.toLowerCase();
                    if (eventNameLower.includes('iptal') || eventNameLower.includes('ertelendi') ||
                        eventNameLower.includes('postponed') || eventNameLower.includes('cancelled')) return;

                    if (!match.name.includes(' - ') && !match.name.includes(' vs ')) return;

                    const startDate = new Date(match.startDate);
                    const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });
                    if (!allMatches[dateStr]) return;

                    const time = startDate.toLocaleTimeString('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });
                    const channelStr = match.channels.length > 0 ? match.channels.join(' / ') : 'Bilinmiyor';

                    allMatches[dateStr].matches.push({
                        saat: time,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: match.name,
                        yayin: channelStr
                    });
                    found++;
                });

                const progress = Math.min(i + CONCURRENCY, matchUrls.length);
                process.stdout.write(`\r  ⏳ ${progress}/${matchUrls.length} işlendi, ${found} maç eklendi`);
            }

            console.log(`\n  ✅ ${sport}: ${found} maç eklendi`);

        } catch (error) {
            console.error(`🚨 ${sport} hatası:`, error.message);
        }
    }

    await browser.close();

    // Çıktı
    [yesterdayStr, todayStr, tomorrowStr, nextDayStr].forEach(key => {
        const group = allMatches[key];
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        if (group.matches.length === 0) {
            console.log("   ⚠️ Maç bulunamadı.");
        } else {
            const unique = Array.from(new Set(group.matches.map(JSON.stringify))).map(JSON.parse);
            const sorted = unique.sort((a, b) => a.saat.localeCompare(b.saat));
            console.table(sorted);
        }
    });

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 yayinci_bilgisi.json kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
