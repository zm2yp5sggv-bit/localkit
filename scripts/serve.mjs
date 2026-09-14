#!/usr/bin/env node
/**
 * 零依赖静态文件服务器，供本地预览与 Playwright 端到端测试使用。
 *
 *   node scripts/serve.mjs           监听 4173
 *   node scripts/serve.mjs 8080      指定端口
 *
 * 站点本身完全静态、不需要构建。这个脚本除了伺服文件，还会读取根目录的 _headers
 * 并逐条下发同样的响应头——包括 Content-Security-Policy。
 * 这样本地与 CI 的测试就运行在与 Cloudflare Pages 一致的 CSP 之下，
 * 避免出现「上线才发现 CSP 把页面拦坏」的情况。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 4173;

/**
 * 解析 Cloudflare Pages 的 _headers 文件。
 * 格式：一行路径规则，缩进的 `Name: value` 属于该规则。
 * 返回 [{ pattern, headers: { name: value } }]，按文件顺序排列。
 */
function parseHeadersFile(file) {
  if (!fs.existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const i = raw.indexOf(':');
    if (i === -1) continue;
    current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return rules;
}

const HEADER_RULES = parseHeadersFile(path.join(ROOT, '_headers'));

/** 把 Cloudflare 的匹配语法简化成 glob：支持 `/*`（前缀）与完全相等。 */
function headersFor(urlPath) {
  const out = {};
  for (const rule of HEADER_RULES) {
    if (rule.pattern === '/*') { Object.assign(out, rule.headers); continue; }
    if (rule.pattern.endsWith('/*')) {
      if (urlPath.startsWith(rule.pattern.slice(0, -1))) Object.assign(out, rule.headers);
      continue;
    }
    if (urlPath === rule.pattern) Object.assign(out, rule.headers);
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad Request'); return; }

  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, urlPath);

  // 目录穿越防护
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...headersFor(urlPath) });
      res.end('<h1>404</h1><p>' + urlPath + '</p>');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      ...headersFor(urlPath),
    };
    if (!headers['Cache-Control']) headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LocalKit 已启动：http://127.0.0.1:${PORT}`);
  console.log(`已应用 ${HEADER_RULES.length} 条 _headers 规则`);
});
