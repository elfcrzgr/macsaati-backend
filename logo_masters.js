const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const configs = [
    {
        name: 'Futbol',
        file: 'matches_football.json',
        dirs: {
            team: path.join(__dirname, 'football', 'logos'),
            tournament: path.join(__dirname, 'football', 'tournament_logos')
        }
    },
    {
        name: 'Basketbol',
        file: 'matches_basketball.json',
        dirs: {
            team: path.join(__dirname, 'basketball', 'logos'),
            nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
            tournament: path.join(__dirname, 'basketball', 'tournament_logos')
        }
    },
    {
        name: 'Tenis',
        file: 'matches_tennis.json', // Tenis motorunun çıktısı
        dirs: {
            tournament: path.join(__dirname, 'tennis', 'tournament_logos')
        }
    }
];

// Klasörlerin varlığını kontrol et
configs.forEach(conf => {
    Object.values(conf.dirs).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
});

async function start() {
    console.log("🚀 Mac Saati Master Logo Güncelleyici Başlatıldı...\n");
    
    let browser = null;
    let page = null;
    let totalDownloaded = 0;
    let totalDefaulted = 0; 
    let totalFailed = 0;

    for (const conf of configs) {
        if (!fs.existsSync(conf.file)) continue;

        const json = JSON.parse(fs.readFileSync(conf.file, 'utf8'));
        const missing = [];

        json.matches.forEach(m => {
            // Takım/Bayrak Logoları Kontrolü
            // Tenis motorun birden fazla logo (bayrak) dizisi döndürdüğü için burayı güncelledim
            const teams = [m.homeTeam, m.awayTeam];
            teams.forEach(team => {
                if (team && team.logos && Array.isArray(team.logos)) {
                    team.logos.forEach(logoUrl => {
                        const logoId = logoUrl.split('/').pop().replace('.png', '');
                        if (logoId === 'default') return; // default.png zaten var sayılır
                        
                        // Tenis bayrakları direkt 'tennis/logos' içine gider
                        const targetDir = conf.name === 'Tenis' ? path.join(__dirname, 'tennis', 'logos') : conf.dirs.team;
                        if (!fs.existsSync(path.join(targetDir, `${logoId}.png`))) {
                            missing.push({ id: logoId, type: 'Logo', dir: targetDir, sport: conf.name });
                        }
                    });
                }
            });

            // Turnuva Logosu Kontrolü
            if (m.tournamentLogo) {
                const tId = m.tournamentLogo.split('/').pop().replace('.png', '');
                if (!fs.existsSync(path.join(conf.dirs.tournament, `${tId}.png`))) {
                    missing.push({ id: tId, type: 'Turnuva', dir: conf.dirs.tournament, sport: conf.name });
                }
            }
        });

        if (missing.length === 0) {
            console.log(`✅ [${conf.name}] Tüm logolar zaten mevcut.`);
            continue;
        }

        if (!browser) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        }

        console.log(`\n🔍 [${conf.name}] ${missing.length} adet yeni görsel tespit edildi:`);

        for (const item of missing) {
            const targetPath = path.join(item.dir, `${item.id}.png`);
            const localDefaultPath = path.join(item.dir, 'default.png'); 

            let success = false;
            try {
                // SofaScore API'den çekme denemesi
                let apiUrl = "";
                if (item.type === 'Turnuva') {
                    apiUrl = `https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`;
                } else {
                    apiUrl = `https://api.sofascore.com/api/v1/team/${item.id}/image`;
                }

                const res = await page.goto(apiUrl, { waitUntil: 'networkidle2', timeout: 10000 });
                if (res && res.status() === 200) {
                    const buf = await res.buffer();
                    if (buf.length > 500) {
                        fs.writeFileSync(targetPath, buf);
                        success = true;
                    }
                }

                // Eğer Turnuva logosuysa ve hala bulunamadıysa (Alternatif API)
                if (!success && item.type === 'Turnuva') {
                    const resAlt = await page.goto(`https://api.sofascore.com/api/v1/tournament/${item.id}/image`, { waitUntil: 'networkidle2', timeout: 10000 });
                    if (resAlt && resAlt.status() === 200) {
                        const bufAlt = await resAlt.buffer();
                        if (bufAlt.length > 500) {
                            fs.writeFileSync(targetPath, bufAlt);
                            success = true;
                        }
                    }
                }

                if (success) {
                    console.log(`   ✅ [İNDİRİLDİ] ${item.sport} ${item.type}: ${item.id}.png`);
                    totalDownloaded++;
                } else {
                    // --- BURASI KRİTİK: API'DE YOKSA DEFAULT'U KOPYALA ---
                    if (fs.existsSync(localDefaultPath)) {
                        fs.copyFileSync(localDefaultPath, targetPath);
                        console.log(`   ⚠️  [API BOŞ - DEFAULT ATANDI] ID: ${item.id} (${item.sport} ${item.type})`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA] ID: ${item.id} bulunamadı ve ${item.dir} klasöründe default.png yok!`);
                        totalFailed++;
                    }
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI HATASI] ${item.id}.png: ${e.message}`);
                totalFailed++;
            }
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (browser) await browser.close();

    console.log("\n--- İŞLEM ÖZETİ ---");
    console.log(`✅ İndirilen: ${totalDownloaded}`);
    console.log(`⚠️  Default Yapılan: ${totalDefaulted}`);
    console.log(`❌ Başarısız: ${totalFailed}`);
    console.log("-------------------\n");
}

start();
