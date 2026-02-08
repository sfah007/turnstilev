const fs = require("fs");
const path = require("path");
const tar = require("tar");
const chromium = require("@sparticuz/chromium");

(async () => {
  try {
    console.log("[Build] Preparing Chromium pack...");

    const execPath = await chromium.executablePath();
    const chromiumDir = path.dirname(execPath);

    const publicDir = path.join(process.cwd(), "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir);
    }

    const tarPath = path.join(publicDir, "chromium-pack.tar");

    await tar.c(
      {
        file: tarPath,
        cwd: chromiumDir,
      },
      ["."]
    );

    console.log("[Build] Chromium packed → public/chromium-pack.tar");
  } catch (err) {
    console.error("[Build] Chromium pack failed:", err);
    process.exit(1);
  }
})();
