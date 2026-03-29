const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    console.log("🚀 Tenis logo indirme (Akıllı ID Kontrolü) başlatıldı...");

    if (!fs.existsSync(MATCHES_FILE)) {
        console.error("❌ JSON bulunamadı!");
        return;
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournaments = new Map();

    json.matches.forEach(m => {
        if (m.tournamentLogo) {
            const id = m.tournamentLogo.split('/').pop().replace('.png', '');
            if (!tournaments.has(id)) {
                tournaments.set(id, m.tournament);
            }
        }
    });

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    let successCount = 0;

    for (const [id, name] of tournaments) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        if (fs.existsSync(targetPath)) continue;

        console.log(`⏳ İşleniyor: ${name} (ID: ${id})`);
        
        // Denenecek URL listesi (Unique ve Normal)
        const urls = [
            `https://api.sofascore.com/api/v1/unique-tournament/${id}/image`,
            `https://api.sofascore.com/api/v1/tournament/${id}/image`
        ];

        let downloaded = false;

        for (const url of urls) {
            try {
                const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                
                if (response && response.status() === 200) {
                    const buffer = await response.buffer();
                    if (buffer.length > 500) {
                        fs.writeFileSync(targetPath, buffer);
                        console.log(`   ✅ Başarılı (${url.includes('unique') ? 'Unique' : 'Normal'} API)`);
                        downloaded = true;
                        successCount++;
                        break; // Logoyu bulduk, diğer URL'yi denemeye gerek yok
                    }
                }
            } catch (e) {
                // Sessizce devam et, diğer URL'yi dene
            }
        }

        if (!downloaded) {
            console.log(`   ❌ Hata: İki API adresinde de logo bulunamadı.`);
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    console.log(`\n🏁 İşlem Tamamlandı. Yeni indirilen: ${successCount}\n`);
}

start();
