const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// --- ŞAŞMAZ KLASÖR YOLLARI ---
const MATCHES_FILE = path.join(__dirname, 'matches_football.json');
const LOGOS_DIR = path.join(__dirname, 'football', 'logos');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'football', 'tournament_logos');

// Klasörler yoksa otomatik oluşturur
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON okunamadı! Önce fetch_football.js dosyasını çalıştırın.");
    }

    const data = fs.readFileSync(MATCHES_FILE, 'utf8');
    const json = JSON.parse(data);
    const teamsToProcess = new Map();
    const tournamentsToProcess = new Map();

    // 1. JSON'daki takımları ve turnuvaları bul
    json.matches.forEach(m => {
        // Takım logoları için ID
        const homeId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const awayId = m.awayTeam.logo.split('/').pop().replace('.png', '');

        teamsToProcess.set(homeId, { name: m.homeTeam.name });
        teamsToProcess.set(awayId, { name: m.awayTeam.name });

        // Turnuva logoları için ID
        const tournamentId = m.tournamentLogo.split('/').pop().replace('.png', '');
        tournamentsToProcess.set(tournamentId, { name: m.tournament });
    });

    // 2. Eksikleri tespit et (Takım logoları)
    const missingTeams = [];
    teamsToProcess.forEach((info, id) => {
        const filePath = path.join(LOGOS_DIR, `${id}.png`);

        // Eğer o doğru klasörde logo yoksa "Eksik" listesine ekle
        if (!fs.existsSync(filePath)) {
            missingTeams.push({ id, ...info });
        }
    });

    // Eksikleri tespit et (Turnuva logoları)
    const missingTournaments = [];
    tournamentsToProcess.forEach((info, id) => {
        const filePath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);

        // Eğer turnuva logosu eksikse "Eksik" listesine ekle
        if (!fs.existsSync(filePath)) {
            missingTournaments.push({ id, ...info });
        }
    });

    console.log(`\n🔍 JSON tarandı. Toplam ${teamsToProcess.size} benzersiz takım ve ${tournamentsToProcess.size} turnuva bulundu.`);

    // Takım logoları indirme işlemi
    if (missingTeams.length === 0) {
        console.log(`🎉 Harika! Tüm takım logoları KLASÖRDE zaten mevcut.`);
    } else {
        console.log(`⚠️ ${missingTeams.length} adet eksik takım logosu bulundu. SofaScore güvenlik duvarı aşılıyor, tarayıcı başlatılıyor...\n`);

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
        console.log(`\n🏁 TAKIMLAR: Toplam ${successCount} yeni logo başarıyla klasöre eklendi!\n`);
    }

    // Turnuva logoları indirme işlemi
    if (missingTournaments.length === 0) {
        console.log(`🎉 Harika! Tüm turnuva logoları KLASÖRDE zaten mevcut.`);
    } else {
        console.log(`⚠️ ${missingTournaments.length} adet eksik turnuva logosu bulundu. İndirmeye başlıyorum...\n`);

        const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let successCount = 0;

        for (const t of missingTournaments) {
            const filePath = path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`);
            const url = `https://api.sofascore.com/api/v1/tournament/${t.id}/image`;

            try {
                const viewSource = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

                if (viewSource && viewSource.status() === 200) {
                    const buffer = await viewSource.buffer();
                    fs.writeFileSync(filePath, buffer);
                    console.log(`✅ İndirildi: Turnuva -> ${t.name} (${t.id}.png)`);
                    successCount++;
                } else {
                    console.error(`❌ İndirilemedi (${t.name}): API ${viewSource ? viewSource.status() : 'Bilinmeyen'} döndürdü.`);
                }
            } catch (err) {
                console.error(`❌ Bağlantı Hatası (${t.name}):`, err.message);
            }

            // Radar tespitinden kaçınmak için 1 saniye bekle
            await new Promise(r => setTimeout(r, 1000));
        }

        await browser.close();
        console.log(`\n🏁 TURNUVALAR: Toplam ${successCount} yeni turnuva logosu başarıyla klasöre eklendi!\n`);
    }
}

start();