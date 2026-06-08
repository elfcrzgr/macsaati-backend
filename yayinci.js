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

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası hedefleniyor...`);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 });
            await new Promise(resolve => setTimeout(resolve, 3000));

            const matches = await page.evaluate(() => {
                const found = [];
                // SİTEYİ SİLMEK YERİNE SADECE MAÇ KARTLARINI SEÇİYORUZ
                const cards = document.querySelectorAll('.match-list-item, .match-item');
                
                cards.forEach(card => {
                    const saat = card.querySelector('.time')?.innerText.trim();
                    const mac = card.querySelector('.match-name')?.innerText.trim();
                    const yayin = card.querySelector('.channel-name')?.innerText.trim() || 'Spor Ekranı';
                    
                    // Tarih başlığı yukarı doğru en yakın olanı al
                    let dateHeader = "";
                    let prev = card.previousElementSibling;
                    while(prev && !dateHeader) {
                        if (prev.matches('.date-header, h2, h3')) dateHeader = prev.innerText.trim();
                        prev = prev.previousElementSibling;
                    }

                    if (saat && mac) found.push({ saat, mac, yayin, dateHeader });
                });
                return found;
            });

            matches.forEach(m => {
                let targetDate = todayStr;
                if (m.dateHeader.toLowerCase().includes('yarın')) targetDate = tomorrowStr;
                else if (m.dateHeader.toLowerCase().includes('ertesi')) targetDate = nextDayStr;

                if (allMatches[targetDate]) {
                    allMatches[targetDate].matches.push({
                        saat: m.saat,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: m.mac.toUpperCase(),
                        yayin: m.yayin
                    });
                }
            });
        } catch (e) { console.error(e); }
        await page.close();
    }

    await browser.close();
    
    // Çıktı ve Dosya Kaydı
    Object.keys(allMatches).forEach(key => {
        console.log(`\n\x1b[33m${allMatches[key].title}\x1b[0m`);
        console.table(allMatches[key].matches);
    });
    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
