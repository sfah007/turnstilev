const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  timeout: parseInt(process.env.SOLVER_TIMEOUT || "60000", 10),
};

// ============================================================
// Browser Launch - محدث لـ Vercel
// ============================================================

async function launchBrowser() {
  try {
    console.log("[Browser] Launching Chromium...");
    
    // إعداد Chromium لـ Vercel
    chromium.setHeadlessMode = true;
    chromium.setGraphicsMode = false;
    
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    console.log("[Browser] Chromium launched successfully");
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
turnstile.render('#cf', {
  sitekey: '${siteKey}',
  callback: function(token) {
    const i = document.createElement('input');
    i.name = 'cf-response';
    i.value = token;
    document.body.appendChild(i);
  },
  'error-callback': function() {
    const err = document.createElement('div');
    err.id = 'cf-error';
    err.textContent = 'Error';
    document.body.appendChild(err);
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

    // إعداد User-Agent
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

    // معالجة الأخطاء
    page.on("pageerror", (error) => {
      console.error("[Page Error]:", error.message);
    });

    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 30000 
    });

    // انتظار الحل
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
    
  } catch (error) {
    console.error("[Solver] Error:", error.message);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - start,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
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

  console.log(`[API] Solving Turnstile for ${url}`);
  
  const result = await solve(url, sitekey);

  if (result.success) {
    console.log(`[API] ✅ Solved in ${result.duration}ms`);
  } else {
    console.log(`[API] ❌ Failed: ${result.error}`);
  }

  res.status(result.success ? 200 : 500).json(result);
};
