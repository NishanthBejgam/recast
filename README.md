# ReCast — one post, every channel

Live: **https://recast.yourcardjourney.store**

Paste the post you wrote for X on the left, press **Convert**, and the right pane
shows the same post the way WhatsApp, Instagram, LinkedIn and Reddit each expect it —
drawn inside a mock of that platform so you always know which one you are copying for.

Everything runs in the browser. Nothing is uploaded; the draft and your sign-off
settings live in `localStorage` on your own device.

## What each version does

| Platform  | Formatting applied |
|-----------|--------------------|
| WhatsApp  | `*bold*` headline and labels, `*₹ / %*` figures, coupon codes in ```` ```mono``` ````, links on their own `👉` line, hashtags dropped, italic sign-off |
| Instagram | No links (replaced with "🔗 Link in bio"), `Label ➜ value`, `✔️` bullets, sign-off, then `. . .` and up to 30 hashtags (yours + defaults) |
| LinkedIn  | 𝗨𝗻𝗶𝗰𝗼𝗱𝗲-𝗯𝗼𝗹𝗱 hook line, `→` bullets, links kept, sign-off, at most 5 hashtags |
| Reddit    | Separate **title** (emoji and tags stripped) and Markdown **body**: `Label: value` runs become a table, `**bold**` figures, `` `CODE` ``, no hashtags, no sign-off |

The parser recognises: the first line as the headline, `Label: value` lines,
bullet lines (`-`, `•`, `✅`, `1.` …), bare link lines, hashtag-only lines,
`₹ / Rs / %` amounts and `Code: XXXX` coupons. `Ctrl+Enter` converts; keys `1–4`
switch tabs once converted.

## Files

- `index.html`, `style.css`, `app.js` — the whole app, no build step
- `favicon.svg`, `yourcardjourney.png` — branding
- `CNAME` — custom domain for GitHub Pages (do not delete)

## Deploy

GitHub Pages serves `main` at `/`. Push to `main` and it is live in about a minute.
