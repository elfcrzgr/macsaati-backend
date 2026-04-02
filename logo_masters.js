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

// Klasör kontrolü ve oluşturma
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

        // Logoları listeye ekleyen yardımcı fonksiyon
        const addLogoToMissing = (url, name, type, tournamentName) => {
            if (!url) return;
            // ?v=123 gibi parametreleri temizle ve ID'yi al
            const id = url.split('?')[0].split('/').pop().replace('.png', '');
            if (!id || id === 'default') return;

            const targetDir = conf.name === 'Tenis' && type === 'Logo' ? path.join(__dirname, 'tennis', 'logos') : (type === 'Turnuva' ? conf.dirs.tournament : conf.dirs.team);
            
            if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                if (!missing.find(x => x.id === id && x.type === type)) {
                    missing.push({ id, name, type, dir: targetDir, sport: conf.name, tournamentName });
                }
            }
        };

        // Bütün maçları tara
        json.matches.forEach(m => {
            const tName = m.tournament || "Bilinmiyor Turnuva";

            // --- EV SAHİBİ KONTROLLERİ ---
            const hName = m.homeTeam?.name || m.homeName || "Bilinmiyor Takım";
            if (m.homeTeam && Array.isArray(m.homeTeam.logos)) m.homeTeam.logos.forEach(l => addLogoToMissing(l, hName, 'Logo', tName));
            if (m.homeTeam && typeof m.homeTeam.logo === 'string') addLogoToMissing(m.homeTeam.logo, hName, 'Logo', tName);
            if (typeof m.homeLogo === 'string') addLogoToMissing(m.homeLogo, hName, 'Logo', tName);

            // --- DEPLASMAN KONTROLLERİ ---
            const aName = m.awayTeam?.name || m.awayName || "Bilinmiyor Takım";
            if (m.awayTeam && Array.isArray(m.awayTeam.logos)) m.awayTeam.logos.forEach(l => addLogoToMissing(l, aName, 'Logo', tName));
            if (m.awayTeam && typeof m.awayTeam.logo === 'string') addLogoToMissing(m.awayTeam.logo, aName, 'Logo', tName);
            if (typeof m.awayLogo === 'string') addLogoToMissing(m.awayLogo, aName, 'Logo', tName);

            // --- TURNUVA LOGOSU KONTROLÜ ---
            if (m.tournamentLogo) addLogoToMissing(m.tournamentLogo, tName, 'Turnuva', tName);
        });

        if (missing.length === 0) {
            console.log(`✅ [${conf.name}] Bütün logolar klasörde zaten mevcut. (Eksik yok)`);
            continue;
        }

        if (!browser) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        }

        console.log(`\n🔍 [${conf.name}] Klasörde olmayan ${missing.length} adet yeni görsel tespit edildi, indirme başlıyor...\n`);

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

                // Turnuva için ikinci API denemesi (Unique API patlarsa normal Tournament API dener)
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

                // LOG EKRANI (Açıklamalı)
                const logInfo = `ID: ${item.id} | İsim: ${item.name} (${item.type}) | Lig: ${item.tournamentName}`;

                if (success) {
                    console.log(`   ✅ [BAŞARILI] ${logInfo}`);
                    totalDownloaded++;
                } else {
                    if (fs.existsSync(localDefaultPath)) {
                        fs.copyFileSync(localDefaultPath, targetPath);
                        console.log(`   ⚠️  [DEFAULT ATANDI] ${logInfo} -> API'den logo gelmedi, yerine default eklendi.`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA - KOPYA YOK] ${logInfo} -> Ne API'de var, ne de klasörde default.png yedek dosyası var!`);
                        totalFailed++;
                    }
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI HATASI] ID: ${item.id} | İsim: ${item.name} | Hata: ${e.message}`);
                totalFailed++;
            }
            // Puppeteer banlanmasın diye her logo arası 800 milisaniye bekle
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (browser) await browser.close();

    console.log("\n===================================");
    console.log("📊 İŞLEM ÖZETİ");
    console.log("===================================");
    console.log(`✅ Gerçek Logo İndirilen : ${totalDownloaded}`);
    console.log(`⚠️  Default Logo Atanan    : ${totalDefaulted}`);
    console.log(`❌ İşlem Yapılamayan      : ${totalFailed}`);
    console.log("===================================\n");
}

start();
