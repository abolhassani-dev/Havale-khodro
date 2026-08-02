// Static server that also proxies /api to the backend, mimicking nginx.
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = '/home/user/Havale-khodro/frontend';
const TYPES = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = http.request({ host:'127.0.0.1', port:3000, path:req.url, method:req.method, headers:req.headers }, r => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    req.pipe(p); p.on('error', () => res.end()); return;
  }
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const full = path.join(ROOT, file);
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(5173, () => console.log('frontend on 5173'));
