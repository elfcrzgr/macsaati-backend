const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    const d = new Date();
    
    const todayStr = d.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = new Date(d.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone });
    const nextDayStr = new Date(d.getTime() + 172800000).toLocaleDateString('en-CA', { timeZone });

    const allMatches = { [todayStr]: [], [tomorrowStr]: [], [nextDayStr]: [] };

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote']
    });

    for (const sport of sports) {
        const page = await browser.newPage();
        await page.goto(`https://www.sporekrani.com/home/sport/${sport}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        const data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.match-list-item, .match-item')).map(card => {
                const saat = card.querySelector('.time')?.innerText.trim();
                const mac = card.querySelector('.match-name')?.innerText.trim();
                const yayin = card.querySelector('.channel-name')?.innerText.trim() || 'Spor Ekranı';
                
                let dateHeader = "";
                let prev = card.previousElementSibling;
                while(prev) {
                    if (prev.matches('.date-header, h2, h3')) { dateHeader = prev.innerText.trim(); break; }
                    prev = prev.previousElementSibling;
                }
                return { saat, mac, yayin, dateHeader };
            });
        });

        data.forEach(m => {
            let dateKey = null;
            if (m.dateHeader.toLowerCase().includes('bugün')) dateKey = todayStr;
            else if (m.dateHeader.toLowerCase().includes('yarın')) dateKey = tomorrowStr;
            else if (m.dateHeader.toLowerCase().includes('ertesi')) dateKey = nextDayStr;
            
            if (!dateKey) return;
            // BUGÜN FİLTRESİ: Yan menüdeki (tarih başlığı olmayan) maçları Bugün'e alma
            if (dateKey === todayStr && !m.dateHeader) return; 

            let cleanYayin = m.yayin.split('/')[0].replace(/FIFA.*|Lig|Kupası|Web|App/gi, '').trim();

            allMatches[dateKey].push({
                saat: m.saat,
                spor: sport.toUpperCase(),
                mac: m.mac.toUpperCase(),
                yayin: cleanYayin || 'Spor Ekranı'
            });
        });
        await page.close();
    }
    await browser.close();
    
    // TABLOLARI YAZDIRMA KISMI GERİ GELDİ!
    Object.keys(allMatches).forEach(key => {
        console.log(`\n📅 ${key === todayStr ? 'BUGÜN' : key === tomorrowStr ? 'YARIN' : 'ERTESİ GÜN'} (${key})`);
        if (allMatches[key].length === 0) console.log("⚠️ Maç bulunamadı.");
        else console.table(allMatches[key]);
    });

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
}
getBroadcasterData();
