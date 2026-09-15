#!/usr/bin/env node
/**
 * 零依赖静态文件服务器，供本地预览与 Playwright 端到端测试使用。
 *
 *   node scripts/serve.mjs           监听 4173
 *   node scripts/serve.mjs 8080      指定端口
 *
 * 站点本身完全静态、不需要构建。这个脚本的关键职责是**忠实复现 Cloudflare Pages 的部署语义**：
 *   - 读取 _headers 并按官方规则下发（同名响应头用逗号合并，支持 "! Name" 取消）
 *   - 读取 _redirects，匹配时先行返回重定向（包括屏蔽开发产物的那批规则）
 *
 * 解析与匹配逻辑放在 scripts/lib/deploy-config.mjs，与 scripts/check-deploy.mjs 共用一份实现。
 * 此前这里自己写了一套「后覆盖前」的合并逻辑，与 Cloudflare 官方的「逗号合并」不一致，
 * 结果线上一个真实缺陷在本地怎么测都测不出来——这个教训直接决定了现在的结构。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeployConfig, resolveHeaders, resolveRedirect } from './lib/deploy-config.mjs';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 4173;

const { headers: headerRules, redirects: redirectRules } = readDeployConfig(ROOT);

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
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.wasm': 'application/wasm',
};

function sendFile(res, filePath, urlPath) {
  const deployHeaders = resolveHeaders(headerRules, urlPath);
  // _headers 未声明缓存策略时，本地开发服务器兜底为 no-store，避免改完文件刷新看不到效果。
  // 线上此时走 Cloudflare 的默认策略，属已知的本地/线上差异。
  if (!Object.keys(deployHeaders).some(k => k.toLowerCase() === 'cache-control')) {
    deployHeaders['Cache-Control'] = 'no-store';
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...deployHeaders });
      res.end('<h1>404</h1><p>' + urlPath + '</p>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      ...deployHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad Request'); return; }

  // 兼容带尾斜杠的请求（线上由 Cloudflare 的尾斜杠规则处理）
  const lookup = urlPath.length > 1 && urlPath.endsWith('/') ? [urlPath, urlPath.slice(0, -1)] : [urlPath];

  const rule = lookup.map(p => resolveRedirect(redirectRules, p)).find(Boolean);
  if (rule) {
    const deployHeaders = resolveHeaders(headerRules, urlPath);
    if (rule.code === 200) {
      sendFile(res, path.join(ROOT, rule.destination), urlPath);
      return;
    }
    res.writeHead(rule.code, { Location: rule.destination, ...deployHeaders });
    res.end();
    return;
  }

  /* Cloudflare Pages 的 URL 行为——本项目选择顺着它走，而不是对抗它。
   * 本地必须复现，否则「本地通过、线上不一致」会反复发生：
   *   1. /foo.html  → 308 永久重定向到 /foo（硬编码，无法配置关闭）
   *   2. /index.html → 308 到 /
   *   3. /foo      → 解析到 foo.html 并以 200 返回（这才是「最终地址」）
   * 正因为第 1 条关不掉，各页面的 canonical 与 sitemap 才写成无扩展名形式。 */

  // 规则 1 & 2：.html 请求重定向到无扩展名形式
  if (urlPath.endsWith('.html')) {
    const stripped = urlPath.slice(0, -'.html'.length);
    const target = stripped === '/index' ? '/' : stripped;
    if (target !== urlPath) {
      res.writeHead(308, { Location: target, ...resolveHeaders(headerRules, urlPath) });
      res.end();
      return;
    }
  }

  // 规则 3：无扩展名的请求解析到同名 .html 文件
  let filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
  if (!fs.existsSync(filePath) && !path.extname(urlPath)) {
    const candidate = filePath + '.html';
    if (fs.existsSync(candidate)) filePath = candidate;
  }

  // 目录穿越防护
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  // 未找到时返回 404.html 的内容（与关闭 SPA fallback 后的 Pages 行为一致）
  if (!fs.existsSync(filePath)) {
    const custom = path.join(ROOT, '404.html');
    if (fs.existsSync(custom)) {
      const deployHeaders = resolveHeaders(headerRules, urlPath);
      res.writeHead(404, { 'Content-Type': MIME['.html'], ...deployHeaders });
      fs.createReadStream(custom).pipe(res);
      return;
    }
  }

  sendFile(res, filePath, urlPath);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LocalKit 已启动：http://127.0.0.1:${PORT}`);
  console.log(`已加载 ${headerRules.length} 条 _headers 规则、${redirectRules.filter(r => !r.invalid).length} 条 _redirects 规则`);
});
