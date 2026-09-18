/* ReCast — one X post in, four platform-native versions out.
   Everything is deterministic and runs in the browser: no model, no upload.

   The parser reads the post the way a deal post is usually written — headline
   first, then `Label: value` lines, bullets, a link and a row of hashtags —
   and each platform writer decides what that structure should look like there:
   WhatsApp gets *bold* and ```code```, Instagram loses the links and gains a
   hashtag block below the fold, LinkedIn gets a bold hook and five tags at
   most, Reddit gets a title and a Markdown table. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  /* ---------------- settings ---------------- */
  const DEFAULTS = {
    waFoot: '_Shared by YourCardJourney_',
    igFoot: 'Follow @yourcardjourney for daily card deals',
    igLink: '🔗 Link in bio',
    igTags: '#YourCardJourney #CreditCards #Deals #Offers #India #Cashback #SaveMoney',
    liFoot: 'Follow YourCardJourney for more.',
    liTags: '#CreditCards #PersonalFinance #Deals',
  };
  let settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('rc.settings') || '{}')); } catch (e) { /* ignore */ }

  /* ---------------- regexes ---------------- */
  const RX = {
    url: /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+|\b(?:amzn\.to|amzn\.in|bit\.ly|fkrt\.(?:it|cc)|myntr\.it|ajio\.me|tinyurl\.com|t\.co|cutt\.ly)\/[^\s<>()]+/gi,
    tag: /(^|[\s(])#([\p{L}\p{N}_]+)/gu,
    tagOnly: /^(?:\s*#[\p{L}\p{N}_]+\s*)+$/u,
    mention: /(^|[\s(])@([A-Za-z0-9_]{2,})/g,
    bullet: /^\s*(?:[-*•▪▫◦➤➜→›»✅✔️✔☑️🔥💥⚡️⚡🎯👉👇✨🔹🔸🟢🟣🟠🔴⭐️⭐📌🛒💳🎁🏷️🏷]+|\d{1,2}[.)])\s+(.+)$/u,
    kv: /^\s*([^:\n]{1,32}?)\s*:\s+(.+)$/,
    price: /(?:₹|Rs\.?\s?|INR\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|L|lakh|cr))?/g,
    pct: /\b\d{1,3}(?:\.\d+)?\s?%(?:\s?(?:off|OFF|Off|cashback|Cashback|CB|discount))?/g,
    code: /\b(?:code|coupon|promo|promo\s?code|use)\s*[:\-–]?\s*([A-Z][A-Z0-9]{3,})\b/gi,
    emoji: /[\p{Extended_Pictographic}️‍]/gu,
  };
  const HAS_EMOJI = /\p{Extended_Pictographic}/u;
  const HAS_URL = /https?:\/\/|www\./i;

  /* ---------------- parse ---------------- */
  function parse(text) {
    const raw = text.replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    const lines = raw.split('\n');
    const items = [];
    for (const line of lines) {
      if (!line.trim()) { items.push({ t: 'blank' }); continue; }
      const s = line.trim();
      const urls = s.match(RX.url) || [];
      if (urls.length === 1 && s.replace(RX.url, '').trim().replace(/^[👉🔗➡️→:\s-]+|[\s.]+$/g, '') === '') { items.push({ t: 'url', url: urls[0], text: s }); continue; }
      if (RX.tagOnly.test(s)) { items.push({ t: 'tags', text: s }); continue; }
      const b = s.match(RX.bullet);
      if (b) { items.push({ t: 'bullet', text: b[1].trim(), glyph: s.slice(0, s.indexOf(b[1])).trim() }); continue; }
      const kv = s.match(RX.kv);
      if (kv && !HAS_URL.test(kv[1]) && !/^https?$/i.test(kv[1])) { items.push({ t: 'kv', key: kv[1].trim(), val: kv[2].trim(), text: s }); continue; }
      items.push({ t: 'text', text: s });
    }
    // Headline = first line that carries words (not a bare link or tag row).
    let head = -1;
    for (let i = 0; i < items.length; i++) { if (['text', 'kv', 'bullet'].includes(items[i].t)) { head = i; break; } }
    const headline = head >= 0 ? items[head].text : '';
    const body = items.filter((_, i) => i !== head);
    // trim leading/trailing blanks of body
    while (body.length && body[0].t === 'blank') body.shift();
    while (body.length && body[body.length - 1].t === 'blank') body.pop();

    const tags = uniq([...raw.matchAll(RX.tag)].map((m) => m[2]));
    const urls = uniq(raw.match(RX.url) || []);
    const mentions = uniq([...raw.matchAll(RX.mention)].map((m) => m[2]));
    const codes = uniq([...raw.matchAll(RX.code)].map((m) => m[1]));
    return { raw, headline, body, tags, urls, mentions, codes };
  }
  const uniq = (a) => [...new Set(a)];
  const isCodeKey = (k) => /\b(code|coupon|promo|voucher)\b/i.test(k);

  /* ---------------- shared helpers ---------------- */
  // Drop the # but keep the word, so "#Myntra sale" reads "Myntra sale".
  const detag = (s) => s.replace(RX.tag, '$1$2');
  const stripTrailingTags = (s) => s.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  const demention = (s) => s.replace(RX.mention, '$1$2');
  const stripEmoji = (s) => s.replace(RX.emoji, '').replace(/\s{2,}/g, ' ').trim();
  const stripUrls = (s) => s.replace(RX.url, '').replace(/\s{2,}/g, ' ').trim();
  // Hand-written WhatsApp *bold* in the source: drop the stars for platforms with no
  // bold, turn them into Markdown for Reddit.
  const STAR = /(^|[\s(])\*([^*\n]+?)\*(?=[\s.,!?:;)]|$)/g;
  const unstar = (s) => s.replace(STAR, '$1$2');
  const mdstar = (s) => s.replace(STAR, '$1**$2**');

  // Wrap money, percentages and coupon codes. `bold`/`code` are (s) => s.
  function emph(s, bold, code) {
    if (/[*_`]/.test(s)) return s; // author already formatted this line — leave it
    let out = s;
    const spans = [];
    const mark = (rx, fn) => { out = out.replace(rx, (m, ...rest) => { const key = `\uE000${spans.length}\uE001`; spans.push(fn(m, rest)); return key; }); };
    mark(RX.code, (m, g) => m.replace(g[0], code(g[0])));
    mark(RX.price, (m) => bold(m.trim()));
    mark(RX.pct, (m) => bold(m.trim()));
    return out.replace(/\uE000(\d+)\uE001/g, (_, i) => spans[+i]);
  }

  /* ---------------- writers ---------------- */
  function toWhatsApp(p) {
    const B = (s) => `*${s}*`, C = (s) => '```' + s + '```';
    const out = [];
    const notes = [];
    if (p.headline) out.push(B(unstar(demention(detag(stripTrailingTags(p.headline))))));
    if (p.body.length) out.push('');
    let lastBlank = false;
    for (const it of p.body) {
      if (it.t === 'blank') { if (!lastBlank) out.push(''); lastBlank = true; continue; }
      lastBlank = false;
      if (it.t === 'tags') continue;
      if (it.t === 'url') { out.push(`👉 ${it.url}`); continue; }
      if (it.t === 'kv') { out.push(`${B(it.key + ':')} ${isCodeKey(it.key) ? C(it.val) : emph(demention(detag(it.val)), B, C)}`); continue; }
      if (it.t === 'bullet') { const g = /^[\d.)]+$/.test(it.glyph) || HAS_EMOJI.test(it.glyph) ? it.glyph : '•'; out.push(`${g} ${emph(demention(detag(it.text)), B, C)}`); continue; }
      out.push(emph(demention(detag(it.text)), B, C));
    }
    if (p.tags.length) notes.push(`${p.tags.length} hashtag${p.tags.length > 1 ? 's' : ''} dropped`);
    if (settings.waFoot.trim()) { out.push(''); out.push(settings.waFoot.trim()); }
    return { text: tidy(out), note: notes.join(' · '), limit: 65536 };
  }

  function toInstagram(p) {
    const out = [];
    const notes = [];
    const plain = (s) => unstar(stripUrls(demention(detag(s))));
    if (p.headline) out.push(plain(stripTrailingTags(p.headline)));
    if (p.body.length) out.push('');
    let lastBlank = false;
    for (const it of p.body) {
      if (it.t === 'blank') { if (!lastBlank) out.push(''); lastBlank = true; continue; }
      lastBlank = false;
      if (it.t === 'tags' || it.t === 'url') continue;
      if (it.t === 'kv') { out.push(`${it.key} ➜ ${plain(it.val)}`); continue; }
      if (it.t === 'bullet') { const g = HAS_EMOJI.test(it.glyph) ? it.glyph : '✔️'; out.push(`${g} ${plain(it.text)}`); continue; }
      const t = plain(it.text); if (t) out.push(t);
    }
    if (p.urls.length) { out.push(''); out.push(settings.igLink.trim() || '🔗 Link in bio'); notes.push(`${p.urls.length} link${p.urls.length > 1 ? 's' : ''} → "link in bio"`); }
    if (settings.igFoot.trim()) { out.push(''); out.push(settings.igFoot.trim()); }
    const tags = uniq([...p.tags, ...tagList(settings.igTags)]).slice(0, 30);
    if (tags.length) { out.push('.', '.', '.'); out.push(tags.map((t) => '#' + t).join(' ')); notes.push(`${tags.length}/30 hashtags`); }
    return { text: tidy(out), note: notes.join(' · '), limit: 2200 };
  }

  function toLinkedIn(p) {
    const out = [];
    const plain = (s) => unstar(demention(detag(s)));
    if (p.headline) out.push(uniBold(plain(stripTrailingTags(p.headline))));
    if (p.body.length) out.push('');
    let lastBlank = false;
    for (const it of p.body) {
      if (it.t === 'blank') { if (!lastBlank) out.push(''); lastBlank = true; continue; }
      lastBlank = false;
      if (it.t === 'tags') continue;
      if (it.t === 'url') { out.push(`🔗 ${it.url}`); continue; }
      if (it.t === 'kv') { out.push(`${it.key}: ${plain(it.val)}`); continue; }
      if (it.t === 'bullet') { out.push(`→ ${plain(it.text)}`); continue; }
      out.push(plain(it.text));
    }
    if (settings.liFoot.trim()) { out.push(''); out.push(settings.liFoot.trim()); }
    const tags = uniq([...p.tags, ...tagList(settings.liTags)]).slice(0, 5);
    if (tags.length) { out.push(''); out.push(tags.map((t) => '#' + t).join(' ')); }
    return { text: tidy(out), note: tags.length ? `${tags.length}/5 hashtags` : '', limit: 3000 };
  }

  function toReddit(p) {
    const B = (s) => `**${s}**`, C = (s) => '`' + s + '`';
    const md = (s) => emph(mdstar(demention(detag(s))), B, C);
    const title = unstar(stripEmoji(demention(detag(stripUrls(stripTrailingTags(p.headline)))))).replace(/[.!:\s]+$/, '').slice(0, 300);
    const out = [];
    let kvRun = [];
    const flushKv = () => {
      if (!kvRun.length) return;
      const val = (k) => isCodeKey(k.key) ? C(k.val) : md(k.val);
      if (kvRun.length === 1) { out.push(`${B(kvRun[0].key + ':')} ${val(kvRun[0])}`, ''); }
      else { out.push('| Detail | Value |', '|---|---|'); for (const k of kvRun) out.push(`| ${k.key} | ${val(k).replace(/\|/g, '\\|')} |`); out.push(''); }
      kvRun = [];
    };
    let listOpen = false;
    for (const it of p.body) {
      if (it.t === 'kv') { if (listOpen) { out.push(''); listOpen = false; } kvRun.push(it); continue; }
      flushKv();
      if (it.t === 'blank') { if (listOpen) { out.push(''); listOpen = false; } continue; }
      if (it.t === 'tags') continue;
      if (it.t === 'url') { if (listOpen) { out.push(''); listOpen = false; } out.push(it.url, ''); continue; }
      if (it.t === 'bullet') { out.push(`- ${md(it.text)}`); listOpen = true; continue; }
      if (listOpen) { out.push(''); listOpen = false; }
      out.push(md(it.text), '');
    }
    flushKv();
    const notes = [];
    if (p.tags.length) notes.push('hashtags removed');
    if (p.body.some((i) => i.t === 'kv')) notes.push('labels → table');
    return { text: tidy(out), title, note: notes.join(' · '), limit: 40000 };
  }

  const tagList = (s) => (s || '').split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean);
  function tidy(lines) { return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  // Mathematical sans-serif bold — the only "bold" LinkedIn will show.
  function uniBold(s) {
    return [...s].map((ch) => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D5D4 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D5EE + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7EC + c - 48);
      return ch;
    }).join('');
  }

  /* ---------------- preview renderers (text → safe HTML) ---------------- */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const linkify = (h) => h.replace(RX.url, (u) => `<a href="${esc(u.startsWith('http') ? u : 'https://' + u)}" target="_blank" rel="noopener">${u}</a>`);
  function waHtml(t) {
    let h = esc(t);
    h = h.replace(/```([\s\S]+?)```/g, '<code>$1</code>');
    h = h.replace(/(^|[\s>])\*([^*\n]+?)\*(?=[\s<.,!?:;)]|$)/g, '$1<b>$2</b>');
    h = h.replace(/(^|[\s>])_([^_\n]+?)_(?=[\s<.,!?:;)]|$)/g, '$1<i>$2</i>');
    h = h.replace(/(^|[\s>])~([^~\n]+?)~(?=[\s<.,!?:;)]|$)/g, '$1<s>$2</s>');
    return linkify(h);
  }
  const tagHtml = (h) => h.replace(/(^|[\s(])#([\p{L}\p{N}_]+)/gu, '$1<span class="tag">#$2</span>');
  const igHtml = (t) => tagHtml(esc(t));
  const liHtml = (t) => linkify(tagHtml(esc(t)));
  function rdHtml(md) {
    const lines = md.split('\n');
    let html = '', i = 0;
    const inline = (s) => linkify(esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'));
    while (i < lines.length) {
      const l = lines[i];
      if (/^\|.*\|$/.test(l) && /^\|[-| ]+\|$/.test(lines[i + 1] || '')) {
        const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
        const head = cells(l); i += 2; let rows = '';
        while (i < lines.length && /^\|.*\|$/.test(lines[i])) { rows += '<tr>' + cells(lines[i]).map((c) => `<td>${inline(c.replace(/\\\|/g, '|'))}</td>`).join('') + '</tr>'; i++; }
        html += `<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`; continue;
      }
      if (/^- /.test(l)) { let li = ''; while (i < lines.length && /^- /.test(lines[i])) { li += `<li>${inline(lines[i].slice(2))}</li>`; i++; } html += `<ul>${li}</ul>`; continue; }
      if (l.trim()) { html += `<p>${inline(l)}</p>`; }
      i++;
    }
    return html;
  }

  /* ---------------- state + DOM ---------------- */
  const src = $('src'), convertBtn = $('convertBtn'), paneX = $('paneX'), out = $('out'), outEmpty = $('outEmpty');
  const state = { converted: null, locked: false, done: new Set(), active: 'wa' };
  const PLATFORMS = ['wa', 'ig', 'li', 'rd'];
  const NAMES = { wa: 'WhatsApp', ig: 'Instagram', li: 'LinkedIn', rd: 'Reddit' };

  try { src.value = localStorage.getItem('rc.draft') || ''; } catch (e) { /* ignore */ }

  // The box grows with the post, like the WhatsApp bubble does - never an inner scrollbar.
  function autosize() { src.style.height = 'auto'; src.style.height = Math.max(240, src.scrollHeight) + 'px'; }

  function updateCount() {
    autosize();
    const n = [...src.value].length;
    $('count').textContent = n;
    $('count').classList.toggle('over', n > 280);
    const arc = $('ringArc'); const frac = Math.min(1, n / 280);
    arc.setAttribute('stroke-dashoffset', String(59.7 * (1 - frac)));
    arc.setAttribute('stroke', n > 280 ? '#f4212e' : n > 260 ? '#ffd400' : '#1d9bf0');
    convertBtn.disabled = !src.value.trim();
    // Live hints about what the parser sees.
    const p = parse(src.value);
    const h = [];
    if (p.headline) h.push('headline ✓');
    const kv = p.body.filter((i) => i.t === 'kv').length; if (kv) h.push(`${kv} label${kv > 1 ? 's' : ''}`);
    const bl = p.body.filter((i) => i.t === 'bullet').length; if (bl) h.push(`${bl} bullet${bl > 1 ? 's' : ''}`);
    if (p.urls.length) h.push(`${p.urls.length} link${p.urls.length > 1 ? 's' : ''}`);
    if (p.tags.length) h.push(`${p.tags.length} #tag${p.tags.length > 1 ? 's' : ''}`);
    if (p.codes.length) h.push(`code ${p.codes.join(', ')}`);
    $('hints').innerHTML = h.map((x) => `<span>${esc(x)}</span>`).join('') + (n > 280 ? '<span class="warn">over 280 — fine for X Premium</span>' : '');
  }

  function convert(quiet) {
    const p = parse(src.value);
    if (!p.raw) return;
    const r = { wa: toWhatsApp(p), ig: toInstagram(p), li: toLinkedIn(p), rd: toReddit(p) };
    state.converted = r; state.done.clear();
    // WhatsApp
    $('waPreview').innerHTML = waHtml(r.wa.text); $('waRaw').textContent = r.wa.text;
    setNote('wa', r.wa);
    // Instagram
    $('igPreview').innerHTML = igHtml(r.ig.text); $('igRaw').textContent = r.ig.text;
    setNote('ig', r.ig);
    // LinkedIn
    $('liPreview').innerHTML = liHtml(r.li.text); $('liRaw').textContent = r.li.text;
    setNote('li', r.li);
    // Reddit
    $('rdTitle').textContent = r.rd.title; $('rdPreview').innerHTML = rdHtml(r.rd.text);
    $('rdRaw').textContent = `TITLE:\n${r.rd.title}\n\nBODY:\n${r.rd.text}`;
    setNote('rd', r.rd);

    outEmpty.hidden = true; out.hidden = false; out.classList.remove('is-stale'); $('stale').hidden = true;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-done'));
    document.querySelectorAll('.copy').forEach((b) => { b.classList.remove('is-copied'); b.textContent = b.dataset.label || b.textContent; });
    setLocked(true); renderProgress();
    if (!quiet) schedulePush();
    if (!quiet && matchMedia('(max-width: 960px)').matches) setTimeout(() => out.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  function setNote(k, r) {
    const n = [...r.text].length; const c = $(k + 'Count');
    c.textContent = `${n.toLocaleString()} chars`; c.classList.toggle('over', n > r.limit);
    $(k + 'Note').textContent = (n > r.limit ? `over the ${r.limit.toLocaleString()} limit · ` : '') + (r.note || '');
  }
  function setLocked(on) {
    state.locked = on; paneX.classList.toggle('is-locked', on);
    src.readOnly = on; $('lockPill').hidden = !on; $('lockedOverlay').hidden = !on;
  }
  function renderProgress() {
    const pr = $('progress'); pr.hidden = !state.converted;
    $('progressDots').innerHTML = PLATFORMS.map((p) => `<i class="${p}${state.done.has(p) ? ' on' : ''}"></i>`).join('');
    $('progressText').textContent = state.done.size === 4 ? 'All 4 posted 🎉' : `${state.done.size} of 4 posted`;
    pr.classList.toggle('all', state.done.size === 4);
  }
  function showTab(p) {
    state.active = p;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.p === p)));
    document.querySelectorAll('.frame').forEach((f) => { f.hidden = f.dataset.p !== p; });
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove(); return ok;
    }
  }
  let snackT;
  function snack(msg) { const s = $('snack'); s.textContent = msg; s.hidden = false; clearTimeout(snackT); snackT = setTimeout(() => { s.hidden = true; }, 2200); }

  /* ---------------- events ---------------- */
  src.addEventListener('input', () => {
    updateCount();
    try { localStorage.setItem('rc.draft', src.value); } catch (e) { /* ignore */ }
    if (state.converted) { out.classList.add('is-stale'); $('stale').hidden = false; }
    schedulePush(1200);
  });
  src.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !convertBtn.disabled) convert(); });
  convertBtn.addEventListener('click', convert);
  $('reconvertBtn').addEventListener('click', convert);
  $('editBtn').addEventListener('click', () => { setLocked(false); src.focus(); schedulePush(); });
  $('clearBtn').addEventListener('click', () => { src.value = ''; updateCount(); src.focus(); });

  // Master reset: back to a blank page - post, versions, lock, progress, draft.
  // Sign-off settings are kept; they are configuration, not work in progress.
  function clearOutputs() {
    state.converted = null; state.done.clear(); state.active = 'wa';
    setLocked(false); out.hidden = true; outEmpty.hidden = false; out.classList.remove('is-stale'); $('stale').hidden = true;
    ['wa', 'ig', 'li', 'rd'].forEach((k) => { $(k + 'Preview').innerHTML = ''; $(k + 'Raw').textContent = ''; $(k + 'Raw').hidden = true; });
    $('rdTitle').textContent = '';
    document.querySelectorAll('.raw-toggle').forEach((b) => { b.textContent = 'Raw'; });
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-done'));
    document.querySelectorAll('.copy').forEach((b) => { b.classList.remove('is-copied'); b.textContent = b.dataset.label || b.textContent; });
    showTab('wa'); renderProgress();
  }
  function masterReset() {
    src.value = ''; try { localStorage.removeItem('rc.draft'); } catch (e) { /* ignore */ }
    clearOutputs(); updateCount(); window.scrollTo({ top: 0, behavior: 'smooth' }); src.focus();
    schedulePush();
    snack('Everything reset');
  }
  $('resetBtn').addEventListener('click', () => {
    if (!src.value.trim() && !state.converted) { snack('Already empty'); return; }
    if (confirm('Master reset? This clears the post, all four versions and the posted progress.')) masterReset();
  });
  $('pasteBtn').addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { src.value = t; src.dispatchEvent(new Event('input')); } }
    catch (e) { snack('Clipboard blocked — press Ctrl+V in the box'); src.focus(); }
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.p)));
  document.querySelectorAll('.raw-toggle').forEach((b) => b.addEventListener('click', () => {
    const pre = $(b.dataset.raw + 'Raw'); pre.hidden = !pre.hidden; b.textContent = pre.hidden ? 'Raw' : 'Hide raw';
  }));
  document.querySelectorAll('.copy').forEach((b) => {
    b.dataset.label = b.textContent;
    b.addEventListener('click', async () => {
      if (!state.converted) return;
      const k = b.dataset.copy; const p = k === 'rdTitle' ? 'rd' : k;
      const t = k === 'rdTitle' ? state.converted.rd.title : state.converted[k].text;
      if (!(await copyText(t))) { snack('Copy failed — use the Raw view and select it'); return; }
      b.classList.add('is-copied'); b.textContent = 'Copied ✓';
      setTimeout(() => { b.classList.remove('is-copied'); b.textContent = b.dataset.label; }, 1600);
      if (k !== 'rdTitle') { state.done.add(p); document.querySelector(`.tab[data-p="${p}"]`).classList.add('is-done'); renderProgress(); schedulePush(); }
      snack(k === 'rdTitle' ? 'Reddit title copied' : `${NAMES[p]} version copied — paste it in the app`);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.target === src || !state.converted) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key); if (i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) showTab(PLATFORMS[i]);
  });

  // Theme
  $('themeBtn').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('rc.theme', t); } catch (e) { /* ignore */ }
  });

  // Settings
  const S = { waFoot: 'sWaFoot', igFoot: 'sIgFoot', igLink: 'sIgLink', igTags: 'sIgTags', liFoot: 'sLiFoot', liTags: 'sLiTags' };
  const syncField = $('sSync');
  const fill = (obj) => Object.entries(S).forEach(([k, id]) => { $(id).value = obj[k] || ''; });
  $('settingsBtn').addEventListener('click', () => { fill(settings); syncField.value = sync.code; $('settingsScrim').hidden = false; $('sWaFoot').focus(); });
  $('sCancel').addEventListener('click', () => { $('settingsScrim').hidden = true; });
  $('settingsScrim').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('settingsScrim').hidden = true; });
  $('sReset').addEventListener('click', () => fill(DEFAULTS));
  $('sSave').addEventListener('click', () => {
    Object.entries(S).forEach(([k, id]) => { settings[k] = $(id).value; });
    try { localStorage.setItem('rc.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
    $('settingsScrim').hidden = true; snack('Settings saved');
    if (state.converted) convert(true);
    setSyncCode(syncField.value.trim());
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('settingsScrim').hidden = true; });

  /* ---------------- cross-device sync ----------------
     One JSON room per sync code on a Cloudflare Worker (worker/worker.js).
     The code never leaves the device: its SHA-256 is the room name. Every
     change (typing, convert, copy, unlock, reset) is pushed after a short
     debounce; the page pulls on load, on focus and every few seconds while
     visible. The Worker keeps a revision counter so a stale device gets the
     newer document instead of overwriting it. Outputs are not synced - they
     are recomputed from the source, which is deterministic. */
  const SYNC_URL = 'https://recast-sync.yourcardjourney.workers.dev/s/';
  const sync = { code: '', key: '', rev: 0, applying: false, timer: null, poll: null, state: 'off' };
  try { sync.code = localStorage.getItem('rc.sync') || ''; } catch (e) { /* ignore */ }
  const DEVICE = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'phone' : 'desktop';

  async function sha256(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('recast:' + s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function setSyncState(st, msg) {
    sync.state = st; const el = $('syncPill'); el.hidden = st === 'off'; el.dataset.state = st;
    $('syncText').textContent = msg || { ok: 'Synced', busy: 'Syncing\u2026', err: 'Offline', off: '' }[st];
  }
  function snapshot() {
    return { baseRev: sync.rev, src: src.value, locked: state.locked, converted: !!state.converted, done: [...state.done], device: DEVICE };
  }
  function schedulePush(ms) {
    if (!sync.key || sync.applying) return;
    clearTimeout(sync.timer); sync.timer = setTimeout(push, ms || 400);
  }
  async function push() {
    if (!sync.key || sync.applying) return;
    setSyncState('busy');
    try {
      const r = await fetch(SYNC_URL + sync.key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()) });
      const j = await r.json();
      if (r.status === 409) { apply(j); return; }
      if (!r.ok) throw new Error(j.error || r.status);
      sync.rev = j.rev; setSyncState('ok');
    } catch (e) { setSyncState('err'); }
  }
  async function pull(force) {
    if (!sync.key) return;
    try {
      const r = await fetch(SYNC_URL + sync.key, { cache: 'no-store' });
      if (r.status === 404) { if (force) push(); else setSyncState('ok'); return; }
      const j = await r.json();
      if (j.rev > sync.rev || force) apply(j); else setSyncState('ok');
    } catch (e) { setSyncState('err'); }
  }
  function apply(st) {
    sync.applying = true;
    try {
      if (st.src !== src.value) { src.value = st.src || ''; try { localStorage.setItem('rc.draft', src.value); } catch (e) { /* ignore */ } }
      updateCount();
      if (st.converted && src.value.trim()) {
        convert(true);
        (st.done || []).forEach((p) => { state.done.add(p); const t = document.querySelector(`.tab[data-p="${p}"]`); if (t) t.classList.add('is-done'); });
        renderProgress();
        if (!st.locked) setLocked(false);
      } else {
        clearOutputs();
      }
      sync.rev = st.rev || 0;
      setSyncState('ok', st.device && st.device !== DEVICE ? `Synced from ${st.device}` : 'Synced');
    } finally { sync.applying = false; }
  }
  async function setSyncCode(code) {
    const changed = code !== sync.code;
    sync.code = code; try { localStorage.setItem('rc.sync', code); } catch (e) { /* ignore */ }
    clearInterval(sync.poll); sync.poll = null;
    if (!code) { sync.key = ''; sync.rev = 0; setSyncState('off'); return; }
    if (!crypto.subtle) { setSyncState('err', 'Needs https'); return; }
    sync.key = await sha256(code);
    if (changed) sync.rev = 0;
    setSyncState('busy');
    // Joining a room: whatever is already there wins; an empty room gets this device's state.
    await pull(true);
    sync.poll = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 8000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('focus', () => pull());
  $('syncPill').addEventListener('click', () => { if (sync.state === 'err') pull(); else $('settingsBtn').click(); });

  updateCount();
  setSyncCode(sync.code);
})();
