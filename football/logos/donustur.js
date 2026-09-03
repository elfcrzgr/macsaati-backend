const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const folderPath = path.join(__dirname);

async function convertWebpToPng() {
    const files = fs.readdirSync(folderPath);
    let count = 0;

    for (const file of files) {
        if (path.extname(file).toLowerCase() === '.webp') {
            const webpPath = path.join(folderPath, file);
            const pngFileName = path.basename(file, '.webp') + '.png';
            const pngPath = path.join(folderPath, pngFileName);

            try {
                await sharp(webpPath).png().toFile(pngPath);
                fs.unlinkSync(webpPath);
                count++;
                console.log(`✅ Dönüştürüldü: ${file} -> ${pngFileName}`);
            } catch (error) {
                console.error(`❌ Hata (${file}):`, error.message);
            }
        }
    }
    console.log(`\n🎉 İşlem tamam! Toplam ${count} dosya PNG formatına çevrildi.`);
}

convertWebpToPng();
