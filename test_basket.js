async function test() {
    // Sadece bugünün tarihi
    const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
    const url = `https://api.mackolikfeeds.com/basket/api/matches/?add_playing=1&application=com.domainname.mackolik&country=tr&date=${dateStr}&extended_period=1&language=tr&migration_status=perform&tz=3`;
    
    console.log(`⏳ ${dateStr} için maçlar çekiliyor...`);

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mackolik/5.8.7 (iPhone; iOS 27.0.1; Scale/3.00)",
            "X-Authorization": "token true",
            "X-RequestToken": "exp=1791196814~acl=/basket/api/matches/*~hmac=D08290EF6031AAA741AF61DA5B238E8E78DD32A632A6D9A5291BF9A48603C667",
            "Accept-Language": "tr-TR;q=1, en-GB;q=0.9"
        }
    });

    const json = await response.json();
    
    console.log("✅ VERİ GELDİ! İŞTE YAPISI:\n");
    // Verinin ilk 1500 karakterini formatlı şekilde ekrana basalım ki şemayı görelim
    console.log(JSON.stringify(json.data, null, 2).substring(0, 1500));
    console.log("\n======================================");
    console.log("🛑 Çıktının sonu. Lütfen yukarıdaki metni benimle paylaş.");
}

test();
