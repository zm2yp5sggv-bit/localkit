#!/usr/bin/env node
/**
 * 生成端到端测试用的二进制夹具（PNG / PDF / DOCX）。
 *
 *   node tests/fixtures/make-fixtures.mjs
 *
 * 生成结果会被提交进仓库，测试运行时直接读取，因此 CI 不需要跑这个脚本。
 * 只有在需要调整夹具内容时才重新执行。所有文件均为手工构造，不含任何第三方数据。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * PNG 编码（无依赖）
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 生成一张 w×h 的 RGB 渐变 PNG，用像素数据画斜向条纹便于目视检查。 */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;                                   // filter: none
    for (let x = 0; x < w; x++) {
      const stripe = ((x + y) % 16) < 8;
      raw[p++] = stripe ? 40 + (x * 215 / w) | 0 : 240;
      raw[p++] = stripe ? 90 : 200 - (y * 120 / h) | 0;
      raw[p++] = stripe ? 220 - (x * 100 / w) | 0 : 120;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * PDF 构造（无依赖）
 * ------------------------------------------------------------------ */

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** 由「每页内容流」数组构造一个合法 PDF。 */
function makePdf(pages) {
  const objects = [];
  const pageCount = pages.length;

  // 1: Catalog, 2: Pages, 3: Font, 之后每页两个对象（Page + Contents）
  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push((4 + i * 2) + ' 0 R');

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((stream, i) => {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  const maxObj = objects.length;
  out += `xref\n0 ${maxObj}\n0000000000 65535 f \n`;
  for (let i = 1; i < maxObj; i++) {
    out += offsets[i] !== undefined
      ? String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
      : '0000000000 65535 f \n';
  }
  out += `trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** 纯文本多页 PDF：用于合并 / 拆分 / 转图片 / 转 Word 的段落路径。 */
function textPdf(pageTexts) {
  return makePdf(pageTexts.map(lines => {
    let s = 'BT /F1 14 Tf 72 720 Td 20 TL\n';
    for (const line of lines) s += `(${esc(line)}) Tj T*\n`;
    return s + 'ET';
  }));
}

/**
 * 带矢量框线表格的 PDF：用于验证 pdf-to-docx 的网格识别路径。
 *
 * 关键点：工具是从 PDF 操作符里的 `re`（矩形）读取边框线的，
 * 因此这里必须用 `re` 把每条线画成细长矩形，而不是用 `m`/`l` 描线——
 * 后者生成的是 moveTo/lineTo 操作符，不会进入网格识别。
 *
 * 5 条横线 + 3 条竖线构成 4 行 × 2 列，文字落在行带内部。
 * 行数刻意做到 4 行以上：工具只在表格达到 4 行时才采样 firstGrid，
 * 3 行的表虽然能被识别成表格，但不会走那条分支。
 */
function tablePdf() {
  const L = 72, R = 468;                              // 左 / 右边框
  const YS = [700, 660, 620, 580, 540];               // 5 条横线 → 4 个行带
  const T = YS[0], B = YS[YS.length - 1];

  let s = '';
  // 横线：宽 (R-L)、高 2 的填充矩形，中心落在目标 y 上
  for (const y of YS) s += `${L} ${y - 1} ${R - L} 2 re f\n`;
  // 竖线：宽 2、高 (T-B) 的填充矩形
  for (const x of [L, (L + R) / 2, R]) s += `${x - 1} ${B} 2 ${T - B} re f\n`;

  // 每个行带内放一行文字，y 取行带中线略偏上
  const rows = [
    ['Region', 'Revenue'],
    ['North', '1200'],
    ['South', '980'],
    ['East', '760'],
  ];
  rows.forEach((cells, i) => {
    const y = YS[i] - 18;
    s += `BT /F1 11 Tf ${L + 8} ${y} Td (${esc(cells[0])}) Tj ET\n`;
    s += `BT /F1 11 Tf ${(L + R) / 2 + 12} ${y} Td (${esc(cells[1])}) Tj ET\n`;
  });

  s += 'BT /F1 14 Tf 72 740 Td (Quarterly revenue by region) Tj ET\n';
  return makePdf([s]);
}

/* ------------------------------------------------------------------ *
 * DOCX 构造：手写 ZIP 容器（stored，不压缩），避免为了造夹具再引依赖
 * ------------------------------------------------------------------ */

function zipEntry(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const crc = crc32(data);
  return { nameBuf, data, crc, offset: 0 };
}

/** 把若干文件打成一个合法 ZIP（compression method 0 = stored）。 */
function makeZip(entries) {
  const locals = [];
  let offset = 0;

  for (const e of entries) {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);            // version needed
    h.writeUInt16LE(0, 6);             // flags
    h.writeUInt16LE(0, 8);             // method: stored
    h.writeUInt16LE(0, 10);            // mod time
    h.writeUInt16LE(0x2821, 12);       // mod date (2000-01-01)
    h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(e.data.length, 18);
    h.writeUInt32LE(e.data.length, 22);
    h.writeUInt16LE(e.nameBuf.length, 26);
    h.writeUInt16LE(0, 28);            // extra len
    e.offset = offset;
    const rec = Buffer.concat([h, e.nameBuf, e.data]);
    locals.push(rec);
    offset += rec.length;
  }

  const central = [];
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);            // version made by
    h.writeUInt16LE(20, 6);            // version needed
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt16LE(0x2821, 14);
    h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(e.data.length, 20);
    h.writeUInt32LE(e.data.length, 24);
    h.writeUInt16LE(e.nameBuf.length, 28);
    h.writeUInt16LE(0, 30);            // extra
    h.writeUInt16LE(0, 32);            // comment
    h.writeUInt16LE(0, 34);            // disk start
    h.writeUInt16LE(0, 36);            // internal attrs
    h.writeUInt32LE(0, 38);            // external attrs
    h.writeUInt32LE(e.offset, 42);
    central.push(Buffer.concat([h, e.nameBuf]));
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function makeDocxBuffer() {
  const para = (text, opts = {}) =>
    '<w:p>' +
    (opts.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') +
    '<w:r><w:rPr>' + (opts.bold ? '<w:b/>' : '') + '</w:rPr>' +
    '<w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';

  const entries = [
    zipEntry('[Content_Types].xml',
      XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'),

    zipEntry('_rels/.rels',
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'),

    zipEntry('word/_rels/document.xml.rels',
      XML_DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'),

    zipEntry('word/styles.xml',
      XML_DECL +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
      '</w:styles>'),

    zipEntry('word/document.xml',
      XML_DECL +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      para('LocalKit fixture document', { heading: true }) +
      para('This file is generated by tests/fixtures/make-fixtures.mjs.') +
      para('It exists so the DOCX to PDF path can be exercised end to end.') +
      para('Second paragraph with more text to give the page some body content.') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' +
      '</w:body></w:document>'),
  ];

  return makeZip(entries);
}

/* ------------------------------------------------------------------ *
 * 写出
 * ------------------------------------------------------------------ */

const written = [];
const out = (name, buf) => {
  fs.writeFileSync(path.join(HERE, name), buf);
  written.push(name.padEnd(22) + (buf.length / 1024).toFixed(1) + ' KB');
};

out('sample.png', makePng(240, 160));
out('sample-wide.png', makePng(320, 200));

out('sample.pdf', textPdf([
  ['LocalKit sample PDF — page one.', 'The quick brown fox jumps over the lazy dog.'],
  ['LocalKit sample PDF — page two.', 'Second page content for split and merge tests.'],
]));

out('table.pdf', tablePdf());

out('sample.docx', makeDocxBuffer());

console.log('已生成测试夹具：');
written.forEach(w => console.log('  ' + w));
