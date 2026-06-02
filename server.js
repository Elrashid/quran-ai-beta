/*
 * خادم تطوير بسيط بلا تبعيات لتقديم النموذج الأولي محلياً.
 * التشغيل:  node server.js   ثم افتح http://localhost:8080
 *
 * ملاحظة: واجهة Web Speech API والميكروفون تتطلّبان «سياقاً آمناً»
 * (https أو localhost)، لذا يُفضَّل التشغيل عبر هذا الخادم لا بفتح الملف مباشرةً.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer(function (req, res) {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    // منع الخروج خارج مجلد المشروع.
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("403 Forbidden");
      return;
    }

    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
      const type = MIME[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  })
  .listen(PORT, function () {
    console.log("النموذج الأولي يعمل على: http://localhost:" + PORT);
  });
