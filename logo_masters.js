const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FIREBASE_BASE_URL =
  'https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/';

const configs = [
  {
    name: 'Futbol',
    firebaseFile: 'matches_football',
    dirs: {
      team: path.join(__dirname, 'football', 'logos'),
      tournament: path.join(__dirname, 'football', 'tournament_logos')
    }
  },
  {
    name: 'Basketbol',
    firebaseFile: 'matches_basketball',
    dirs: {
      team: path.join(__dirname, 'basketball', 'logos'),
      nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
      tournament: path.join(__dirname, 'basketball', 'tournament_logos')
    }
  },
  {
    name: 'Tenis',
    firebaseFile: 'matches_tennis',
    dirs: {
      team: path.join(__dirname, 'tennis', 'logos'),
      tournament: path.join(__dirname, 'tennis', 'tournament_logos')
    }
  }
];

// =========================
// INIT FOLDERS
// =========================
configs.forEach(conf => {
  Object.values(conf.dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================
// SAFE DOWNLOAD (NO SOFASCORE)
// =========================
async function downloadImage(url, filePath, name) {
  try {
    if (!url) throw new Error('Empty URL');

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*'
      }
    });

    if (!res.data || res.data.byteLength < 500) {
      throw new Error('Invalid image');
    }

    fs.writeFileSync(filePath, res.data);

    console.log(`   ✅ ${name}`);
    return true;

  } catch (err) {
    console.log(
      `   ❌ ${name} -> ${err.response?.status || err.message}`
    );
    return false;
  }
}

// =========================
// MAIN
// =========================
async function start() {

  console.log('🚀 Logo Sync Başladı (Firebase + GitHub Cache)\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`📦 ${conf.name} yükleniyor...`);

    let firebaseData;

    try {
      const res = await axios.get(
        `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`,
        { timeout: 30000 }
      );

      firebaseData = res.data;

    } catch (e) {
      console.log(`❌ Firebase hata: ${conf.name}`);
      continue;
    }

    const matches =
      firebaseData?.matches ||
      firebaseData?.events ||
      [];

    console.log(`📄 ${matches.length} maç`);

    for (const m of matches) {

      const isNBA =
        (m.tournament || '').toUpperCase().includes('NBA');

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {

        if (!t?.logo || !t?.name) continue;

        const url = t.logo;

        const fileName =
          path.basename(new URL(url).pathname);

        let dir = conf.dirs.team;

        if (conf.name === 'Basketbol' && isNBA) {
          dir = conf.dirs.nba;
        }

        const targetPath = path.join(dir, fileName);

        if (fs.existsSync(targetPath)) continue;

        const success = await downloadImage(
          url,
          targetPath,
          t.name
        );

        if (success) ok++;
        else fail++;

        await sleep(300);
      }

      // tournament logo
      if (m.tournamentLogo) {

        const url = m.tournamentLogo;

        const fileName =
          path.basename(new URL(url).pathname);

        const targetPath =
          path.join(conf.dirs.tournament, fileName);

        if (!fs.existsSync(targetPath)) {

          const success = await downloadImage(
            url,
            targetPath,
            m.tournament
          );

          if (success) ok++;
          else fail++;
        }
      }
    }

    console.log(`✅ ${conf.name} tamam\n`);
  }

  console.log('\n📊 SONUÇ');
  console.log(`✅ Başarılı: ${ok}`);
  console.log(`❌ Hatalı: ${fail}`);
}

start();