const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium-min");

const CONFIG = {
  timeout: parseInt(process.env.SOLVER_TIMEOUT || "60000", 10),
  chromiumPackUrl: process.env.CHROMIUM_PACK_URL || 
    "https://github.com/sfah007/turnstilev/releases/download/v1.0/chromium-pack.tar"
};

let cachedExecutablePath = null;

async function getExecutablePath() {
  if (cachedExecutablePath) {
    console.log("[Chromium] Using cached executable path");
    return cachedExecutablePath;
  }

  console.log("[Chromium] Downloading from:", CONFIG.chromiumPackUrl);
  
  try {
    const execPath = await chromium.executablePath(CONFIG.chromiumPackUrl);
    cachedExecutablePath = execPath;
    console.log("[Chromium] Ready →", execPath);
    return execPath;
  } catch (error) {
    console.error("[Chromium] Failed:", error);
    throw error;
  }
}

async function launchBrowser() {
  try {
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
  } catch (error) {
    console.error("[Browser] Launch failed:", error);
    throw error;
  }
}

function getFakePage(siteKey) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Turnstile Solver</title>
</head>
<body>
<div id="cf"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
turnstile.render('#cf', {
  sitekey: '${siteKey}',
  callback: function(token) {
    const i = document.createElement('input');
    i.name = 'cf-response';
    i.value = token;
    document.body.appendChild(i);
  }
});
</script>
</body>
</html>`;
}

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
      } else {
        req.continue();
      }
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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, sitekey } = req.method === "POST" ? req.body : req.query;

  if (!url || !sitekey) {
    return res.status(400).json({ 
      success: false,
      error: "Both 'url' and 'sitekey' parameters are required" 
    });
  }

  console.log(`[API] Solving Turnstile for ${url}`);
  
  const result = await solve(url, sitekey);

  res.status(result.success ? 200 : 500).json(result);
}
