const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

function extractTeamsFromMatches() {
    const matchesPath = path.join(__dirname, 'matches.json');
    if (!fs.existsSync(matchesPath)) {
        console.error('❌ matches.json bulunamadı!');
        process.exit(1);
    }
    const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    const teams = {};
    matches.matches.forEach(match => {
        teams[match.homeTeam.id] = match.homeTeam.name;
        teams[match.awayTeam.id] = match.awayTeam.name;
    });
    return teams;
}

async function start() {
    console.log("🚀 403 Engelini Aşmak İçin Tarayıcı Motoru Başlatılıyor...");

    const teams = extractTeamsFromMatches();
    const logosDir = path.join(__dirname, 'logos');
    if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir);

    // Gerçek bir tarayıcı açıyoruz
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();
    
    // Kendimizi tamamen gerçek bir kullanıcı gibi gösteriyoruz
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let successCount = 0;
    let skipCount = 0;

    for (const [teamId, teamName] of Object.entries(teams)) {
        const logoPath = path.join(logosDir, `${teamId}.png`);

        if (fs.existsSync(logoPath) && fs.statSync(logoPath).size > 500) {
            skipCount++;
            continue;
        }

        try {
            console.log(`📥 ${teamName} (${teamId}) çekiliyor...`);
            
            // Linki doğrudan tarayıcı sekmesinde açıyoruz
            const logoUrl = `https://api.sofascore.app/api/v1/team/${teamId}/image`;
            
            const response = await page.goto(logoUrl, { waitUntil: 'networkidle0' });
            
            if (response.status() === 200) {
                const buffer = await response.buffer();
                fs.writeFileSync(logoPath, buffer);
                console.log(`  ✅ Başarılı.`);
                successCount++;
            } else {
                console.log(`  ❌ Hata: ${response.status()}`);
            }

            // SofaScore'un bot olduğunu anlamaması için rastgele bekleme (1-2 saniye)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

        } catch (err) {
            console.log(`  ❌ İndirilemedi: ${err.message}`);
        }
    }

    await browser.close();
    console.log(`\n📊 SONUÇ: ${successCount} indirildi, ${skipCount} atlandı.`);
}

start();