const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// İndirilecek Ligler Listesi
const leagueConfigs = {
    52: "beIN Sports", 98: "beIN Sports / TRT Spor", 17: "beIN Sports",
    8: "S Sport", 54: "S Sport Plus", 23: "S Sport / Tivibu Spor",
    35: "beIN Sports / Tivibu Spor", 34: "beIN Sports", 37: "TV8.5 / Exxen",
    238: "D-Smart / Spor Smart", 709: "CBC Sport / Yerel", 13363: "TV8.5 / Exxen",
    19: "Tivibu / TRT Spor / Tabii", 481: "Spor Smart / D-Smart",
    7: "TRT / Tabii", 3: "TRT / Tabii", 848: "TRT / Tabii",
    679: "TRT / Tabii", 17015: "TRT / Tabii",
    325: "S Sport Plus / D-Smart", 155: "S Sport Plus / D-Smart",
    44: "beIN Sports / Tivibu", 955: "S Sport Plus / TV8.5"
};

async function start() {
    console.log("🚀 Lig Logoları Zorunlu İndirme Başlatılıyor...");

    const tournamentLogosDir = path.join(__dirname, 'tournament_logos');
    if (!fs.existsSync(tournamentLogosDir)) {
        fs.mkdirSync(tournamentLogosDir);
        console.log("📁 tournament_logos klasörü oluşturuldu.");
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const leagueIds = Object.keys(leagueConfigs);
    console.log(`🔎 Toplam ${leagueIds.length} lig taranacak...`);

    let successCount = 0;

    for (const id of leagueIds) {
        const logoPath = path.join(tournamentLogosDir, `${id}.png`);

        try {
            console.log(`📥 İndiriliyor ID: ${id}...`);
            const logoUrl = `https://api.sofascore.app/api/v1/unique-tournament/${id}/image`;
            
            const response = await page.goto(logoUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            
            if (response.status() === 200) {
                const buffer = await response.buffer();
                fs.writeFileSync(logoPath, buffer);
                console.log(`  ✅ ID ${id} Başarılı.`);
                successCount++;
            } else {
                console.log(`  ❌ Hata: ${id} (Status: ${response.status()})`);
            }

            // SofaScore bot koruması için bekleme
            await new Promise(r => setTimeout(r, 1500));

        } catch (err) {
            console.log(`  ❌ Hata Oluştu (${id}): ${err.message}`);
        }
    }

    await browser.close();
    console.log(`\n✅ İŞLEM TAMAM: ${successCount} lig logosu indirildi.`);
}

start();