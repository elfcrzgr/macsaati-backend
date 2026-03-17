const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Senin kopyaladığın metindeki takımlar ve SofaScore ID'leri
const eurocupTeams = [
    { name: "Hapoel Jerusalem", id: 3415 },
    { name: "Bahçeşehir Koleji", id: 161863 },
    { name: "Cedevita Olimpija", id: 182759 },
    { name: "Venezia", id: 3432 },
    { name: "Manresa", id: 3422 },
    { name: "U-BT Cluj-Napoca", id: 41019 },
    { name: "Aris", id: 3410 },
    { name: "Neptūnas", id: 36720 },
    { name: "Śląsk", id: 15450 },
    { name: "Hamburg Towers", id: 161819 },
    { name: "Beşiktaş", id: 3406 },
    { name: "JL Bourg", id: 3405 },
    { name: "Budućnost", id: 3411 },
    { name: "Türk Telekom", id: 3430 },
    { name: "Trento", id: 111307 },
    { name: "Chemnitz", id: 38481 },
    { name: "Ulm", id: 3431 },
    { name: "London Lions", id: 41021 },
    { name: "Lietkabelis", id: 15456 },
    { name: "Panionios", id: 3424 }
];

async function downloadLogos() {
    const dir = path.join(__dirname, 'basketball', 'logos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    console.log("🏀 EuroCup Logoları İndiriliyor...");

    for (const team of eurocupTeams) {
        const filePath = path.join(dir, `${team.id}.png`);
        
        // Zaten varsa indirme
        if (fs.existsSync(filePath)) {
            console.log(`⏩ ${team.name} zaten mevcut.`);
            continue;
        }

        try {
            const response = await axios({
                url: `https://api.sofascore.app/api/v1/team/${team.id}/image`,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                }
            });

            fs.writeFileSync(filePath, response.data);
            console.log(`✅ İndi: ${team.name}`);
            
            // Ban yememek için 1 saniye bekle
            await new Promise(r => setTimeout(r, 1000));
        } catch (error) {
            console.log(`❌ Hata (${team.name}): ${error.message}`);
        }
    }
    console.log("\n✨ Bitti! basketball/logos klasörüne bakabilirsin.");
}

downloadLogos();