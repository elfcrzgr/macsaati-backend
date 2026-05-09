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
// FOLDERS
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
// SOFA SCORE FALLBACK SCRAPER
// =========================
async function fetchSofaLogo(teamId) {
  try {

    const url =
      `https://www.sofascore.com/team/${teamId}`;

    const html = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 15000
    }).then(r => r.data);

    // logo url yakala
    const match = html.match(
      /https:\/\/img\.sofascore\.com\/api\/v1\/team\/\d+\/image/g
    );

    if (match && match.length > 0) {
      return match[0];
    }

    return null;

  } catch (e) {
    return null;
  }
}

// =========================
// DOWNLOAD
// =========================
async function downloadImage(url, filePath, name) {
  try {

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
      throw new Error('invalid image');
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

  console.log('🚀 Logo Masters Başladı...\n');

  let ok = 0;
  let fail = 0;

  for (const conf of configs) {

    console.log(`📦 ${conf.name} Firebase...`);

    let data;

    try {
      const res = await axios.get(
        `${FIREBASE_BASE_URL}${conf.firebaseFile}.json`
      );

      data = res.data;

    } catch (e) {
      console.log('❌ Firebase error');
      continue;
    }

    const matches =
      data?.matches || data?.events || [];

    console.log(`📄 ${matches.length} maç`);

    for (const m of matches) {

      const isNBA =
        (m.tournament || '').toUpperCase().includes('NBA');

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {

        if (!t?.id || !t?.name) continue;

        const filePath =
          path.join(
            conf.name === 'Basketbol' && isNBA
              ? conf.dirs.nba
              : conf.dirs.team,
            `${t.id}.png`
          );

        if (fs.existsSync(filePath)) continue;

        // =========================
        // 1. Önce Firebase URL (varsa)
        // =========================
        let logoUrl = t.logo || null;

        // =========================
        // 2. Yoksa SofaScore fallback
        // =========================
        if (!logoUrl) {
          console.log(`🔄 fallback: ${t.name}`);
          logoUrl = await fetchSofaLogo(t.id);
        }

        if (!logoUrl) {
          console.log(`❌ logo yok: ${t.name}`);
          fail++;
          continue;
        }

        const success = await downloadImage(
          logoUrl,
          filePath,
          t.name
        );

        if (success) ok++;
        else fail++;

        await sleep(300);
      }

      // =========================
      // tournament logo
      // =========================
      if (m.tournamentLogo) {

        const filePath =
          path.join(
            conf.dirs.tournament,
            path.basename(m.tournamentLogo)
          );

        if (!fs.existsSync(filePath)) {

          const success = await downloadImage(
            m.tournamentLogo,
            filePath,
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
  console.log(`❌ Hata: ${fail}`);
}

start();