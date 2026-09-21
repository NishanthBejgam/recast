/* ReCast emphasis engine.

   Decides, for any line of any post, what a reader's eye should land on.
   Nothing here is tied to one post: it works from the SHAPE of a line and the
   KINDS of token in it, not from a list of words it has seen before.

   Two layers:

   1. Line rules — some lines are one unit of meaning and get one treatment:
        headline            -> bold
        sub-heading ("So the play is:")           -> bold
        takeaway ("That's 25% savings.", "Net cost: ₹0", "TL;DR …") -> bold
        punchy line (≤ 6 words, "Grab it now!")   -> bold
        question hook ("Why does this matter?")   -> italic
        caveat ("Note: …", "T&C apply", "PS …")   -> italic
   2. Span rules — inside an ordinary sentence, candidate phrases are scored
      and the best non-overlapping ones win, under a budget so a sentence is
      never mostly bold:
        money, %, quantities, dates/deadlines, times     bold, high
        coupon-like tokens (SAVE10, FRESH200)            mono
        ALL-CAPS words (LIVE, BOGO, EORS)                bold
        proper nouns mid-sentence (Amazon Fresh, HDFC)   bold, low
        the tail of an arrow / equals chain (→ ₹100 net) bold
        "X vs Y" comparisons                             bold
        the verb phrase of an instruction ("Apply code") bold
        generic deal vocabulary (free, flat, instant…)   bold, low
        parentheticals, quotes, conditions ("only if…")  italic
      Adjacent bold spans merge, so "*flat* *10%* *off*" becomes "*flat 10% off*".

   The author's own *bold* / _italic_ in the source is kept exactly and never
   re-marked; everything around it still gets the treatment.

   Profiles: 'rich' (WhatsApp / Reddit — real bold, italic, mono) and 'light'
   (Instagram / LinkedIn — Unicode bold only, numbers and takeaways, no italic,
   because there is no real formatting there and too much 𝗨𝗻𝗶𝗰𝗼𝗱𝗲 reads badly). */
(function (global) {
  'use strict';

  const RX = {
    url: /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+|\b(?:amzn\.to|amzn\.in|bit\.ly|fkrt\.(?:it|cc)|myntr\.it|ajio\.me|tinyurl\.com|t\.co|cutt\.ly)\/[^\s<>()]+/gi,
    mention: /(^|[\s(])@[A-Za-z0-9_]{2,}/g,
    tag: /(^|[\s(])#[\p{L}\p{N}_]+/gu,
    author: /(^|[\s(])([*_~])([^*_~\n]+?)\2(?=[\s.,!?:;)]|$)/g,
    mono: /```[^`]+```|`[^`]+`/g,

    price: /(?:₹|Rs\.?\s?|INR\s?|\$|€|£)\s?\d+(?:,\d+)*(?:\.\d+)?(?:\s?(?:k|K|L|lakh|lakhs|cr|crore))?(?:\s?[×x]\s?\d+)?(?:\s?(?:cashback|cash back|instant discount|discount|off|instant|flat|extra|bonus|credit|reward|saved|savings|profit|net|per\s\w+))?/g,
    pct: /\b\d{1,3}(?:\.\d+)?\s?%(?:\s?(?:instant discount|instant cashback|extra off|off|cashback|cash back|CB|discount|extra|instant|flat|savings?|reward|interest|p\.?a\.?))?/gi,
    qty: /(?:[×x]\s?\d+|\b\d+(?:,\d{3})*\s?(?:[×x]|times)\b|\b\d+(?:,\d{3})*(?:\s[A-Za-z]+)?\s(?:orders?|accounts?|users?|cards?|txns?|transactions?|swipes?|days?|hours?|hrs|mins?|minutes?|weeks?|months?|years?|coins?|units?|pcs|pieces?|vouchers?|slots?|seats?|gm|grams?|kg|litres?|liters?|nights?|tickets?|rides?|km|steps?))\b/gi,
    date: /\b(?:\d{1,2}(?:st|nd|rd|th)?\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*(?:,?\s\d{4})?\b|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s(?:\d{4}|\d{1,2}(?:st|nd|rd|th)?(?:,?\s\d{4})?)\b|(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?\b|today(?:\sonly)?|tonight|tomorrow|midnight|this weekend|last day|ends? (?:today|tonight|soon)|\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b)/g,
    codeTok: /\b(?=[A-Z0-9]{5,14}\b)(?=[A-Z0-9]*\d)[A-Z]{2,}[A-Z0-9]*\b|(?<=\b(?:code|coupon|promo|voucher)\s?[:\-–]?\s)[A-Z][A-Z0-9]{3,}\b/gi, // SAVE10, or anything after "code"
    ratio: /\b\d+(?:\.\d+)?\s?:\s?\d+(?:\.\d+)?\b/g,                                     // 5:2, 1:1
    caps: /\b[A-Z][A-Z]{2,}(?:\s[A-Z]{2,})?\b/g,                                     // LIVE, BOGO, EORS
    proper: /\b[A-Z][a-zA-Z0-9&']*(?:\s[A-Z][a-zA-Z0-9&']*){0,2}/g,
    cmp: /\b(\S+(?:\s\S+){0,3})\s(?:vs\.?|versus)\s(\S+(?:\s\S+){0,3})/gi,
    hot: /\b(?:LIVE(?:\snow)?|is live|now live|free(?:\sdelivery|\sshipping)?|flat|instant discount|cashback|cash back|no[-\s]cost EMI|buy\s\d\sget\s\d|BOGO|limited (?:time|stock|period)|expir(?:es|ing|y)|valid (?:till|until|on)|lowest (?:ever|price)|all[-\s]time low|price drop|stackable|extra (?:\d+%\s)?off|per (?:account|card|user|order|month)|max(?:imum)?(?:\scap)?|min(?:imum)?(?:\sorder|\sspend)?|first (?:\d+\s)?(?:orders?|users?|time)|new users?|exclusive|unlimited|lifetime free|zero (?:fee|cost|forex)|no (?:fee|charges?|minimum)|guaranteed|best (?:rate|deal|price)|effectively free|net free)\b/gi,

    paren: /\(([^()]{3,90})\)/g,
    quote: /["“]([^"”\n]{3,120})["”]/g,
    cond: /\b((?:only\s)?(?:if|unless|provided|except|excluding|excl\.|not valid|valid only|subject to|T&Cs?(?:\sapply)?|terms apply|while stocks? last|till stocks? last|as long as|assuming)\b[^.;!?)\n]{0,80})/gi,

    takeaway: /^(?:so|net|net net|effectively|effective|total|result|bottom line|tl;?dr|verdict|summary|in short|basically|that'?s|that is|which means|meaning|i\.e\.|=>|=|→|➜|➡️)\b/i,
    caveat: /^(?:note|ps|p\.s\.|nb|t&cs?|terms|disclaimer|caveat|fine print|remember|warning|⚠️|caution|fyi|edit|update)\b/i,
    imperative: /^(use|apply|add|buy|pay|grab|order|book|redeem|claim|load|stack|convert|swipe|tap|click|open|enable|activate|register|check|compare|avoid|skip|don'?t|do not|get|earn|save|spend|shop|choose|select|pick|go|visit|download|install|link|set|turn|keep|try|hold|sell|wait|make|combine|pair|split|top[-\s]?up|recharge|transfer|withdraw|invest|cancel|ask|call|mail|email|message|dm|share|follow|subscribe|watch|read|bookmark)\b((?:\s(?!(?:at|on|in|for|with|to|via|from|before|after|and|or|the|a|an)\b)[A-Za-z'-]+){0,3})/i,
    prep: /^(?:at|on|in|for|with|to|via|from|before|after|and|or|the|a|an)$/i,
  };

  const STOP_WORDS = new Set(['The', 'This', 'That', 'These', 'Those', 'If', 'So', 'But', 'And', 'Or', 'Because', 'Note', 'Why', 'How', 'What', 'When', 'Where', 'Which', 'Who', 'Do', 'Not', 'Yes', 'No', 'Then', 'Now', 'Here', 'There', 'It', 'Its', 'I', 'My', 'You', 'Your', 'We', 'Our', 'They', 'Their', 'He', 'She', 'One', 'Also', 'Just', 'Only', 'Even', 'Still', 'Verdict', 'Result', 'Net', 'Total', 'Effective', 'Effectively', 'Basically', 'Meaning', 'Use', 'Apply', 'Buy', 'Pay', 'Get', 'Grab', 'Stack', 'Go', 'Add', 'Check', 'Avoid', 'Skip', 'Remember', 'Update', 'Edit', 'Save', 'Earn', 'Spend', 'Book', 'Order', 'Load', 'Redeem', 'Claim', 'Free', 'Flat', 'Extra', 'Max', 'Min', 'Valid', 'Offer', 'Deal', 'Code', 'Coupon', 'Cashback', 'Discount', 'Card', 'Cards', 'Bank', 'Gift', 'Sale', 'Live', 'New', 'Old', 'Big', 'Small', 'Best', 'Worst', 'Good', 'Bad', 'Every', 'All', 'Any', 'Some', 'Most', 'Many', 'Few', 'First', 'Last', 'Next', 'Same', 'Other', 'Another', 'Each', 'Both', 'Either', 'Neither', 'Effective', 'Miles', 'Points', 'Rewards', 'Reward', 'Fee', 'Fees', 'Rate', 'Rates', 'Price', 'Prices', 'Limited', 'Lowest', 'Highest', 'Instant', 'Today', 'Tomorrow', 'Tonight', 'Yesterday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec', 'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  const STOP_CAPS = new Set(['THE', 'AND', 'FOR', 'YOU', 'ARE', 'NOT', 'BUT', 'ALL', 'ANY', 'CAN', 'GET', 'NOW', 'NEW', 'PS', 'NB', 'OK', 'AM', 'PM', 'URL', 'FAQ', 'ETC', 'IMO', 'FYI', 'LOL', 'RT']);

  const wordCount = (s) => (s.trim().match(/\S+/g) || []).length;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- Unicode bold/italic for platforms with no real formatting ----
  function uniBold(s) {
    return [...s].map((ch) => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D5D4 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D5EE + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7EC + c - 48);
      return ch;
    }).join('');
  }
  function uniItalic(s) {
    return [...s].map((ch) => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D608 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D622 + c - 97);
      return ch;
    }).join('');
  }

  const PROFILES = {
    rich: { budget: 0.45, maxSpans: 5, italics: true, classes: null },
    light: { budget: 0.3, maxSpans: 3, italics: false, classes: new Set(['price', 'pct', 'qty', 'date', 'tail', 'caps']) },
  };
  const FORMATS = {
    whatsapp: { b: (s) => `*${s}*`, i: (s) => `_${s}_`, c: (s) => '```' + s + '```' },
    reddit: { b: (s) => `**${s}**`, i: (s) => `*${s}*`, c: (s) => '`' + s + '`' },
    unicode: { b: uniBold, i: uniItalic, c: (s) => s },
    plain: { b: (s) => s, i: (s) => s, c: (s) => s },
  };

  /* ---------- the engine ---------- */
  function emphasize(line, F, opts) {
    opts = opts || {};
    const P = PROFILES[opts.profile || 'rich'];
    const kind = opts.kind || 'text';
    const raw = line;
    if (!raw.trim()) return raw;

    // Whole-line decisions first. `plainLine` is the line with the author's stars removed,
    // because a whole-line style can't nest them.
    const plainLine = raw.replace(RX.author, (m, pre, mark, inner) => pre + inner);
    const words = wordCount(plainLine);
    const endsColon = /:$/.test(plainLine) && !/https?:$/.test(plainLine);

    if (kind === 'head') return F.b(plainLine);
    if (RX.caveat.test(plainLine) && P.italics) return F.i(plainLine);
    if (/\?$/.test(plainLine) && words <= 16 && P.italics) return F.i(plainLine);
    if (endsColon && plainLine.length <= 48) return F.b(plainLine);
    if (RX.takeaway.test(plainLine) && words <= 12 && !/,/.test(plainLine.slice(0, 12))) return F.b(plainLine);
    if (words <= 6 && !/[,;]/.test(plainLine) && (/!$/.test(plainLine) || !/[.?]$/.test(plainLine)) && kind !== 'kv' && !hasUrl(plainLine) && !/\b(?:code|coupon|promo|voucher)\b/i.test(plainLine)) return F.b(plainLine);

    return spans(raw, F, P, kind);
  }
  const hasUrl = (s) => { RX.url.lastIndex = 0; const r = RX.url.test(s); RX.url.lastIndex = 0; return r; };

  function spans(line, F, P, kind) {
    // 1. Protect what must never be touched: author spans, code, urls, @mentions, #tags.
    const keep = [];
    const hold = (s) => { keep.push(s); return `${keep.length - 1}`; };
    let t = line;
    t = t.replace(RX.mono, (m) => hold(m));
    t = t.replace(RX.author, (m, pre, mark, inner) => pre + hold(mark === '*' ? F.b(inner) : mark === '_' ? F.i(inner) : m.slice(pre.length)));
    t = t.replace(RX.url, (m) => hold(m));
    t = t.replace(RX.mention, (m, pre) => pre + hold(m.slice(pre.length)));
    t = t.replace(RX.tag, (m, pre) => pre + hold(m.slice(pre.length)));

    // 2. Candidates: {s, e, score, cls, style}
    const cands = [];
    const add = (rx, cls, score, style, pick) => {
      rx.lastIndex = 0; let m;
      while ((m = rx.exec(t))) {
        let s = m.index, e = m.index + m[0].length, text = m[0];
        if (pick) { const r = pick(m); if (!r) continue; s = m.index + m[0].indexOf(r); e = s + r.length; text = r; }
        if (/\uE00[01]/.test(text)) continue;                 // crosses a protected token
        if (P.classes && !P.classes.has(cls)) continue;
        if (!text.trim()) continue;
        cands.push({ s, e, score, cls, style: style || 'b' });
        if (m[0].length === 0) rx.lastIndex++;
      }
    };
    add(RX.price, 'price', 3.2);
    add(RX.pct, 'pct', 3.1);
    add(RX.date, 'date', 2.6);
    add(RX.qty, 'qty', 2.4);
    add(RX.codeTok, 'code', 3.5, 'c', (m) => (/[a-z]/.test(m[0]) ? null : m[0]));
    add(RX.ratio, 'qty', 2.2);
    add(RX.caps, 'caps', 2.2, 'b', (m) => (STOP_CAPS.has(m[0].replace(/\s.*/, '')) ? null : m[0]));
    add(RX.cmp, 'cmp', 2.3);
    add(RX.hot, 'hot', 1.6);
    add(RX.proper, 'proper', 1.2, 'b', (m) => {
      // Not at the start of a sentence, and at least one word that is a real name.
      const before = t.slice(0, m.index);
      let parts = m[0].split(' ');
      // The first word of a sentence is capitalised for grammar, not because it is a name.
      if (!before.trim() || /[.!?:;]\s*$/.test(before) || /(?:^|\s)[—–-]\s*$/.test(before)) parts.shift();
      if (!parts.some((w) => !STOP_WORDS.has(w) && !/^[A-Z]{2,}$/.test(w))) return null;
      // trim stop words off both ends of the run
      while (parts.length && STOP_WORDS.has(parts[0])) parts.shift();
      while (parts.length && STOP_WORDS.has(parts[parts.length - 1])) parts.pop();
      const r = parts.join(' ');
      return r.length >= 3 ? r : null;
    });
    // Tail of a chain: "A → B → ₹100 net" / "₹500 × 4 = ₹2,000"
    const tailAt = Math.max(t.lastIndexOf('→'), t.lastIndexOf('➜'), t.lastIndexOf('=>'), t.lastIndexOf(' = '));
    if (tailAt > 0) {
      const after = t.slice(tailAt).replace(/^(?:→|➜|=>|\s=\s)\s*/, '');
      const tail = after.replace(/[.!]+$/, '');
      if (tail && wordCount(tail) <= 7 && !/\uE00[01]/.test(tail)) cands.push({ s: t.length - after.length, e: t.length - after.length + tail.length, score: 2.8, cls: 'tail', style: 'b' });
    }
    // Verb phrase of an instruction / step
    if ((kind === 'bullet' || kind === 'text') && !P.classes) {
      const m = t.match(RX.imperative);
      if (m && /\s/.test(m[0].trim())) cands.push({ s: 0, e: m[0].length, score: 2.0, cls: 'verb', style: 'b' });
    }
    if (P.italics) {
      add(RX.paren, 'paren', 1.5, 'i', (m) => m[1]);
      add(RX.quote, 'quote', 1.3, 'i', (m) => m[1]);
      add(RX.cond, 'cond', 1.4, 'i', (m) => m[1].replace(/\s+$/, ''));
    }

    // 3. Pick: best first, no overlaps, bold budget.
    cands.sort((a, b) => b.score - a.score || a.s - b.s);
    const total = wordCount(t.replace(/\d+/g, 'x'));
    const budget = Math.max(2, Math.round(total * P.budget));
    let boldWords = 0, boldSpans = 0;
    const chosen = [], blocked = [];
    // Only prose words count against the budget - a figure is never "too much bold".
    const proseWords = (x) => (x.match(/\S+/g) || []).filter((w) => /[a-z]{2,}/i.test(w) && !/\d/.test(w)).length;
    for (const c of cands) {
      if (chosen.some((k) => c.s < k.e && k.s < c.e)) continue;
      if (blocked.some((k) => c.s >= k.s && c.e <= k.e)) continue;   // a weaker piece of something already rejected
      const w = proseWords(t.slice(c.s, c.e));
      if (c.style === 'b') {
        if (boldSpans >= P.maxSpans || (boldWords + w > budget && chosen.length)) { blocked.push(c); continue; }
        boldWords += w; boldSpans++;
      }
      chosen.push(c);
    }

    // 4. Apply from the right so offsets stay valid, then restore protected tokens.
    chosen.sort((a, b) => b.s - a.s);
    for (const c of chosen) {
      const inner = t.slice(c.s, c.e);
      const trimmed = inner.replace(/^\s+|\s+$/g, '');
      const lead = inner.slice(0, inner.indexOf(trimmed)); const trail = inner.slice(lead.length + trimmed.length);
      t = t.slice(0, c.s) + lead + F[c.style](trimmed) + trail + t.slice(c.e);
    }
    t = mergeAdjacent(t, F);
    return t.replace(/(\d+)/g, (_, i) => keep[+i]);
  }

  // "*flat* *10% off*" -> "*flat 10% off*" (only when the format has real markers)
  function mergeAdjacent(t, F) {
    const [open, close] = F.b('').split('');
    if (!open || !close) return t;
    const rx = new RegExp(esc(close) + ' ' + esc(open), 'g');
    let prev; do { prev = t; t = t.replace(rx, ' '); } while (t !== prev);
    return t;
  }

  global.RCEmph = { emphasize, FORMATS, uniBold, uniItalic };
})(typeof window !== 'undefined' ? window : globalThis);
