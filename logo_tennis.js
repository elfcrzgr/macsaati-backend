const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Dosya yolları
const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

// Klasör yoksa oluştur
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) {
    fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });
}

/**
 * Belirtilen ID'ye sahip logoyu SofaScore API'den indirir.
 */
async function downloadLogo(id, name) {
    const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
    const url = `https://api.sofascore.com/api/v1/tournament/${id}/image`;

    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://www.sofascore.com/'
            },
            timeout: 15000
        });

        const writer = fs.createWriteStream(targetPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(true));
            writer.on('error', (err) => {
                console.error(`   ❌ Yazma Hatası (${name}):`, err.message);
                resolve(false);
            });
        });
    } catch (error) {
        console.log(`   ❌ [Hata] ${name} (ID: ${id}): API hatası veya Logo yok.`);
        return false;
    }
}

async function start() {
    console.log("🚀 Tenis logo indirme işlemi başlatıldı...");

    if (!fs.existsSync(MATCHES_FILE)) {
        console.error("❌ HATA: matches_tennis.json bulunamadı!");
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournaments = new Map();

    // 1. JSON içindeki benzersiz turnuva ID'lerini topla
    data.matches.forEach(match => {
        if (match.tournamentLogo) {
            // URL'den ID'yi al (Örn: .../2431.png -> 2431)
            const id = match.tournamentLogo.split('/').pop().replace('.png', '');
            if (!tournaments.has(id)) {
                tournaments.set(id, match.tournament);
            }
        }
    });

    console.log(`🔍 JSON tarandı. Toplam ${tournaments.size} farklı turnuva tespit edildi.`);

    // 2. Eksik olanları belirle ve indir
    let successCount = 0;
    let missingCount = 0;

    for (const [id, name] of tournaments) {
        const filePath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);

        if (!fs.existsSync(filePath)) {
            console.log(`⏳ İndiriliyor: ${name} (ID: ${id})`);
            const success = await downloadLogo(id, name);
            if (success) {
                successCount++;
            } else {
                missingCount++;
            }
            // Sunucuyu yormamak ve bloklanmamak için kısa bekleme
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log(`\n🏁 İşlem Tamamlandı:`);
    console.log(`   ✅ Başarıyla indirilen: ${successCount}`);
    console.log(`   ⚠️  İndirilemeyen/Eksik: ${missingCount}`);
    console.log(`   📂 Klasör: ${TOURNAMENT_LOGOS_DIR}\n`);
}

start();
