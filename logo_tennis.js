const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    console.log("🚀 Tenis logo indirme işlemi (Puppeteer) başlatıldı...");

    if (!fs.existsSync(MATCHES_FILE)) {
        console.error("❌ JSON bulunamadı!");
        return;
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournaments = new Map();

    // 1. JSON içinden benzersiz ID'leri topla
    json.matches.forEach(m => {
        if (m.tournamentLogo) {
            const id = m.tournamentLogo.split('/').pop().replace('.png', '');
            if (!tournaments.has(id)) {
                tournaments.set(id, m.tournament);
            }
        }
    });

    console.log(`🔍 JSON Tarandı: ${tournaments.size} turnuva bulundu.`);

    // 2. Tarayıcıyı başlat
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });

    const page = await browser.newPage();
    // Gerçekçi bir ekran boyutu ve User-Agent ayarla
    await page.setViewport({ width: 1280, height: 800 });
    
    let successCount = 0;
    let failCount = 0;

    for (const [id, name] of tournaments) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);

        if (!fs.existsSync(targetPath)) {
            console.log(`⏳ İndiriliyor: ${name} (ID: ${id})`);
            
            const url = `https://api.sofascore.com/api/v1/tournament/${id}/image`;
            
            try {
                // Sayfaya git ve ağın boşalmasını bekle
                const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
                
                if (response && response.status() === 200) {
                    const buffer = await response.buffer();
                    // Eğer dönen içerik çok küçükse (hata mesajı vs) kaydetme
                    if (buffer.length > 500) {
                        fs.writeFileSync(targetPath, buffer);
                        console.log(`   ✅ Başarılı!`);
                        successCount++;
                    } else {
                        console.log(`   ⚠️  Hata: Dönen dosya çok küçük (Boş resim?).`);
                        failCount++;
                    }
                } else {
                    console.log(`   ❌ Hata: HTTP ${response ? response.status() : 'Bağlantı Yok'}`);
                    failCount++;
                }
            } catch (e) {
                console.log(`   ❌ Bağlantı Hatası: ${e.message}`);
                failCount++;
            }
            // Her resim arasında rastgele bekleme (bloklanmamak için)
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    await browser.close();
    console.log(`\n🏁 İşlem Tamamlandı:`);
    console.log(`   ✅ İndirilen: ${successCount}`);
    console.log(`   ⚠️  Başarısız: ${failCount}\n`);
}

start();
