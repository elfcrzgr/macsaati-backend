const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "matches.json");

// Ana endpoint
app.get("/matches", (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    return res.status(503).json({
      success: false,
      message: "Veri henüz hazır değil"
    });
  }

  try {
    const fileContent = JSON.parse(fs.readFileSync(DATA_FILE));

    res.json({
      success: true,
      data: fileContent.data || fileContent
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "JSON okunamadı"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portta çalışıyor`);
});