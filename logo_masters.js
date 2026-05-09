const fs = require("fs");
const path = require("path");
const axios = require("axios");

const FIREBASE_BASE_URL =
  "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
  {
    name: "Basketbol",
    firebasePath: "basketball/matches.json",
    dirs: {
      team: path.join(__dirname, "basketball", "logos"),
      nba: path.join(__dirname, "basketball", "logos", "NBA"),
      tournament: path.join(__dirname, "basketball", "tournament_logos")
    }
  }
];

// klasör oluştur
configs.forEach(conf => {
  Object.values(conf.dirs).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
});

async function fetchFirebase(pathUrl) {
  const url = `${FIREBASE_BASE_URL}${pathUrl}`;
  const res = await axios.get(url);
  return res.data;
}

// ❗ Local dosya bozuk mu kontrol
function isValidLocalImage(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const buffer = fs.readFileSync(filePath);

    // PNG header check
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer.length > 1000
    );
  } catch {
    return false;
  }
}

// ❗ Remote image güvenli indir
async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Referer: "https://www.sofascore.com/"
    }
  });

  const buffer = Buffer.from(res.data);
  const text = buffer.toString("utf8");

  // ❌ JSON error yakala (403 vs)
  if (
    text.includes('"error"') ||
    text.includes("Forbidden") ||
    res.status === 403
  ) {
    throw new Error("403_BLOCK");
  }

  // ❌ HTML block
  if (text.includes("<html")) {
    throw new Error("HTML_BLOCK");
  }

  // ❌ çok küçük response
  if (buffer.length < 1500) {
    throw new Error("TOO_SMALL");
  }

  return buffer;
}

async function start() {
  console.log("🚀 V4.1 FIREBASE LOGO SYSTEM START");

  for (const conf of configs) {
    const data = await fetchFirebase(conf.firebasePath);

    const matches = data.matches || [];
    const missing = [];

    matches.forEach(m => {
      const teams = [m.homeTeam, m.awayTeam];

      teams.forEach(team => {
        if (!team || !team.logo) return;

        const id = team.logo.split("/").pop().split(".")[0];

        const dir =
          conf.name === "Basketbol" &&
          (m.tournament || "").includes("NBA")
            ? conf.dirs.nba
            : conf.dirs.team;

        const targetPath = path.join(dir, `${id}.png`);

        if (!isValidLocalImage(targetPath)) {
          missing.push({
            id,
            name: team.name,
            url: team.logo,
            path: targetPath
          });
        }
      });
    });

    console.log(`🔍 Missing: ${missing.length}`);

    for (const item of missing) {
      console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

      try {
        const buffer = await downloadImage(item.url);

        fs.writeFileSync(item.path, buffer);

        console.log(`   ✅ OK: ${item.name}`);
      } catch (err) {
        console.log(`   ❌ FAIL: ${item.name} | ${err.message}`);

        // fallback: boş dosya yazma YOK (bilerek)
      }

      await new Promise(r => setTimeout(r, 800));
    }

    console.log("✅ DONE");
  }
}

start();