const fs = require('fs');
const path = require('path');

// Ekran görüntülerindeki takımları listeye ekledim
const teams = [
    "Knowle FC", "Worcester City", "Curzon Ashton FC", "Bradford Park Avenue",
    "Burgess Hill Town", "Jersey Bulls FC", "North Ferriby FC", "Barton Town",
    "AFC Portchester", "Portland United", "Alfreton Town", "Stratford Town",
    "Alvechurch FC", "AFC Wolverhampton City", "Avro FC", "Witton Albion"
];

const FOLDER_NAME = 'logoss'; // Klasör adı logoss olarak güncellendi

// Logoların kaydedileceği klasörü oluştur
if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
}

const downloadLogos = async () => {
    for (const teamName of teams) {
        try {
            // 1. Takım adıyla Sofascore'da arama yapıp ID'sini bul
            const searchUrl = `https://api.sofascore.app/api/v1/search/all?q=${encodeURIComponent(teamName)}`;
            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();

            // Sonuçlardan "team" tipinde olan ilk kaydı al
            const team = searchData.results?.find(r => r.type === 'team')?.entity;

            if (!team) {
                console.log(`❌ Bulunamadı: ${teamName}`);
                continue; // Bulunamazsa sonraki takıma geç
            }

            const teamId = team.id;
            
            // 2. Bulunan ID ile logoyu indir
            const imageUrl = `https://api.sofascore.app/api/v1/team/${teamId}/image`;
            const imageResponse = await fetch(imageUrl);

            if (imageResponse.ok) {
                const arrayBuffer = await imageResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                // 3. Dosyayı id.png olarak kaydet
                const filePath = path.join(__dirname, FOLDER_NAME, `${teamId}.png`);
                fs.writeFileSync(filePath, buffer);
                
                console.log(`✅ İndirildi: ${teamName} -> ${teamId}.png`);
            } else {
                console.log(`⚠️ Logo mevcut değil: ${teamName} (ID: ${teamId})`);
            }

            // API'den ban yememek için istekler arasına 500ms bekleme süresi koyuyoruz
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`Hata (${teamName}):`, error.message);
        }
    }
    console.log("🎉 Tüm işlemler tamamlandı! Logolar 'logoss' klasöründe.");
};

downloadLogos();
