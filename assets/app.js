/* LocalKit shared helpers — loaded by every tool page
 * 约定：任何要拼进 innerHTML 的动态字符串（文件名、用户输入、外部数据）
 * 都必须先经过 LK.esc() 转义。不要在各工具页里自己重写转义逻辑。 */
(function () {
  'use strict';

  window.LK = {
    el(id) { return document.getElementById(id); },

    /** 转义为 HTML 文本。用于所有要拼进 innerHTML 的动态值。 */
    esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
      return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },

    /**
     * Wire a dropzone element: click -> hidden file input, drag & drop.
     * cb(files) receives a FileList-like array.
     */
    setupDropzone(zone, input, cb) {
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag');
        if (e.dataTransfer.files.length) cb(e.dataTransfer.files);
      });
      input.addEventListener('change', () => {
        if (input.files.length) cb(input.files);
        input.value = ''; // allow re-selecting the same file
      });
    },

    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    setStatus(msg, kind) {
      const s = document.querySelector('.status');
      if (!s) return;
      s.textContent = msg || '';
      s.classList.remove('err', 'ok');
      if (kind) s.classList.add(kind);
    },

    /** Decode an image file to a bitmap, downscaling if maxDim is set. */
    async decodeImage(file, maxDim) {
      const bitmap = await createImageBitmap(file);
      const scale = maxDim && Math.max(bitmap.width, bitmap.height) > maxDim
        ? maxDim / Math.max(bitmap.width, bitmap.height) : 1;
      return {
        bitmap,
        width: Math.max(1, Math.round(bitmap.width * scale)),
        height: Math.max(1, Math.round(bitmap.height * scale)),
      };
    },

    /** Canvas -> Blob promise. */
    canvasToBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality);
      });
    },

    /** Inject the sponsor button into the nav and footer on every page (except donate itself). */
    injectSponsor() {
      if (/donate\.html?$/.test(location.pathname)) return;
      var pre = location.pathname.indexOf('/tools/') !== -1 ? '../' : '';
      var nav = document.querySelector('.nav');
      if (nav && !document.getElementById('donateBtn')) {
        var a = document.createElement('a');
        a.id = 'donateBtn';
        a.className = 'donate-btn';
        a.href = pre + 'donate.html';
        a.setAttribute('data-i18n', 'nav.donate');
        a.textContent = '♥ Sponsor';
        var lang = document.getElementById('langBtn');
        if (lang) nav.insertBefore(a, lang); else nav.appendChild(a);
      }
      var links = document.querySelector('.site-footer .links');
      if (links && !links.querySelector('.donate-btn')) {
        var f = document.createElement('a');
        f.className = 'donate-btn';
        f.href = pre + 'donate.html';
        f.setAttribute('data-i18n', 'nav.donate');
        f.textContent = '♥ Sponsor';
        links.insertBefore(f, links.firstChild);
      }
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.LK.injectSponsor();
      if (window.LKI) window.LKI.apply(window.LKI.lang); // label the just-injected button
    });
  } else {
    window.LK.injectSponsor();
    if (window.LKI) window.LKI.apply(window.LKI.lang);
  }
})();
