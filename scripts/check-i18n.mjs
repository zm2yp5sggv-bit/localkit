#!/usr/bin/env node
/**
 * LocalKit i18n 一致性校验
 *
 * 背景：页面静态源码保持英文（利于 SEO 与无 JS 环境），运行时由 assets/i18n.js
 * 用字典替换可见文案。这带来了「同一句文案存在两份拷贝」的风险——历史上就出现过
 * 静态源码说「本站靠广告维持」而字典说「完全没有广告」的矛盾。
 *
 * 本脚本把这份风险变成可自动校验的规则，作为 CI 门禁：
 *   1. 中英字典键完全对齐（缺失 / 多余）
 *   2. HTML 引用的键全部存在于字典（悬空引用）
 *   3. 静态兜底文案与字典英文值一致（核心：防止两份拷贝漂移）
 *   4. data-i18n（textContent 路径）的值不得含 HTML 实体
 *   5. data-i18n-ph 引用的键存在（占位符翻译）
 *   6. data-title-key 指向的键存在
 *   7. 字典中无人引用的死键（warning）
 *
 * 用法：node scripts/check-i18n.mjs
 * 退出码：0 = 通过，1 = 存在错误
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------------ *
 * 1. 解析字典
 * ------------------------------------------------------------------ */

function parseDict(src) {
  const dict = { en: new Map(), zh: new Map() };
  let cur = null;
  const keyRe = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;

  for (const line of src.split(/\r?\n/)) {
    const head = line.trim();
    if (/^en\s*:\s*\{/.test(head)) { cur = 'en'; continue; }
    if (/^zh\s*:\s*\{/.test(head)) { cur = 'zh'; continue; }
    if (cur && /^\}\s*$/.test(head)) { cur = null; continue; }
    if (!cur) continue;

    keyRe.lastIndex = 0;
    let m;
    while ((m = keyRe.exec(line)) !== null) {
      const key = m[1].replace(/\\'/g, "'");
      const val = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      dict[cur].set(key, val);
    }
  }
  return dict;
}

/* ------------------------------------------------------------------ *
 * 2. 从 HTML 中提取 i18n 引用及其静态兜底文案
 * ------------------------------------------------------------------ */

const ATTRS = ['data-i18n', 'data-i18n-html', 'data-i18n-ph'];
const VOID_TAGS = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source']);

function findClosing(src, tag, from) {
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let pos = from;
  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(src);
    const c = closeRe.exec(src);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; pos = o.index + 1; }
    else { depth--; if (depth === 0) return c.index; pos = c.index + 1; }
  }
  return -1;
}

function extractRefs(htmlSrc, file) {
  const refs = [];
  for (const attr of ATTRS) {
    const re = new RegExp(attr + '="([^"]+)"', 'g');
    let m;
    while ((m = re.exec(htmlSrc)) !== null) {
      const key = m[1];
      const attrStart = m.index;
      const tagStart = htmlSrc.lastIndexOf('<', attrStart);
      if (tagStart === -1) continue;
      const tagEnd = htmlSrc.indexOf('>', attrStart);
      if (tagEnd === -1) continue;

      const openTag = htmlSrc.slice(tagStart, tagEnd + 1);
      const tagName = (openTag.match(/^<([a-zA-Z][\w-]*)/) || [])[1];
      let statik = null;

      if (attr === 'data-i18n-ph') {
        // 占位符翻译：比对的是 placeholder 属性，而不是元素内容
        const ph = openTag.match(/\splaceholder="([^"]*)"/);
        statik = ph ? ph[1] : null;
      } else if (tagName && !VOID_TAGS.has(tagName.toLowerCase()) && !openTag.endsWith('/>')) {
        const close = findClosing(htmlSrc, tagName, tagEnd + 1);
        if (close !== -1) statik = htmlSrc.slice(tagEnd + 1, close);
      }
      refs.push({ key, attr, tag: tagName, static: statik, file });
    }
  }
  return refs;
}

/* ------------------------------------------------------------------ *
 * 3. 归一化：解码实体 + 折叠空白，用于「静态 vs 字典」比较
 * ------------------------------------------------------------------ */

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function norm(s) {
  return decodeEntities(String(s)).replace(/\s+/g, ' ').trim();
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '');
}

/* ------------------------------------------------------------------ *
 * 4. 遍历文件
 * ------------------------------------------------------------------ */

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const allFiles = walk(ROOT);
const htmlFiles = allFiles.filter(f => f.endsWith('.html'));

const errors = [];
const warnings = [];

/* ------------------------------------------------------------------ *
 * 检查 1：字典键对齐
 * ------------------------------------------------------------------ */

const dictSrc = fs.readFileSync(path.join(ROOT, 'assets', 'i18n.js'), 'utf8');
const dict = parseDict(dictSrc);

for (const [key] of dict.en) {
  if (!dict.zh.has(key)) errors.push(`字典：键 '${key}' 只有英文，缺少中文`);
}
for (const [key] of dict.zh) {
  if (!dict.en.has(key)) errors.push(`字典：键 '${key}' 只有中文，缺少英文`);
}

/* ------------------------------------------------------------------ *
 * 检查 2~6：逐页校验
 * ------------------------------------------------------------------ */

const referenced = new Set();
let checkedStatics = 0;
const i18nRuntimeSrc = fs.readFileSync(path.join(ROOT, 'assets', 'i18n.js'), 'utf8');
const supportsPlaceholderAttr = /data-i18n-ph/.test(i18nRuntimeSrc);

for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const refs = extractRefs(src, rel);

  for (const r of refs) {
    referenced.add(r.key);
    const en = dict.en.get(r.key);
    const zh = dict.zh.get(r.key);

    // 2. 悬空引用
    if (en === undefined && zh === undefined) {
      errors.push(`${rel}: 引用了未定义的键 '${r.key}'（${r.attr}）`);
      continue;
    }

    // 4. data-i18n 走 textContent，值里不能有 HTML 实体
    if (r.attr === 'data-i18n' && en && /&(amp|lt|gt|nbsp|quot|#39);/.test(en)) {
      errors.push(`${rel}: '${r.key}' 用 data-i18n（textContent）但字典值含 HTML 实体，会原样显示为文本`);
    }

    // 3. 静态兜底文案必须与字典英文一致
    if (r.static !== null && en !== undefined) {
      const a = norm(r.static);
      const b = norm(en);
      checkedStatics++;
      if (a !== b) {
        errors.push(
          `${rel}: [${r.key}] 静态文案与字典英文不一致\n` +
          `      静态: ${a.slice(0, 110)}\n` +
          `      字典: ${b.slice(0, 110)}`
        );
      }
    }

    // 5. 占位符键必须真的被运行时消费
    if (r.attr === 'data-i18n-ph' && !supportsPlaceholderAttr) {
      errors.push(`${rel}: '${r.key}' 使用 data-i18n-ph，但 i18n.js 未实现该属性的处理`);
    }
  }

  // 6. data-title-key
  const tm = src.match(/data-title-key="([^"]+)"[^>]*>/);
  if (tm) {
    referenced.add(tm[1]);
    if (!dict.en.has(tm[1])) errors.push(`${rel}: data-title-key 指向未定义键 '${tm[1]}'`);
    else {
      const titleM = src.match(/<title>([\s\S]*?)<\/title>/);
      if (titleM) {
        const a = norm(titleM[1]);
        const b = norm(dict.en.get(tm[1]));
        if (a !== b) {
          warnings.push(
            `${rel}: <title> 静态值与字典 '${tm[1]}' 不一致（切换语言时标题会闪变）\n` +
            `      静态: ${a.slice(0, 110)}\n` +
            `      字典: ${b.slice(0, 110)}`
          );
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 检查 7：死键
 * ------------------------------------------------------------------ */

// 注意：必须排除 i18n.js 自身——否则字典里的键名会“自我引用”，死键检查永远通过
const jsSrc = allFiles
  .filter(f => f.endsWith('.js') && !/(^|[\\/])i18n\.js$/.test(f))
  .map(f => fs.readFileSync(f, 'utf8'))
  .join('\n');
const htmlSrc = htmlFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const dynamicWhole = jsSrc + '\n' + htmlSrc;

for (const [key] of dict.en) {
  if (referenced.has(key)) continue;
  // 动态拼键（如 t('pg.' + x)）无法静态判定，出现键名片段即视为可能被使用
  const tail = key.split('.').pop();
  if (tail && new RegExp(`['"\`]${tail}['"\`]`).test(dynamicWhole)) continue;
  if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(dynamicWhole)) continue;
  warnings.push(`字典：键 '${key}' 无任何页面引用（疑似死键）`);
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

console.log('LocalKit i18n 一致性校验');
console.log('─'.repeat(60));
console.log(`页面数            : ${htmlFiles.length}`);
console.log(`字典键（en / zh） : ${dict.en.size} / ${dict.zh.size}`);
console.log(`静态文案比对条数  : ${checkedStatics}`);
console.log('─'.repeat(60));

if (errors.length) {
  console.log(`\n错误 ${errors.length} 项：`);
  errors.forEach(e => console.log('  ✗ ' + e));
}
if (warnings.length) {
  console.log(`\n警告 ${warnings.length} 项：`);
  warnings.forEach(w => console.log('  ! ' + w));
}
if (!errors.length && !warnings.length) {
  console.log('\n全部检查通过。');
}

console.log('');
process.exit(errors.length ? 1 : 0);
