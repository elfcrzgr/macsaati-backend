const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadLogos() {
    const filePath = path.join(__dirname, 'matches.json');
    const logoDir = path.join(__dirname, 'logos');

    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir);
    if (!fs.existsSync(filePath)) return;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const teamIds = new Set();
    
    data.matches.forEach(m => {
        teamIds.add(m.homeTeam.logo.split('/').pop().replace('.png', ''));
        teamIds.add(m.awayTeam.logo.split('/').pop().replace('.png', ''));
    });

    console.log(`⏳ ${teamIds.size} logo alternatif yoldan deneniyor...`);

    for (const id of teamIds) {
        const localPath = path.join(logoDir, `${id}.png`);
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) continue;

        try {
            // ALTERNATİF URL: Statik resim sunucusu
            const url = `https://www.sofascore.com/static3/images/team-logo/${id}`;
            
            const response = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 10000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Referer': 'https://www.sofascore.com/'
                }
            });

            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            console.log(`✅ Başarıyla indirildi: ${id}.png`);
            
            // 🛑 Sunucuyu kızdırmayalım, 1.5 saniye bekle
            await new Promise(r => setTimeout(r, 1500));

        } catch (e) {
            console.log(`❌ Hata (${id}): ${e.response ? e.response.status : e.message}`);
        }
    }
}
downloadLogos();