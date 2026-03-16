const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Önce matches.json'dan tüm takımları çıkar
function extractTeamsFromMatches() {
    const matchesPath = path.join(__dirname, 'matches.json');
    if (!fs.existsSync(matchesPath)) {
        console.error('❌ matches.json bulunamadı! Önce fetch.js çalıştır.');
        process.exit(1);
    }

    const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    const teams = {};

    for (const match of matches.matches) {
        teams[match.homeTeam.id] = match.homeTeam.name;
        teams[match.awayTeam.id] = match.awayTeam.name;
    }

    return teams;
}

// Her takım için logo URL'sini Sofascore API'den al
async function getTeamLogoUrl(teamId) {
    return new Promise((resolve) => {
        https.get(`https://api.sofascore.com/api/v1/team/${teamId}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const logoUrl = json.team?.image || json.team?.imageUrl;
                    resolve(logoUrl);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

// Logo'yu indir (Puppeteer ile hotlink bypass)
async function downloadLogoWithPuppeteer(teamId, teamName, page) {
    try {
        const teamPageUrl = `https://www.sofascore.com/team/football/${teamId}/`;
        await page.goto(teamPageUrl, { 
            waitUntil: 'load',
            timeout: 10000 
        });

        await page.waitForTimeout(1000);

        // Sayfada herhangi bir img tag'ı ara
        const imgSrc = await page.evaluate(() => {
            const imgs = document.querySelectorAll('img');
            for (let img of imgs) {
                if (img.src && img.src.includes('.') && 
                    !img.src.includes('data:') &&
                    img.naturalHeight > 20 && img.naturalWidth > 20) {
                    return img.src;
                }
            }
            return null;
        });

        return imgSrc;
    } catch {
        return null;
    }
}

// Logo dosyasını indir
const downloadFile = (url, filepath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        const protocol = url.startsWith('https') ? https : require('http');
        
        protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.sofascore.com/'
            }
        }, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
};

async function start() {
    console.log("📥 Logolar otomatik olarak indirilecek...\n");

    // Step 1: matches.json'dan takımları çıkar
    console.log("📋 matches.json'dan takımlar alınıyor...");
    const teams = extractTeamsFromMatches();
    console.log(`✅ ${Object.keys(teams).length} takım bulundu\n`);

    const logosDir = path.join(__dirname, 'team-logos');
    if (!fs.existsSync(logosDir)) {
        fs.mkdirSync(logosDir, { recursive: true });
    }

    // Step 2: Browser aç
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const teamMetadata = {};
    let successCount = 0;
    let skipCount = 0;

    // Step 3: Her takım için logo indir
    for (const [teamId, teamName] of Object.entries(teams)) {
        try {
            // Hala varsa skip et
            const logoPath = path.join(logosDir, `${teamId}.png`);
            if (fs.existsSync(logoPath)) {
                const stats = fs.statSync(logoPath);
                if (stats.size > 100) {
                    console.log(`⏭️  ${teamName} (${teamId}) - zaten var`);
                    skipCount++;
                    continue;
                }
            }

            console.log(`📥 ${teamName} (${teamId})...`);

            // Logo URL'sini al
            let logoUrl = await getTeamLogoUrl(teamId);

            // URL yoksa Puppeteer ile sayfadan çıkar
            if (!logoUrl) {
                console.log(`   🔍 Sofascore sayfasından aranıyor...`);
                logoUrl = await downloadLogoWithPuppeteer(teamId, teamName, page);
            }

            if (!logoUrl) {
                console.log(`   ⚠️ Logo URL bulunamadı\n`);
                continue;
            }

            // URL'yi düzelt
            if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
            if (!logoUrl.startsWith('http')) logoUrl = 'https://www.sofascore.com' + logoUrl;

            console.log(`   🔗 İndiriliyor...`);

            try {
                await downloadFile(logoUrl, logoPath);
                const stats = fs.statSync(logoPath);

                if (stats.size > 100) {
                    teamMetadata[teamId] = {
                        name: teamName,
                        logoUrl: `https://raw.githubusercontent.com/elfcrzgr/macsaati-backend/main/team-logos/${teamId}.png`
                    };
                    successCount++;
                    console.log(`   ✅ ${stats.size} bytes\n`);
                } else {
                    fs.unlinkSync(logoPath);
                    console.log(`   ⚠️ Boş dosya\n`);
                }
            } catch (downloadErr) {
                console.log(`   ❌ İndir hatası: ${downloadErr.message}\n`);
            }
        } catch (e) {
            console.error(`   ❌ ${e.message}\n`);
        }
    }

    await browser.close();

    // Step 4: Metadata kaydet
    fs.writeFileSync(
        path.join(logosDir, 'teams.json'),
        JSON.stringify(teamMetadata, null, 2)
    );

    console.log(`\n📊 Sonuç:`);
    console.log(`   ✅ ${successCount} logo indirildi`);
    console.log(`   ⏭️  ${skipCount} logo zaten vardı`);
    console.log(`   ❌ ${Object.keys(teams).length - successCount - skipCount} başarısız`);
    console.log(`\n📂 GitHub'a yükle:`);
    console.log(`   git add team-logos/`);
    console.log(`   git commit -m "Auto-download team logos"`);
    console.log(`   git push`);
}

start();