import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
    try {
        let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
        let info = await stat(path);
        if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
        const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
        let start = 0, end = info.size - 1, status = 200;
        if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            if (!match) { res.writeHead(416).end(); return; }
            start = Number(match[1]); end = Math.min(end, match[2] ? Number(match[2]) : end); status = 206;
            if (start > end || start >= info.size) { res.writeHead(416).end(); return; }
            headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') res.end();
        else createReadStream(path, { start, end }).pipe(res);
    } catch { res.writeHead(404).end(); }
}).listen(8765, '127.0.0.1');
