const util = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);

async function testEndpoint(name, url) {
    console.log(`\n============================================================`);
    console.log(`🔍 [${name}] Deneniyor: ${url}`);
    
    try {
        // 1. Önce standart fetch ile deneyelim
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            },
            signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
            const text = await response.text();
            try {
                const json = JSON.parse(text);
                console.log(`✅ [FETCH BAŞARILI] JSON formatı alındı!`);
                console.log(`Veri örneği:`, JSON.stringify(json).substring(0, 200) + '...');
                return true;
            } catch (e) {
                console.log(`⚠️ Fetch başarılı ama gelen veri JSON değil (HTML döndü).`);
            }
        } else {
            console.log(`⚠️ Fetch başarısız: HTTP ${response.status}`);
        }
    } catch (e) {
        console.log(`⚠️ Fetch hatası: ${e.message}`);
    }

    console.log(`🚀 [${name}] CURL ile zorlanıyor...`);
    try {
        // 2. Fetch patlarsa CURL ile deneyelim
        const { stdout } = await execFileAsync('curl', [
            '-s', '--max-time', '10',
            url,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '-H', 'Accept: application/json'
        ]);

        try {
            const json = JSON.parse(stdout);
            console.log(`✅ [CURL BAŞARILI] JSON formatı alındı!`);
            console.log(`Veri örneği:`, JSON.stringify(json).substring(0, 200) + '...');
            return true;
        } catch (e) {
            console.log(`❌ CURL de başarısız (Gelen veri JSON değil).`);
        }
    } catch (e) {
        console.log(`❌ CURL hatası: ${e.message}`);
    }
    
    return false;
}

async function runTests() {
    // ACB (İspanya) ve LBA (İtalya) için en yaygın kullanılan canlı veri uç noktaları
    const endpoints = [
        { name: "İSPANYA ACB (Alternatif 1)", url: "https://live.acb.com/api/matches" },
        { name: "İSPANYA ACB (Alternatif 2)", url: "https://api.acb.com/api/v1/matches/today" },
        { name: "İTALYA LBA (Alternatif 1)", url: "https://www.legabasket.it/api/match/today" },
        { name: "İTALYA LBA (Alternatif 2)", url: "https://www.legabasket.it/api/matches" }
    ];

    for (const ep of endpoints) {
        await testEndpoint(ep.name, ep.url);
    }
    
    console.log("\n🛑 Test bitti. Lütfen terminal ekranının fotoğrafını veya çıktısını paylaş.");
}

runTests();
