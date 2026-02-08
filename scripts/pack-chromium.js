// scripts/download-chromium.js
const fs = require("fs");
const path = require("path");
const tar = require("tar");
const https = require("https");

// ⚠️ استبدل هذا بـرابط Release الخاص بك
const CHROMIUM_URL = "https://github.com/sfah007/turnstilev/releases/download/chromium-pack.tar/chromium-pack.tar";

// المسارات
const publicDir = path.join(process.cwd(), "public");
const tarPath = path.join(publicDir, "chromium-pack.tar");

// دالة التحميل مع معالجة إعادة التوجيه
function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    
    const download = (url) => {
      https.get(url, (response) => {
        // معالجة إعادة التوجيه من GitHub
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          return download(response.headers.location);
        }
        
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destination);
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percentage = ((downloadedSize / totalSize) * 100).toFixed(1);
          process.stdout.write(`\r[Download] Progress: ${percentage}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log("\n✅ Download complete!");
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(destination);
        reject(err);
      });
    };
    
    download(url);
  });
}

// دالة استخراج الملف
async function extractTar(tarFile, destination) {
  console.log("[Extract] Extracting chromium-pack.tar...");
  
  await tar.x({
    file: tarFile,
    cwd: destination,
  });
  
  console.log("✅ Extraction complete!");
}

// الدالة الرئيسية
(async () => {
  try {
    console.log("[Setup] Starting Chromium setup...");
    
    // التحقق من وجود المجلد public
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // التحقق من وجود الملف
    if (fs.existsSync(tarPath)) {
      console.log("✅ chromium-pack.tar already exists in public/");
      
      // اختياري: التحقق من صحة الملف
      const stats = fs.statSync(tarPath);
      console.log(`📦 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      return;
    }
    
    // تحميل الملف من GitHub Releases
    console.log(`[Download] Downloading from GitHub Release...`);
    console.log(`📍 URL: ${CHROMIUM_URL}`);
    
    await downloadFile(CHROMIUM_URL, tarPath);
    
    // التحقق من الملف المُحمّل
    if (fs.existsSync(tarPath)) {
      const stats = fs.statSync(tarPath);
      console.log(`✅ Chromium pack saved → public/chromium-pack.tar`);
      console.log(`📦 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
      throw new Error("Failed to save chromium-pack.tar");
    }
    
  } catch (err) {
    console.error("❌ [Error] Chromium download failed:", err);
    
    // حذف الملف التالف إن وجد
    if (fs.existsSync(tarPath)) {
      fs.unlinkSync(tarPath);
    }
    
    process.exit(1);
  }
})();
