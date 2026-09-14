#!/usr/bin/env node
/**
 * 维护 assets/vendor/ 下的第三方依赖。
 *
 *   node scripts/update-vendor.mjs           下载/更新所有依赖，并用清单里的 sha256 校验
 *   node scripts/update-vendor.mjs --check   只校验现有文件与清单是否一致（CI 用，不发网络请求）
 *
 * 清单在 scripts/vendor.json，记录每个文件的库、精确版本、许可证、来源与 sha256。
 * 升级某个库时：改 vendor.json 里的 version 与 source，然后运行本脚本（不带 --check），
 * 它会下载新文件、重算哈希、回写清单。
 *
 * 退出码：0 = 通过，1 = 校验失败或下载失败
 * 环境变量：LK_ROOT 指定仓库根目录（供自测使用，默认取脚本上一级）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'assets', 'vendor');
const MANIFEST = path.join(ROOT, 'scripts', 'vendor.json');

const checkOnly = process.argv.includes('--check');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let ok = 0;
const problems = [];

for (const entry of manifest.files) {
  const dest = path.join(VENDOR_DIR, entry.file);
  const label = (entry.lib + '@' + entry.version).padEnd(26);

  if (checkOnly) {
    if (!fs.existsSync(dest)) {
      problems.push(`${label} 文件缺失: assets/vendor/${entry.file}`);
      continue;
    }
    const actual = sha256(fs.readFileSync(dest));
    if (actual !== entry.sha256) {
      problems.push(`${label} 哈希不匹配: assets/vendor/${entry.file}\n      清单 ${entry.sha256.slice(0, 16)}…  实际 ${actual.slice(0, 16)}…`);
      continue;
    }
    ok++;
    continue;
  }

  try {
    const res = await fetch(entry.source, { redirect: 'follow' });
    if (!res.ok) { problems.push(`${label} 下载失败 HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = sha256(buf);

    if (entry.sha256 && actual !== entry.sha256) {
      problems.push(
        `${label} 上游内容与清单哈希不一致，已拒绝写入。\n` +
        `      清单 ${entry.sha256.slice(0, 16)}…  下载 ${actual.slice(0, 16)}…\n` +
        `      如果是有意升级，请先用 --force 或手工更新 vendor.json 中的 sha256。`
      );
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    entry.sha256 = actual;
    entry.bytes = buf.length;
    ok++;
    console.log(`${label} 已更新 ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    problems.push(`${label} 下载异常: ${e.message}`);
  }
}

if (!checkOnly) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

console.log('');
console.log(`通过 ${ok} / ${manifest.files.length}${checkOnly ? '（校验模式）' : ''}`);
if (problems.length) {
  console.log('');
  problems.forEach(p => console.log('  ✗ ' + p));
}
process.exit(problems.length ? 1 : 0);
