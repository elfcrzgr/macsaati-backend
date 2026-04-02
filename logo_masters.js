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

// Klasörleri kontrol et ve yoksa oluştur
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

        const addLogoToMissing = (url, name, type, tournamentName) => {
            if (!url) return;
            const id = url.split('?')[0].split('/').pop().replace('.png', '');
            
            // 🔥 GÜVENLİK BARİYERİ: Hatalı linkleri engelle
            if (!id || id === 'default' || id === 'undefined' || id === 'null') return;

            // 🔥 KLASÖR YOLUNU AKILLI SEÇME MANTIĞI (NBA DÜZELTİLDİ)
            let targetDir;
            if (conf.name === 'Tenis' && type === 'Logo') {
                targetDir = path.join(__dirname, 'tennis', 'logos');
            } else if (conf.name === 'Basketbol' && type === 'Logo' && tournamentName === 'NBA') {
                targetDir = conf.dirs.nba; 
            } else if (type === 'Turnuva') {
                targetDir = conf.dirs.tournament;
            } else {
                targetDir = conf.dirs.team;
            }
            
            if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                if (!missing.find(x => x.id === id && x.type === type)) {
                    missing.push({ id, name, type, dir: targetDir, sport: conf.name, tournamentName });
                }
            }
        };

        json.matches.forEach(m => {
            const tName = m.tournament || "Bilinmiyor Turnuva";

            // Ev Sahibi
            const hName = m.homeTeam?.name || m.homeName || "Bilinmiyor Takım";
            if (m.homeTeam && Array.isArray(m.homeTeam.logos)) m.homeTeam.logos.forEach(l => addLogoToMissing(l, hName, 'Logo', tName));
            if (m.homeTeam && typeof m.homeTeam.logo === 'string') addLogoToMissing(m.homeTeam.logo, hName, 'Logo', tName);
            if (typeof m.homeLogo === 'string') addLogoToMissing(m.homeLogo, hName, 'Logo', tName);

            // Deplasman
            const aName = m.awayTeam?.name || m.awayName || "Bilinmiyor Takım";
            if (m.awayTeam && Array.isArray(m.awayTeam.logos)) m.awayTeam.logos.forEach(l => addLogoToMissing(l, aName, 'Logo', tName));
            if (m.awayTeam && typeof m.awayTeam.logo === 'string') addLogoToMissing(m.awayTeam.logo, aName, 'Logo', tName);
            if (typeof m.awayLogo === 'string') addLogoToMissing(m.awayLogo, aName, 'Logo', tName);

            // Turnuva Logosu
            if (m.tournamentLogo) addLogoToMissing(m.tournamentLogo, tName, 'Turnuva', tName);
        });

        if (missing.length === 0) {
            console.log(`✅ [${conf.name}] Bütün logolar klasörde mevcut.`);
            continue;
        }

        if (!browser) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        }

        console.log(`\n🔍 [${conf.name}] ${missing.length} adet yeni görsel indiriliyor...\n`);

        let currentCount = 0;
        for (const item of missing) {
            currentCount++;
            const targetPath = path.join(item.dir, `${item.id}.png`);
            const localDefaultPath = path.join(item.dir, 'default.png'); 

            let success = false;
            try {
                let apiUrl = item.type === 'Turnuva' 
                    ? `https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`
                    : `https://api.sofascore.com/api/v1/team/${item.id}/image`;

                const res = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                if (res && res.status() === 200) {
                    const buf = await res.buffer();
                    if (buf.length > 500) {
                        fs.writeFileSync(targetPath, buf);
                        success = true;
                    }
                }

                if (!success && item.type === 'Turnuva') {
                    const resAlt = await page.goto(`https://api.sofascore.com/api/v1/tournament/${item.id}/image`, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    if (resAlt && resAlt.status() === 200) {
                        const bufAlt = await resAlt.buffer();
                        if (bufAlt.length > 500) {
                            fs.writeFileSync(targetPath, bufAlt);
                            success = true;
                        }
                    }
                }

                const logInfo = `[${currentCount}/${missing.length}] ID: ${item.id} | ${item.name} (${item.type})`;

                if (success) {
                    console.log(`   ✅ [İNDİ] ${logInfo}`);
                    totalDownloaded++;
                } else {
                    if (fs.existsSync(localDefaultPath)) {
                        fs.copyFileSync(localDefaultPath, targetPath);
                        console.log(`   ⚠️  [DEFAULT] ${logInfo}`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA] ${logInfo}`);
                        totalFailed++;
                    }
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI] [${currentCount}/${missing.length}] ID: ${item.id} | ${item.name}`);
                totalFailed++;
            }
            await new Promise(r => setTimeout(r, 300));
        }
    }

    if (browser) await browser.close();

    console.log("\n===================================");
    console.log("📊 İŞLEM ÖZETİ");
    console.log("===================================");
    console.log(`✅ İndirilen : ${totalDownloaded}`);
    console.log(`⚠️  Default   : ${totalDefaulted}`);
    console.log(`❌ Başarısız : ${totalFailed}`);
    console.log("===================================\n");
}

start();
