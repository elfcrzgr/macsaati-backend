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
    let totalDefaulted = 0;
    let totalFailed = 0;

    for (const conf of configs) {
        if (!fs.existsSync(conf.file)) continue;

        const json = JSON.parse(fs.readFileSync(conf.file, 'utf8'));
        const missing = [];

        json.matches.forEach(m => {
            // Takım / Bayrak Logoları (Tenis motorundaki array yapısına uygun)
            const teams = [m.homeTeam, m.awayTeam];
            teams.forEach(team => {
                if (team && team.logos && Array.isArray(team.logos)) {
                    team.logos.forEach(logoUrl => {
                        const logoId = logoUrl.split('/').pop().replace('.png', '');
                        if (logoId === 'default') return;
                        
                        const targetDir = conf.name === 'Tenis' ? path.join(__dirname, 'tennis', 'logos') : conf.dirs.team;
                        if (!fs.existsSync(path.join(targetDir, `${logoId}.png`))) {
                            missing.push({ id: logoId, type: 'Logo/Bayrak', dir: targetDir, sport: conf.name, tournamentName: m.tournament });
                        }
                    });
                }
            });

            // Turnuva Logoları
            if (m.tournamentLogo) {
                const tId = m.tournamentLogo.split('/').pop().replace('.png', '');
                if (!fs.existsSync(path.join(conf.dirs.tournament, `${tId}.png`))) {
                    missing.push({ id: tId, type: 'Turnuva', dir: conf.dirs.tournament, sport: conf.name, tournamentName: m.tournament });
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
                let apiUrl = item.type === 'Turnuva' 
                    ? `https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`
                    : `https://api.sofascore.com/api/v1/team/${item.id}/image`;

                const res = await page.goto(apiUrl, { waitUntil: 'networkidle2', timeout: 10000 });
                if (res && res.status() === 200) {
                    const buf = await res.buffer();
                    if (buf.length > 500) {
                        fs.writeFileSync(targetPath, buf);
                        success = true;
                    }
                }

                // Turnuva için ikinci deneme (Unique değilse normal ID ile)
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

                const logInfo = `ID: ${item.id} | Ad: ${item.tournamentName || 'Bilinmiyor'} (${item.type})`;

                if (success) {
                    console.log(`   ✅ [İNDİRİLDİ] ${logInfo}`);
                    totalDownloaded++;
                } else {
                    if (fs.existsSync(localDefaultPath)) {
                        fs.copyFileSync(localDefaultPath, targetPath);
                        console.log(`   ⚠️  [DEFAULT ATANDI] ${logInfo} -> API'de yoktu.`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA - DEFAULT YOK] ${logInfo} -> Klasörde default.png eksik!`);
                        totalFailed++;
                    }
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI HATASI] ID: ${item.id} | Hata: ${e.message}`);
                totalFailed++;
            }
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (browser) await browser.close();

    console.log("\n--- İŞLEM ÖZETİ ---");
    console.log(`✅ Gerçek Logo İndirilen: ${totalDownloaded}`);
    console.log(`⚠️  Default Logo Atanan   : ${totalDefaulted}`);
    console.log(`❌ İşlem Yapılamayan     : ${totalFailed}`);
    console.log("-------------------\n");
}

start();
