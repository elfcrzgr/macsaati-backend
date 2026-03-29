const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin()); // Puppeteer'i Stealth modunda başlat

const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

// Eksik klasörleri oluştur
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

// Başlatıcı fonksiyon
async function start() {
    // JSON dosyasını kontrol et
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_tennis.js çalıştırılmalı.");
    }

    // JSON verisini yükle
    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournamentsToProcess = new Map();

    // 1. JSON'daki turnuva bilgilerini topla
    json.matches.forEach(m => {
        const tournamentId = m.tournamentLogo.split('/').pop().replace('.png', '');
        if (!tournamentsToProcess.has(tournamentId)) {
            tournamentsToProcess.set(tournamentId, { name: m.tournament });
        }
    });

    console.log(`\n🔍 JSON Tarandı: Toplam ${tournamentsToProcess.size} turnuva bulundu.`);

    // 2. Eksik logoları belirle
    const missingTournaments = [];
    tournamentsToProcess.forEach((info, id) => {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        if (!fs.existsSync(targetPath)) {
            missingTournaments.push({ id, ...info });
        }
    });

    if (missingTournaments.length === 0) {
        console.log("\n🎉 Harika! Tüm turnuva logoları mevcut. İşlem tamamlandı.\n");
        return;
    }

    console.log(`\n⚠️  ${missingTournaments.length} adet eksik turnuva logosu bulundu. İndirme işlemi başlatıldı...\n`);

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let successCount = 0;

    // 3. Eksik logoları indir
    for (const t of missingTournaments) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`);
        try {
            // SofaScore turnuva URL'sini oluştur
            const tournamentUrl = `https://www.sofascore.com/tennis/tournament/atp/${t.name.toLowerCase().replace(/\s/g, '-')}/${t.id}`;
            console.log(`🔗 Sayfa yükleniyor: ${tournamentUrl}`);
            await page.goto(tournamentUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Turnuva logosunu seç ve URL'sini al
            const logoUrl = await page.evaluate(() => {
                const logoElement = document.querySelector('img[class*="Logo"]'); // Logo etiketini bul
                return logoElement ? logoElement.src : null;
            });

            if (logoUrl) {
                // Logoyu indir ve dosyaya yaz
                const response = await page.goto(logoUrl, { timeout: 30000 });
                const buffer = await response.buffer();
                fs.writeFileSync(targetPath, buffer);
                console.log(`   ✅ İndirildi: ${t.name}`);
                successCount++;
            } else {
                console.error(`   ❌ Logo bulunamadı: ${t.name}`);
            }
        } catch (error) {
            console.error(`   ❌ Hata: ${t.name} için dosya indirilemedi.`, error.message);
        }

        // SofaScore erişim sınırından kaçmak için bekleme süresi ekleyin
        await new Promise(r => setTimeout(r, 1000));
    }

    // Tarayıcı işlemlerini sonlandır
    await browser.close();

    console.log(`\n🏁 İşlem tamamlandı:`);
    console.log(`   - Başarıyla indirilen logolar: ${successCount}`);
    console.log(`   - Eksik kalan logolar: ${missingTournaments.length - successCount}\n`);
}

start();