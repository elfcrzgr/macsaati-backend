const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Önemli Basketbol Ligleri ID'leri
// 154: Türkiye BSL, 132: NBA, 138: EuroLeague, 139: EuroCup, 137: İspanya ACB, 11054: Şampiyonlar Ligi (BCL)
const BASKETBALL_LEAGUES = [154, 132, 138, 139, 137, 11054]; 

async function start() {
    console.log("🏀 Basketbol Logo Avcısı Başlatılıyor...");

    // İstediğin dizin yapısını oluşturuyoruz: basketball/logos/
    const baseDir = path.join(__dirname, 'basketball');
    const logosDir = path.join(baseDir, 'logos');
    
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);
    if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    // Gerçek kullanıcı simülasyonu
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    for (const leagueId of BASKETBALL_LEAGUES) {
        console.log(`\n-----------------------------------------`);
        console.log(`🔍 Lig ID: ${leagueId} taranıyor...`);
        
        try {
            // 1. Güncel Sezonu Al
            const seasonUrl = `https://api.sofascore.app/api/v1/unique-tournament/${leagueId}/seasons`;
            await page.goto(seasonUrl, { waitUntil: 'networkidle2' });
            const seasonData = await page.evaluate(() => JSON.parse(document.querySelector("pre").innerText));
            const currentSeasonId = seasonData.seasons[0].id;

            // 2. Takımları Puan Durumundan Çek
            const standingsUrl = `https://api.sofascore.app/api/v1/unique-tournament/${leagueId}/season/${currentSeasonId}/standings/total`;
            await page.goto(standingsUrl, { waitUntil: 'networkidle2' });
            const standingsData = await page.evaluate(() => JSON.parse(document.querySelector("pre").innerText));

            let teams = [];
            // Farklı lig yapıları için (NBA konferansları vs.) tüm tabloları dönüyoruz
            standingsData.standings.forEach(standing => {
                if (standing.rows) {
                    standing.rows.forEach(row => {
                        teams.push({ id: row.team.id, name: row.team.name });
                    });
                }
            });

            // Tekrarlanan takımları temizle (Bazı liglerde aynı takım farklı tablolarda olabilir)
            const uniqueTeams = Array.from(new Map(teams.map(t => [t.id, t])).values());
            console.log(`📍 ${uniqueTeams.length} benzersiz basketbol takımı bulundu.`);

            for (const team of uniqueTeams) {
                const logoPath = path.join(logosDir, `${team.id}.png`);

                // Varsa ve boyutu anlamlıysa (500 byte üstü) indirmiş sayıyoruz
                if (fs.existsSync(logoPath) && fs.statSync(logoPath).size > 500) {
                    continue; 
                }

                console.log(`📥 ${team.name} logosu -> basketball/logos/${team.id}.png`);
                const logoUrl = `https://api.sofascore.app/api/v1/team/${team.id}/image`;
                
                try {
                    const response = await page.goto(logoUrl, { waitUntil: 'networkidle0' });
                    if (response.status() === 200) {
                        const buffer = await response.buffer();
                        fs.writeFileSync(logoPath, buffer);
                        console.log(`   ✅ Kaydedildi.`);
                    } else {
                        console.log(`   ❌ Hata: ${response.status()}`);
                    }
                    
                    // Rastgele bekleme (SofaScore'un sinirini bozmamak için)
                    await new Promise(r => setTimeout(r, 1200 + Math.random() * 1000));
                } catch (e) {
                    console.log(`   ❌ Erişim Hatası: ${e.message}`);
                }
            }

        } catch (err) {
            console.error(`❌ Lig (${leagueId}) işlenirken hata: ${err.message}`);
        }
    }

    await browser.close();
    console.log("\n🏀 Tüm logolar 'basketball/logos/' klasörüne başarıyla indirildi!");
}

start();