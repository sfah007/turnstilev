const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium-min");

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  timeout: parseInt(process.env.SOLVER_TIMEOUT || "60000", 10),
  // ⚠️ استبدل هذا برابط GitHub Release الخاص بك
  chromiumPackUrl: process.env.CHROMIUM_PACK_URL || 
    "https://github.com/sfah007/turnstilev/releases/download/chromium-pack.tar/chromium-pack.tar"
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
  console.log("[Chromium] Source:", CONFIG.chromiumPackUrl);

  try {
    // استخدام الرابط من GitHub Releases
    const execPath = await chromium.executablePath(CONFIG.chromiumPackUrl);

    cachedExecutablePath = execPath;

    console.log("[Chromium] Ready →", execPath);

    return execPath;
  } catch (error) {
    console.error("[Chromium] Failed to get executable:", error);
    throw new Error("Failed to initialize Chromium: " + error.message);
  }
}

// ============================================================
// Browser Launch
// ============================================================

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
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process"
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

// ============================================================
// Fake Page
// ============================================================

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
window.onloadTurnstileCallback = function () {
  turnstile.render('#cf', {
    sitekey: '${siteKey}',
    callback: function(token) {
      const i = document.createElement('input');
      i.name = 'cf-response';
      i.value = token;
      document.body.appendChild(i);
      console.log('Token received:', token.substring(0, 20) + '...');
    },
    'error-callback': function() {
      const err = document.createElement('div');
      err.id = 'cf-error';
      err.textContent = 'Error loading Turnstile';
      document.body.appendChild(err);
    }
  });
};
</script>
</body>
</html>`;
}

// ============================================================
// Solver with Retry Logic
// ============================================================

async function solve(url, sitekey, retries = 3) {
  let browser;
  const start = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Solver] Attempt ${attempt}/${retries} for ${url}`);
      
      browser = await launchBrowser();
      const page = await browser.newPage();

      // إعداد الصفحة
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

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

      // معالجة أخطاء الصفحة
      page.on("pageerror", (error) => {
        console.error("[Page Error]:", error.message);
      });

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error("[Console Error]:", msg.text());
        }
      });

      await page.goto(url, { 
        waitUntil: "networkidle2",
        timeout: 30000 
      });

      // انتظار الحل مع timeout محسّن
      const token = await Promise.race([
        page.waitForSelector('[name="cf-response"]', {
          timeout: CONFIG.timeout,
        }).then(() => page.$eval('[name="cf-response"]', (el) => el.value)),
        
        page.waitForSelector('#cf-error', {
          timeout: CONFIG.timeout,
        }).then(() => {
          throw new Error("Turnstile failed to load");
        })
      ]);

      if (!token) {
        throw new Error("No token received");
      }

      return {
        success: true,
        token,
        duration: Date.now() - start,
        attempts: attempt
      };

    } catch (error) {
      lastError = error;
      console.error(`[Solver] Attempt ${attempt} failed:`, error.message);
      
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
      
      if (attempt < retries) {
        // انتظار قبل المحاولة التالية
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || "Unknown error",
    duration: Date.now() - start,
    attempts: retries
  };
}

// ============================================================
// Handler
// ============================================================

module.exports = async (req, res) => {
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

  // التحقق من صحة الـ URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ 
      success: false,
      error: "Invalid URL format" 
    });
  }

  console.log(`[API] Solving Turnstile for ${url}`);
  
  const result = await solve(url, sitekey);

  if (result.success) {
    console.log(`[API] ✅ Solved in ${result.duration}ms`);
  } else {
    console.log(`[API] ❌ Failed: ${result.error}`);
  }

  res.status(result.success ? 200 : 500).json(result);
};
