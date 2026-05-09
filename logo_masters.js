const fs = require("fs");
const path = require("path");
const axios = require("axios");

const FIREBASE_BASE_URL =
  "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
  {
    name: "Futbol",
    file: "matches_football.json",
    dirs: {
      team: path.join(__dirname, "football", "logos"),
      tournament: path.join(__dirname, "football", "tournament_logos"),
    },
  },
  {
    name: "Basketbol",
    file: "matches_basketball.json",
    dirs: {
      team: path.join(__dirname, "basketball", "logos"),
      nba: path.join(__dirname, "basketball", "logos", "NBA"),
      tournament: path.join(
        __dirname,
        "basketball",
        "tournament_logos"
      ),
    },
  },
  {
    name: "Tenis",
    file: "matches_tennis.json",
    dirs: {
      team: path.join(__dirname, "tennis", "logos"),
      tournament: path.join(__dirname, "tennis", "tournament_logos"),
    },
  },
];

// klasörleri oluştur
for (const conf of configs) {
  Object.values(conf.dirs).forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFirebase(file) {
  try {
    const url = `${FIREBASE_BASE_URL}${file}`;
    const res = await axios.get(url, { timeout: 15000 });
    return res.data || null;
  } catch (e) {
    console.log(`❌ Firebase error: ${file}`);
    return null;
  }
}

function fileExists(dir, id) {
  return fs.existsSync(path.join(dir, `${id}.png`));
}

async function downloadImage(url, pathOut, name) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: "https://www.sofascore.com/",
          "Cache-Control": "no-cache",
        },
      });

      if (!res.data || res.data.byteLength < 800) {
        throw new Error("Invalid image");
      }

      fs.writeFileSync(pathOut, res.data);
      console.log(`   ✅ OK: ${name}`);
      return true;
    } catch (e) {
      const code = e.response?.status || "ERR";
      console.log(`   🚫 ${code} BLOCK (${i}/3): ${name}`);
      await sleep(1000 * i);
    }
  }

  console.log(`   ❌ FINAL FAIL: ${name}`);
  return false;
}

async function start() {
  console.log("🚀 V5 SYSTEM START (FIREBASE SAFE + REPO SAFE)\n");

  let totalMissing = 0;

  for (const conf of configs) {
    const data = await fetchFirebase(conf.file);

    if (!data) {
      console.log(`⚠️ ${conf.name} SKIPPED (no firebase data)`);
      continue;
    }

    const matches = data.matches || data.events || [];
    if (!Array.isArray(matches)) {
      console.log(`⚠️ ${conf.name} INVALID DATA`);
      continue;
    }

    const missing = [];

    for (const m of matches) {
      const tourName = m.tournament || "";
      const isNBA = tourName.toUpperCase().includes("NBA");

      // 🏆 Tournament logo
      if (m.tournamentLogo) {
        const id = m.tournamentLogo.split("/").pop().split(".")[0];

        const exists = fileExists(conf.dirs.tournament, id);
        if (!exists && id && id !== "default") {
          missing.push({
            id,
            name: tourName,
            type: "tournament",
          });
        }
      }

      // 👕 Team logos
      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {
        if (!t) continue;

        const logos = Array.isArray(t.logos)
          ? t.logos
          : [t.logo].filter(Boolean);

        for (const url of logos) {
          const id = url?.split("/").pop().split(".")[0];
          if (!id) continue;

          let dir =
            conf.name === "Basketbol" && isNBA
              ? conf.dirs.nba
              : conf.dirs.team;

          const exists = fileExists(dir, id);

          if (!exists) {
            missing.push({
              id,
              name: t.name,
              type: "team",
              dir,
            });
          }
        }
      }
    }

    console.log(`🔍 ${conf.name} Missing: ${missing.length}`);
    totalMissing += missing.length;

    for (const item of missing) {
      let url = "";

      if (item.type === "tournament") {
        url = `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`;
      } else {
        url = `https://api.sofascore.app/api/v1/team/${item.id}/image`;
      }

      const outPath = path.join(item.dir, `${item.id}.png`);

      console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

      await downloadImage(url, outPath, item.name);
      await sleep(800);
    }

    console.log(`✅ ${conf.name} DONE\n`);
  }

  console.log(`🏁 TOTAL MISSING: ${totalMissing}`);
}

start();