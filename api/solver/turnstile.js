/**
 * Turnstile Solver API - Vercel Serverless Function
 * 
 * Single-file API that solves Cloudflare Turnstile CAPTCHA challenges.
 * 
 * Supports both GET and POST:
 *   GET:  /api/solver/turnstile?url=...&sitekey=...
 *   POST: /api/solver/turnstile  (JSON body)
 * 
 * Deploy: Vercel (Node.js 18.x runtime)
 * 
 * Required packages:
 *   @sparticuz/chromium ^131.0.1
 *   puppeteer-core      ^23.11.1
 * 
 * Environment Variables (optional):
 *   PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD
 *   SOLVER_TIMEOUT (default: 60000)
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
    timeout: parseInt(process.env.SOLVER_TIMEOUT || '60000', 10),
    proxy: process.env.PROXY_HOST ? {
        host: process.env.PROXY_HOST,
        port: parseInt(process.env.PROXY_PORT || '0', 10),
        username: process.env.PROXY_USERNAME || null,
        password: process.env.PROXY_PASSWORD || null,
    } : null,
};

// ============================================================
// Fake Page Template
// ============================================================
function getFakePage(siteKey) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
</head>
<body>
    <div class="turnstile"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback" defer></script>
    <script>
        window.onloadTurnstileCallback = function () {
            turnstile.render('.turnstile', {
                sitekey: '${siteKey}',
                callback: function (token) {
                    var c = document.createElement('input');
                    c.type = 'hidden';
                    c.name = 'cf-response';
                    c.value = token;
                    document.body.appendChild(c);
                },
            });
        };
    </script>
</body>
</html>`;
}

// ============================================================
// Browser Launch (Serverless-compatible)
// ============================================================



async function launchBrowser(proxy) {

    // Get chromium path (Serverless)
    const executablePath = await chromium.executablePath();

    const args = [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote"
    ];

    if (proxy && proxy.host && proxy.port) {
        args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
        args,
        executablePath,
        headless: chromium.headless,
        defaultViewport: chromium.defaultViewport,
        ignoreHTTPSErrors: true
    });

    return browser;
}


// ============================================================
// Solve Turnstile Min - Fake page injection
// ============================================================
async function solveTurnstileMin(url, siteKey, proxy, timeout) {
    const startTime = Date.now();
    let browser = null;

    try {
        console.log(`[Solver] Starting solve for: ${url}`);
        browser = await launchBrowser(proxy);
        console.log('[Solver] Browser launched successfully');

        const page = await browser.newPage();

        // Proxy auth
        if (proxy && proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password,
            });
        }

        // Set a realistic user agent
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        );

        // Enable request interception
        await page.setRequestInterception(true);

        // Intercept & serve fake page
        page.on('request', async (request) => {
            try {
                const reqUrl = request.url();
                if ([url, url + '/'].includes(reqUrl) && request.resourceType() === 'document') {
                    await request.respond({
                        status: 200,
                        contentType: 'text/html',
                        body: getFakePage(siteKey),
                    });
                } else {
                    await request.continue();
                }
            } catch (e) {
                try { await request.continue(); } catch (_) {}
            }
        });

        // Navigate
        console.log('[Solver] Navigating to URL...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('[Solver] Page loaded, waiting for Turnstile token...');

        // Wait for token
        await page.waitForSelector('[name="cf-response"]', { timeout });

        // Extract token
        const token = await page.evaluate(() => {
            try {
                const el = document.querySelector('[name="cf-response"]');
                return el ? el.value : null;
            } catch (e) {
                return null;
            }
        });

        if (!token || token.length < 10) {
            throw new Error('Failed to get token');
        }

        console.log(`[Solver] Token obtained successfully (${token.length} chars) in ${Date.now() - startTime}ms`);

        return {
            success: true,
            data: token,
            duration: Date.now() - startTime,
        };
    } catch (error) {
        console.error('[Solver] Error:', error.message);
        return {
            success: false,
            error: error.message || 'Unknown error',
            duration: Date.now() - startTime,
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
            console.log('[Solver] Browser closed');
        }
    }
}

// ============================================================
// Validation Helpers
// ============================================================
function isValidUrl(str) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

function getRequestParams(req) {
    const method = req.method;

    if (method === 'GET') {
        return {
            url: req.query?.url || null,
            sitekey: req.query?.sitekey || null,
        };
    }

    if (method === 'POST') {
        const body = req.body || {};
        return {
            url: body.url || null,
            sitekey: body.sitekey || null,
        };
    }

    return { url: null, sitekey: null };
}

// ============================================================
// Main Handler (Vercel Serverless Function)
// ============================================================
module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Preflight
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Only GET and POST
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({
            status: false,
            error: 'Method not allowed. Use GET or POST.',
            code: 405,
        });
    }

    // Extract params
    const { url, sitekey } = getRequestParams(req);

    // ── Validation ──────────────────────────────────

    if (!url) {
        return res.status(400).json({
            status: false,
            error: 'URL parameter is required',
            code: 400,
        });
    }

    if (!sitekey) {
        return res.status(400).json({
            status: false,
            error: 'Sitekey parameter is required',
            code: 400,
        });
    }

    if (typeof url !== 'string' || url.trim().length === 0) {
        return res.status(400).json({
            status: false,
            error: 'URL parameter must be a non-empty string',
            code: 400,
        });
    }

    if (typeof sitekey !== 'string' || sitekey.trim().length === 0) {
        return res.status(400).json({
            status: false,
            error: 'Sitekey parameter must be a non-empty string',
            code: 400,
        });
    }

    const trimmedUrl = url.trim();
    const trimmedSitekey = sitekey.trim();

    if (trimmedUrl.length > 1000) {
        return res.status(400).json({
            status: false,
            error: 'URL parameter must not exceed 1000 characters',
            code: 400,
        });
    }

    if (trimmedSitekey.length > 100) {
        return res.status(400).json({
            status: false,
            error: 'Sitekey parameter must not exceed 100 characters',
            code: 400,
        });
    }

    if (!isValidUrl(trimmedUrl)) {
        return res.status(400).json({
            status: false,
            error: 'Invalid URL format',
            code: 400,
        });
    }

    // ── Solve Turnstile ─────────────────────────────

    try {
        const result = await solveTurnstileMin(
            trimmedUrl,
            trimmedSitekey,
            CONFIG.proxy,
            CONFIG.timeout
        );

        if (!result.success || !result.data) {
            return res.status(500).json({
                status: false,
                error: result.error || 'Failed to solve Turnstile challenge',
                code: 500,
            });
        }

        return res.status(200).json({
            status: true,
            data: {
                url: trimmedUrl,
                sitekey: trimmedSitekey,
                token: result.data,
                solvedAt: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            error: error.message || 'Failed to solve Turnstile challenge',
            code: 500,
        });
    }
};
