// Bu betik sadece EuroLeague API'sinin gerçek JSON yapısını görmek içindir.
// Firebase'e veya başka bir yere yazmaz, sadece terminale yazdırır.

async function explore() {
    const urls = [
        // EuroLeague, 2025-26 sezonu
        "https://api-live.euroleague.net/v2/competitions/E/seasons/E2025/games",
        // EuroCup, 2025-26 sezonu
        "https://api-live.euroleague.net/v2/competitions/U/seasons/U2025/games"
    ];

    for (const url of urls) {
        console.log(`\n============================================================`);
        console.log(`🔍 Deneniyor: ${url}`);
        console.log(`============================================================`);
        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
                    "Accept": "application/json"
                }
            });
            console.log("Durum kodu:", response.status);
            const text = await response.text();

            try {
                const json = JSON.parse(text);
                // Dizi mi, obje mi, data alanı var mı kontrol edelim
                const isArray = Array.isArray(json);
                console.log("Tip:", isArray ? "Array" : typeof json);

                let sample;
                if (isArray) {
                    console.log("Toplam öğe:", json.length);
                    sample = json[0];
                } else if (json.data && Array.isArray(json.data)) {
                    console.log("json.data bulundu, toplam öğe:", json.data.length);
                    sample = json.data[0];
                } else {
                    console.log("Üst seviye anahtarlar:", Object.keys(json));
                    sample = json;
                }

                console.log("\n📋 İlk öğe örneği (tam):");
                console.log(JSON.stringify(sample, null, 2));
            } catch (parseErr) {
                console.log("JSON parse edilemedi. Ham cevabın ilk 500 karakteri:");
                console.log(text.slice(0, 500));
            }
        } catch (e) {
            console.error("❌ İstek hatası:", e.message);
        }
    }
}

explore();
