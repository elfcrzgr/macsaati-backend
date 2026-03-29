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
        file: 'matches_tennis.json',
        dirs: {
            tournament: path.join(__dirname, 'tennis', 'tournament_logos')
        }
    }
];

// Klasör kontrolü
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
    let totalFailed = 0;

    for (const conf of configs) {
        if (!fs.existsSync(conf.file)) continue;

        const json = JSON.parse(fs.readFileSync(conf.file, 'utf8'));
        const missing = [];

        json.matches.forEach(m => {
            // Takım Logoları
            if (m.homeTeam && m.homeTeam.logo) {
                const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
                const hIsNba = m.homeTeam.logo.includes("/NBA/");
                const hDir = hIsNba ? (conf.dirs.nba || conf.dirs.team) : conf.dirs.team;
                if (!fs.existsSync(path.join(hDir, `${hId}.png`))) missing.push({ id: hId, type: 'Takım', dir: hDir, sport: conf.name });
            }
            if (m.awayTeam && m.awayTeam.logo) {
                const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');
                const aIsNba = m.awayTeam.logo.includes("/NBA/");
                const aDir = aIsNba ? (conf.dirs.nba || conf.dirs.team) : conf.dirs.team;
                if (!fs.existsSync(path.join(aDir, `${aId}.png`))) missing.push({ id: aId, type: 'Takım', dir: aDir, sport: conf.name });
            }

            // Turnuva Logoları
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

        console.log(`\n🔍 [${conf.name}] ${missing.length} adet yeni logo tespit edildi:`);

        for (const item of missing) {
            const targetPath = path.join(item.dir, `${item.id}.png`);
            if (fs.existsSync(targetPath)) continue;

            let success = false;
            try {
                if (item.sport === 'Tenis' || item.type === 'Turnuva') {
                    // Turnuva Fallback Mekanizması
                    const urls = [
                        `https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`,
                        `https://api.sofascore.com/api/v1/tournament/${item.id}/image`
                    ];
                    for (const url of urls) {
                        const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
                        if (res && res.status() === 200) {
                            const buf = await res.buffer();
                            if (buf.length > 500) {
                                fs.writeFileSync(targetPath, buf);
                                success = true;
                                break;
                            }
                        }
                    }
                } else {
                    // Normal Takım Logosu
                    const res = await page.goto(`https://api.sofascore.com/api/v1/team/${item.id}/image`, { waitUntil: 'networkidle2', timeout: 15000 });
                    if (res && res.status() === 200) {
                        fs.writeFileSync(targetPath, await res.buffer());
                        success = true;
                    }
                }

                if (success) {
                    console.log(`   ✅ [İNDİRİLDİ] ${item.sport} ${item.type}: ${item.id}.png`);
                    totalDownloaded++;
                } else {
                    console.log(`   ❌ [HATA] ${item.sport} ${item.type}: ${item.id}.png (API'de bulunamadı)`);
                    totalFailed++;
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI HATASI] ${item.id}.png: ${e.message}`);
                totalFailed++;
            }
            await new Promise(r => setTimeout(r, 1000)); // Rate limit koruması
        }
    }

    if (browser) await browser.close();

    console.log("\n--- İŞLEM ÖZETİ ---");
    console.log(`✅ Başarıyla İndirilen: ${totalDownloaded}`);
    console.log(`❌ Başarısız/Eksik: ${totalFailed}`);
    console.log("-------------------\n");
}

start();