const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadLogos() {
    const filePath = path.join(__dirname, 'matches.json');
    const logoDir = path.join(__dirname, 'logos');

    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const teamIds = new Set();
    data.matches.forEach(m => {
        teamIds.add(m.homeTeam.logo.split('/').pop().replace('.png', ''));
        teamIds.add(m.awayTeam.logo.split('/').pop().replace('.png', ''));
    });

    console.log(`⏳ ${teamIds.size} logo iMac üzerinden indiriliyor...`);

    for (const id of teamIds) {
        const localPath = path.join(logoDir, `${id}.png`);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) continue;

        try {
            // FARKLI URL YAPISI: api yerine doğrudan resim sunucusu
            const url = `https://www.sofascore.com/static3/images/team-logo/${id}`;
            
            const response = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer': 'https://www.sofascore.com/',
                    'Cache-Control': 'no-cache'
                }
            });

            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise((resolve) => writer.on('finish', resolve));
            console.log(`✅ İndirildi: ${id}.png`);
            
            // 🛑 BANLANMAMAK İÇİN: Her resim arası rastgele bekleme (1.5 - 3 saniye)
            await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

        } catch (e) {
            console.log(`❌ Hata (${id}): ${e.response?.status || e.message}`);
        }
    }
}
downloadLogos();