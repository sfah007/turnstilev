const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium-min");

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  timeout: parseInt(process.env.SOLVER_TIMEOUT || "60000", 10),
};

// ============================================================
// In‑Memory Cache
// ============================================================

let cachedExecutablePath = null;

async function getExecutablePath() {
  if (cachedExecutablePath) {
    console.log("[Chromium] Using cached executable path");
    return cachedExecutablePath;
  }

  console.log("[Chromium] Downloading & extracting pack...");

  const packUrl =
    process.env.CHROMIUM_PACK_URL ||
    "https://YOUR_DOMAIN/chromium-pack.tar";

  const execPath = await chromium.executablePath(packUrl);

  cachedExecutablePath = execPath;

  console.log("[Chromium] Ready →", execPath);

  return execPath;
}

// ============================================================
// Browser Launch
// ============================================================

async function launchBrowser() {
  const executablePath = await getExecutablePath();

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
    executablePath,
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
    ignoreHTTPSErrors: true,
  });

  return browser;
}

// ============================================================
// Fake Page
// ============================================================

function getFakePage(siteKey) {
  return `<!DOCTYPE html>
<html>
<body>
<div id="cf"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
turnstile.render('#cf', {
  sitekey: '${siteKey}',
  callback: function(token) {
    const i = document.createElement('input');
    i.name='cf-response';
    i.value=token;
    document.body.appendChild(i);
  }
});
</script>
</body>
</html>`;
}

// ============================================================
// Solver
// ============================================================

async function solve(url, sitekey) {
  let browser;
  const start = Date.now();

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setRequestInterception(true);

    page.on("request", (req) => {
      if (req.resourceType() === "document") {
        req.respond({
          status: 200,
          contentType: "text/html",
          body: getFakePage(sitekey),
        });
      } else req.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page.waitForSelector('[name="cf-response"]', {
      timeout: CONFIG.timeout,
    });

    const token = await page.$eval(
      '[name="cf-response"]',
      (el) => el.value
    );

    return {
      success: true,
      token,
      duration: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
    };
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================
// Handler
// ============================================================

module.exports = async (req, res) => {
  const { url, sitekey } = req.method === "POST" ? req.body : req.query;

  if (!url || !sitekey)
    return res.status(400).json({ error: "url & sitekey required" });

  const result = await solve(url, sitekey);

  res.json(result);
};
