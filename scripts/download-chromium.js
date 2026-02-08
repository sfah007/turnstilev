const fs = require("fs");
const path = require("path");

// رابط GitHub Release
const CHROMIUM_URL = "https://github.com/sfah007/turnstilev/releases/download/v1.0/chromium-pack.tar";

// فقط تأكد من أن الكود سيستخدم هذا الرابط
console.log("[Setup] Chromium will be downloaded from GitHub Release");
console.log("[Setup] URL:", CHROMIUM_URL);

// لا نحتاج لتحميل أي شيء هنا
// @sparticuz/chromium-min سيتولى التحميل عند الحاجة
