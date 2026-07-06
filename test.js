async function testSofascore() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    
    // Test edilecek olası yeni Sofascore API rotaları
    const endpoints = [
        `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${today}`,
        `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${today}`,
        `https://api.sofascore.app/api/v1/sport/football/scheduled-events/${today}`,
        `https://api.sofascore.com/mobile/v4/sport/football/scheduled-events/${today}`,
        `https://www.sofascore.com/api/v1/sport/football/events/schedule/${today}`,
        `https://api.sofascore.com/api/v1/sport/football/events/date/${today}`
    ];

    console.log("🔍 Olası Sofascore API Rotaları Taranıyor...\n");

    for (let url of endpoints) {
        console.log(`📡 Deneniyor: ${url}`);
        try {
            const response = await fetch(url, {
                headers: {
                    // Mobil yerine standart tarayıcı taklidi yapıyoruz
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Referer": "https://www.sofascore.com/",
                    "Origin": "https://www.sofascore.com"
                }
            });

            console.log(`➡️ Durum: ${response.status} ${response.statusText}`);

            if (response.ok) {
                console.log(`\n✅ BİNGO! Çalışan adres bulundu:\n${url}\n`);
                return; // Doğruyu bulduğumuzda döngüyü durduruyoruz
            }
        } catch (e) {
            console.log(`❌ Ağ hatası: ${e.message}`);
        }
        console.log("-----------------------------------");
        // IP ban yememek için araya ufak bir bekleme koyuyoruz
        await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log("🚨 Tüm denemeler başarısız oldu. API yapısı tamamen değişmiş olabilir.");
}

testSofascore();
