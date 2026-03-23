const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// --- ŞAŞMAZ KLASÖR YOLLARI ---
const MATCHES_FILE = path.join(__dirname, 'matches_football.json');
const LOGOS_DIR = path.join(__dirname, 'football', 'logos');

// Klasör yoksa otomatik oluşturur
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON okunamadı! Önce fetch_football.js dosyasını çalıştırın.");
    }

    const data = fs.readFileSync(MATCHES_FILE, 'utf8');
    const json = JSON.parse(data);
    const teamsToProcess = new Map();

    // 1. JSON'daki takımları bul
    json.matches.forEach(m => {
        // Logo URL'sinden ID'yi çekip çıkarıyoruz
        const homeId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const awayId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        
        teamsToProcess.set(homeId, { name: m.homeTeam.name });
        teamsToProcess.set(awayId, { name: m.awayTeam.name });
    });

    // 2. Eksikleri tespit et
    const missingTeams = [];
    teamsToProcess.forEach((info, id) => {
        const filePath = path.join(LOGOS_DIR, `${id}.png`);
        
        // Eğer o doğru klasörde logo yoksa "Eksik" listesine ekle
        if (!fs.existsSync(filePath)) {
            missingTeams.push({ id, ...info });
        }
    });

    console.log(`\n🔍 JSON tarandı. Toplam ${teamsToProcess.size} benzersiz takım bulundu.`);
    
    // 3. Raporlama ve İndirme Kararı
    if (missingTeams.length === 0) {
        console.log(`🎉 Harika! Tüm takım logoları KLASÖRDE zaten mevcut. İşlem bitti.\n`);
        return;
    }

    console.log(`⚠️ ${missingTeams.length} adet eksik logo bulundu. SofaScore güvenlik duvarı aşılıyor, tarayıcı başlatılıyor...\n`);

    // --- PUPPETEER İLE GİZLİ İNDİRME OPERASYONU ---
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let successCount = 0;

    for (const t of missingTeams) {
        const filePath = path.join(LOGOS_DIR, `${t.id}.png`);
        const url = `https://api.sofascore.com/api/v1/team/${t.id}/image`;

        try {
            const viewSource = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            if (viewSource && viewSource.status() === 200) {
                const buffer = await viewSource.buffer();
                fs.writeFileSync(filePath, buffer);
                console.log(`✅ İndirildi: ${t.name} -> ${t.id}.png`);
                successCount++;
            } else {
                console.error(`❌ İndirilemedi (${t.name}): API ${viewSource ? viewSource.status() : 'Bilinmeyen'} döndürdü.`);
            }
        } catch (err) {
            console.error(`❌ Bağlantı Hatası (${t.name}):`, err.message);
        }

        // SofaScore radarından kaçmak için 1 saniye bekle
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    console.log(`\n🏁 İŞLEM BİTTİ: Toplam ${successCount} yeni logo başarıyla klasöre eklendi!\n`);
}

start();