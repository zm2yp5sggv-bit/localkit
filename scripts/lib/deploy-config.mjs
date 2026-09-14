/**
 * Cloudflare Pages 部署配置（_headers / _redirects）的解析与匹配。
 *
 * 为什么单独抽成一个模块：这两份配置是「声明式」的，实际生效与否取决于
 * Cloudflare 的匹配语义。把解析与匹配逻辑集中在这里，可以让
 *   - scripts/check-deploy.mjs  静态校验配置（例如重复响应头、不支持的状态码）
 *   - scripts/serve.mjs         在本地按同一套语义下发，使测试环境与线上一致
 * 共用同一份实现。此前 serve.mjs 自己写了一套「后覆盖前」的合并逻辑，
 * 与 Cloudflare 官方的「逗号合并」不一致，导致线上缺陷在本地测不出来。
 *
 * 语义依据（Cloudflare Pages 官方文档）：
 *   _headers   「An incoming request which matches multiple rules' URL patterns
 *               will inherit all rules' headers.」
 *              「If a header is applied twice in the _headers file, the values
 *               are joined with a comma separator.」
 *              「You may wish to remove a header ... by prepending the header
 *               name with an exclamation mark and space (! ).」
 *   _redirects 「Redirects (301, 302, 303, 307, 308) Yes / Rewrites (other
 *               status codes) No」→ 不支持 404 / 410。
 *              「The order of your redirects matter. If there are multiple
 *               redirects for the same source path, the top-most redirect is applied.」
 *              「Redirects are always followed, regardless of whether or not an
 *               asset matches the incoming request.」
 */

import fs from 'node:fs';
import path from 'node:path';

/** _redirects 支持的状态码。404 / 410 等 rewrite 类状态官方明确不支持。 */
export const SUPPORTED_REDIRECT_CODES = new Set([301, 302, 303, 307, 308, 200]);

/* ------------------------------------------------------------------ *
 * 解析
 * ------------------------------------------------------------------ */

/** 解析 _headers：首行是路径模式，缩进行是 `Name: value` 或 `! Name`（取消）。 */
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  const lines = String(text).split(/\r?\n/);

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) return;

    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), headers: {}, detach: new Set(), lineNo };
      rules.push(cur);
      return;
    }
    if (!cur) return;

    const body = raw.trim();
    if (body.startsWith('!')) {
      const name = body.slice(1).trim().toLowerCase();
      if (name) cur.detach.add(name);
      return;
    }
    const sep = body.indexOf(':');
    if (sep === -1) return;
    const name = body.slice(0, sep).trim();
    if (name) cur.headers[name] = body.slice(sep + 1).trim();
  });

  return rules;
}

/** 解析 _redirects：每行 `source destination [code]`，code 缺省为 302。 */
export function parseRedirects(text) {
  const rules = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.split(/\s+/);
    if (parts.length < 2) { rules.push({ invalid: true, line, lineNo }); return; }

    const [source, destination, codeRaw] = parts;
    const code = codeRaw === undefined ? 302 : Number(codeRaw);
    rules.push({ source, destination, code, line, lineNo });
  });
  return rules;
}

/* ------------------------------------------------------------------ *
 * 匹配
 * ------------------------------------------------------------------ */

/**
 * 把 Cloudflare 的路径模式转成正则。
 * 支持 `*`（贪婪匹配任意字符）与 `:name`（匹配单段）。正则元字符会被转义。
 */
export function patternToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/:[A-Za-z]\w*/g, '[^/]+')
    .replace(/\*/g, '.*');
  return new RegExp('^' + body + '$');
}

export function matches(pattern, urlPath) {
  return patternToRegex(pattern).test(urlPath);
}

/** 由模式生成一个具体的示例路径，用于重叠检测。 */
export function samplePath(pattern) {
  return String(pattern)
    .replace(/:[A-Za-z]\w*/g, 'x')
    .replace(/\*/g, 'x');
}

/**
 * 按 Cloudflare 语义解析某个路径最终生效的响应头。
 * 同名响应头用逗号合并；`! Name` 会先移除已有的同名头。
 */
export function resolveHeaders(rules, urlPath) {
  const out = {};
  for (const rule of rules) {
    if (!matches(rule.pattern, urlPath)) continue;
    for (const name of rule.detach) {
      for (const key of Object.keys(out)) {
        if (key.toLowerCase() === name) delete out[key];
      }
    }
    for (const [name, value] of Object.entries(rule.headers)) {
      const existing = Object.keys(out).find(k => k.toLowerCase() === name.toLowerCase());
      if (existing) out[existing] += ', ' + value;
      else out[name] = value;
    }
  }
  return out;
}

/** 返回首个匹配的重定向规则（官方：同 source 取最靠上的一条）。 */
export function resolveRedirect(rules, urlPath) {
  for (const rule of rules) {
    if (rule.invalid) continue;
    if (matches(rule.source, urlPath)) return rule;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

export function readDeployConfig(root) {
  const readIfExists = (name) => {
    const p = path.join(root, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  return {
    headersText: readIfExists('_headers'),
    redirectsText: readIfExists('_redirects'),
    headers: parseHeaders(readIfExists('_headers')),
    redirects: parseRedirects(readIfExists('_redirects')),
  };
}
