const puppeteer = require('puppeteer');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    const d = new Date();
    
    // Tarihleri hatasız oluştur
    const todayStr = d.toLocaleDateString('en-CA', { timeZone });
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 2);
    const nextDayStr = nextDay.toLocaleDateString('en-CA', { timeZone });

    const allMatches = { [todayStr]: [], [tomorrowStr]: [], [nextDayStr]: [] };

    const browser = await puppeteer.launch({ headless: "new" });

    for (const sport of sports) {
        const page = await browser.newPage();
        await page.goto(`https://www.sporekrani.com/home/sport/${sport}`, { waitUntil: 'domcontentloaded' });
        
        const data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.match-list-item')).map(card => {
                const saat = card.querySelector('.time')?.innerText.trim();
                const mac = card.querySelector('.match-name')?.innerText.trim();
                const yayin = card.querySelector('.channel-name')?.innerText.trim() || 'Spor Ekranı';
                
                // Tarih başlığını bul
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
            // Bugünün maçlarını filtrele (Yarın ve Ertesi günü elleme, onları olduğu gibi al)
            let dateKey = null;
            if (m.dateHeader.toLowerCase().includes('bugün')) dateKey = todayStr;
            else if (m.dateHeader.toLowerCase().includes('yarın')) dateKey = tomorrowStr;
            else if (m.dateHeader.toLowerCase().includes('ertesi')) dateKey = nextDayStr;
            
            if (!dateKey) return;

            // BUGÜN FİLTRESİ: Sadece bugün için yan menü çöpünü temizle (tarih başlığı olmayanlar yan menüdür)
            if (dateKey === todayStr && !m.dateHeader) return; 

            // Kanal ismini temizle
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
    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("✅ Veri başarıyla kaydedildi. Bugün arındırıldı, Yarın/Ertesi gün korundu.");
}
getBroadcasterData();
