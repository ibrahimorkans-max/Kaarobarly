// Tijar public website. Content comes from the SaaS owner (SaaS admin → Website), embedded in the page.
const C = JSON.parse(document.getElementById('content').textContent);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ------------------------------------------------------------------ brand geometry (same as the app)
const MARK = {
  stem: 'M80 113 C132 112 178 96 236 58 L244 68 C200 104 162 120 160 160 L160 200 C160 226 142 242 114 242 L80 242 Z',
  leaf: 'M18 106 C30 78 52 57 84 56 L158 56 C180 56 194 46 208 30 L232 52 C192 90 150 104 96 106 Z',
  arrow: 'M266 0 L252 74 L192 20 Z',
};
const WORD = [
  'M0 0 H92 V24 H58 V100 H34 V24 H0 Z',
  'M106 0 H130 V100 H106 Z',
  'M186 0 H210 V64 C210 87 195 100 172 100 H148 V77 H168 C180 77 186 71 186 61 Z',
  'M226 100 L266 0 H294 L334 100 H308 L280 28 L252 100 Z',
  'M350 0 H400 C426 0 442 15 442 38 C442 55 432 67 417 72 L446 100 H414 L389 75 H374 V100 H350 Z M374 23 V52 H398 C410 52 417 47 417 38 C417 28 410 23 398 23 Z',
];
let gid = 0;
function markSvg(cls = 'mark') {
  const id = `m${++gid}`;
  return `<svg class="${cls}" viewBox="-8 -12 282 282" aria-hidden="true"><defs>
    <linearGradient id="${id}l" x1="18" y1="0" x2="222" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2BD8B0"/><stop offset="1" stop-color="#14AE8B"/></linearGradient>
    <linearGradient id="${id}s" x1="92" y1="240" x2="214" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#BFF3E5"/><stop offset="1" stop-color="#19B892"/></linearGradient>
    <linearGradient id="${id}a" x1="200" y1="66" x2="264" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#19B892"/><stop offset="1" stop-color="#2BD8B0"/></linearGradient></defs>
    <path d="${MARK.stem}" fill="url(#${id}s)"/><path d="${MARK.leaf}" fill="url(#${id}l)"/><path d="${MARK.arrow}" fill="url(#${id}a)"/></svg>`;
}
const wordSvg = (cls = 'word') => `<svg class="${cls}" viewBox="0 0 446 100" aria-label="Tijar"><g fill="#fff">${WORD.map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join('')}</g><path d="M280 60 L296 100 H264 Z" fill="#19B892"/></svg>`;

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safe = (u) => (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');
const ext = (u) => (/^https?:\/\//i.test(u || '') ? ' target="_blank" rel="noopener"' : '');
const money = (minor) => `Rs ${Math.round(minor / 100).toLocaleString('en-PK')}`;
const on = (k) => C.sections?.[k] !== false;

const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  invoice: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
  pos: I('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 9h4"/>'),
  stock: I('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
  chart: I('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>'),
  team: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.5 3.6-5 7-5s6.2 1.5 7 5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.6.2 4.4 1.6 5 4"/>'),
  cloud: I('<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/><path d="M9 14l2 2 4-4"/>'),
  shield: I('<path d="M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  ai: I('<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  print: I('<path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v8H6z"/>'),
  whatsapp: I('<path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 9.5c.3 2 2.4 4.2 4.6 4.6l1.2-1.2 2 1-.6 1.8c-3.6.4-8-3.9-7.6-7.6l1.8-.6 1 2z"/>'),
  shop: I('<path d="M4 9l1-5h14l1 5"/><path d="M4 9h16v11H4zM9 20v-6h6v6"/>'),
  bell: I('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  wallet: I('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 1 3"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>'),
  bolt: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  heart: I('<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>'),
  check: I('<path d="M5 12l5 5 9-10"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  android: I('<path d="M5 10h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M5 10a7 7 0 0 1 14 0M8 4l1.5 2.5M16 4l-1.5 2.5M9 7.5h.01M15 7.5h.01"/>'),
  windows: I('<path d="M3 5.5l7.5-1v7H3zM13 4.2L21 3v8.5h-8zM3 13h7.5v7l-7.5-1zM13 13h8v8l-8-1.2z"/>'),
  mail: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  phone: I('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>'),
  pin: I('<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  facebook: I('<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v7h4v-7h3l1-4h-4V8z"/>'),
  instagram: I('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>'),
  linkedin: I('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 10v7M7 7h.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7"/>'),
  youtube: I('<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>'),
  x2: I('<path d="M4 4l16 16M20 4L4 20"/>'),
  tiktok: I('<path d="M14 3v11a4 4 0 1 1-4-4"/><path d="M14 3c.5 2.8 2.4 4.6 5 5"/>'),
};

// ------------------------------------------------------------------ page
function page() {
  const h = C.hero;
  const words = (s, delay) => esc(s).split(' ').map((w, i) => `<span class="w" style="animation-delay:${(delay + i * 0.08).toFixed(2)}s">${w}</span>`).join(' ');
  const navLinks = [
    on('features') && ['#features', 'Features'],
    on('showcase') && ['#how', 'How it works'],
    on('pricing') && ['#pricing', 'Pricing'],
    on('faq') && ['#faq', 'FAQ'],
    on('contact') && ['#contact', 'Contact'],
  ].filter(Boolean);
  const parts = [];

  if (C.announcement?.show && C.announcement.text)
    parts.push(`<a class="announce" href="${safe(C.announcement.href || '#')}"${ext(C.announcement.href)}><b>NEW</b><span>${esc(C.announcement.text)}</span></a>`);

  parts.push(`<header class="nav" id="nav"><div class="wrap">
    <a class="brand" href="#top" aria-label="Tijar home">${markSvg()}${wordSvg()}</a>
    <nav class="links" id="links">${navLinks.map(([href, t]) => `<a href="${href}">${t}</a>`).join('')}</nav>
    <a class="btn primary small cta-nav" href="${safe(h.primary.href || '#download')}"${ext(h.primary.href)}>${esc(h.primary.label || 'Start free')}</a>
    <button class="burger" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="links"><span></span><span></span><span></span></button>
  </div></header>`);

  parts.push(`<section class="hero" id="top">
    <canvas id="hero3d" aria-hidden="true"></canvas>
    ${markSvg('static-mark')}
    <div class="wrap"><div class="hero-copy">
      ${h.eyebrow ? `<span class="pill"><i>✦</i>${esc(h.eyebrow)}</span>` : ''}
      <h1>${words(h.title, 0.2)} <span class="hl">${words(h.highlight, 0.5)}</span></h1>
      <p class="lead reveal" style="--d:.7s">${esc(h.subtitle)}</p>
      <div class="cta-row reveal" style="--d:.85s">
        ${h.primary.label ? `<a class="btn primary" href="${safe(h.primary.href)}"${ext(h.primary.href)}>${esc(h.primary.label)} ${ICON.arrow}</a>` : ''}
        ${h.secondary.label ? `<a class="btn ghost" href="${safe(h.secondary.href)}"${ext(h.secondary.href)}>${esc(h.secondary.label)}</a>` : ''}
      </div>
      <div class="trust reveal" style="--d:1s"><span>${ICON.cloud}Works offline</span><span>${ICON.shield}Daily backups</span><span>${ICON.globe}English · اردو</span></div>
    </div></div>
    <a class="scroll-cue" href="#features" aria-label="Scroll down"></a>
  </section>`);

  if (on('stats') && C.stats?.length)
    parts.push(`<div class="wrap stats">${C.stats.map((s, i) => `<div class="stat reveal" style="--d:${i * 0.08}s"><b data-count="${esc(s.value)}">${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>`);

  if (on('features') && C.features?.length)
    parts.push(`<section class="block" id="features"><div class="wrap">
      <div class="head reveal"><span class="kicker">Everything in one app</span><h2 class="title">Run the whole business <span class="grad">from your pocket.</span></h2><p class="sub">Every tool a growing business needs, connected so a sale updates your stock, cash and reports at once.</p></div>
      <div class="grid3">${C.features.map((f, i) => `<article class="card tilt reveal" style="--d:${(i % 3) * 0.08}s"><div class="ic">${ICON[f.icon] || ICON.bolt}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join('')}</div>
    </div></section>`);

  if (on('showcase')) {
    const st = [
      ['Sell at the counter', 'Scan a barcode or tap an item, take cash, card or wallet payments and print the receipt. Works even when the internet does not.'],
      ['Every rupee in its place', 'Payments, expenses, cheques and installments land in the right account, and your cash book balances itself.'],
      ['See where you are growing', 'Profit, best sellers and slow stock at a glance, with alerts before small problems get expensive.'],
    ];
    parts.push(`<section class="block showcase" id="how"><div class="wrap stick">
      <div><span class="kicker">How it works</span>
        <div class="steps-copy">${st.map(([t, p], i) => `<article class="${i ? '' : 'on'}"><div class="num">0${i + 1} / 03</div><h2 class="title">${esc(t)}</h2><p class="sub">${esc(p)}</p></article>`).join('')}</div>
        <div class="progress">${st.map(() => '<i><b></b></i>').join('')}</div>
      </div>
      <div class="stage" id="stage">
        <div class="device" id="device">
          <div class="glow"></div>
          <div class="side r"></div><div class="side l"></div><div class="side t"></div><div class="side b"></div>
          <div class="face back">${markSvg()}</div>
          <div class="face front"><div class="screen">
            <div class="notch"></div>
            <div class="bal"><small>OUTSTANDING BALANCE</small><b>Rs 88,200</b><div class="bar"><i></i></div></div>
            <div class="tiles"><div class="tile"><b>Rs 159,034</b><span>Total invoiced</span></div><div class="tile"><b>Rs 70,834</b><span>Received</span></div></div>
            <div class="chart">${[40, 62, 48, 75, 58, 88, 96].map((v, i) => `<i style="height:${v}%;animation-delay:${i * 0.08}s"></i>`).join('')}</div>
            <div class="row"><span>INV-1024 · Ahmed Store</span><em>Paid</em></div>
            <div class="row"><span>POS sale · 3 items</span><em>Rs 2,450</em></div>
          </div></div>
        </div>
        <div class="chip" data-depth="1.2" style="left:2%;top:18%"><i>${ICON.check}</i>Invoice paid · Rs 12,500</div>
        <div class="chip" data-depth="0.8" style="right:0;top:40%"><i>${ICON.print}</i>Receipt printed</div>
        <div class="chip" data-depth="1.5" style="left:6%;bottom:16%"><i>${ICON.stock}</i>Low stock: Cooking oil</div>
      </div>
    </div></section>`);
  }

  if (on('businessTypes') && C.businessTypes?.length)
    parts.push(`<section class="block" id="types"><div class="wrap">
      <div class="head center reveal"><span class="kicker">Made for your kind of business</span><h2 class="title">One app, <span class="grad">shaped to fit.</span></h2><p class="sub">Pick your business type and Tijar switches on the right tools and uses your words. Drag to spin.</p></div>
      <div class="ring-stage reveal" id="ringStage"><div class="ring-floor"></div><div class="ring" id="ring">${C.businessTypes.map((b, i) => `<div class="rc"><span class="big">0${i + 1}</span><h3>${esc(b.name)}</h3><p>${esc(b.text)}</p></div>`).join('')}</div></div>
    </div></section>`);

  if (on('steps') && C.steps?.length)
    parts.push(`<section class="block" id="start"><div class="wrap">
      <div class="head reveal"><span class="kicker">Get going in minutes</span><h2 class="title">Three steps to <span class="grad">your first sale.</span></h2></div>
      <div class="steps">${C.steps.map((s, i) => `<div class="step card reveal" style="--d:${i * 0.1}s"><div class="cube-wrap"><div class="cube">${'<b>N</b>'.repeat(6).replaceAll('N', i + 1)}</div></div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join('')}</div>
    </div></section>`);

  if (on('pricing') && C.plans?.length) {
    const lim = (l) => [
      [`${l.users >= 50 ? '50+' : l.users} user${l.users === 1 ? '' : 's'}`, true],
      [`${l.businesses} business${l.businesses === 1 ? '' : 'es'}`, true],
      [l.invoicesPerMonth >= 100000 ? 'Unlimited invoices' : `${l.invoicesPerMonth.toLocaleString('en-PK')} invoices a month`, true],
      [l.aiPerMonth ? `${l.aiPerMonth.toLocaleString('en-PK')} AI requests` : 'Smart assistant', !!l.aiPerMonth],
      ['Payroll and staff', l.payroll],
    ];
    parts.push(`<section class="block" id="pricing"><div class="wrap">
      <div class="head center reveal"><span class="kicker">Pricing</span><h2 class="title">${esc(C.pricing.title)}</h2><p class="sub">${esc(C.pricing.subtitle)}</p></div>
      <div class="plans">${C.plans.map((p, i) => {
        const hot = p.id === C.pricing.highlight;
        return `<article class="card plan tilt reveal${hot ? ' hot' : ''}" style="--d:${i * 0.08}s">
          ${hot ? '<span class="tag">MOST POPULAR</span>' : ''}
          <h3>${esc(p.name)}</h3>
          <div class="price">${p.price ? money(p.price) : 'Free'}${p.price ? '<small> /month</small>' : ''}</div>
          <div class="hint">${esc(p.hint)}</div>
          <ul>${lim(p.limits).map(([t, ok]) => `<li class="${ok ? '' : 'off'}">${ok ? ICON.check : ICON.x}${esc(t)}</li>`).join('')}</ul>
          <a class="btn ${hot ? 'primary' : 'ghost'}" href="#contact" data-plan="${esc(p.id)}">${p.price ? 'Choose ' + esc(p.name) : 'Start free'}</a>
        </article>`;
      }).join('')}</div>
      ${C.pricing.note ? `<p class="note">${esc(C.pricing.note)}</p>` : ''}
    </div></section>`);
  }

  if (on('testimonials') && C.testimonials?.length) {
    const q = (t) => `<figure class="quote"><div class="stars">★★★★★</div><p>“${esc(t.quote)}”</p><figcaption class="who"><span class="av">${esc((t.name || '?').trim()[0] || '?')}</span><span><b>${esc(t.name)}</b><span>${esc(t.role)}</span></span></figcaption></figure>`;
    const row = (list) => { const a = list.length < 4 ? [...list, ...list, ...list] : list; return a.map(q).join('') + a.map(q).join(''); };
    const half = Math.ceil(C.testimonials.length / 2);
    const second = C.testimonials.length > 3 ? C.testimonials.slice(half) : [...C.testimonials].reverse();
    parts.push(`<section class="block" id="love"><div class="wrap"><div class="head center reveal"><span class="kicker">Loved by owners</span><h2 class="title">Businesses that <span class="grad">moved smarter.</span></h2></div></div>
      <div class="marquee reveal"><div class="track" style="--t:48s">${row(C.testimonials.length > 3 ? C.testimonials.slice(0, half) : C.testimonials)}</div><div class="track rev" style="--t:56s">${row(second)}</div></div>
    </section>`);
  }

  if (on('faq') && C.faq?.length)
    parts.push(`<section class="block" id="faq"><div class="wrap">
      <div class="head center reveal"><span class="kicker">FAQ</span><h2 class="title">Questions, <span class="grad">answered.</span></h2></div>
      <div class="faq">${C.faq.map((f, i) => `<details class="reveal" style="--d:${i * 0.05}s"${i ? '' : ' open'}><summary>${esc(f.q)}<i>+</i></summary><div class="ans">${esc(f.a)}</div></details>`).join('')}</div>
    </div></section>`);

  if (on('download')) {
    const d = C.download;
    const stores = [
      d.android && `<a class="store" href="${safe(d.android)}"${ext(d.android)}>${ICON.android}<span><small>Download for</small><b>Android</b></span></a>`,
      d.windows && `<a class="store" href="${safe(d.windows)}"${ext(d.windows)}>${ICON.windows}<span><small>Download for</small><b>Windows</b></span></a>`,
      d.web && `<a class="store" href="${safe(d.web)}"${ext(d.web)}>${ICON.globe}<span><small>Open in your</small><b>Browser</b></span></a>`,
    ].filter(Boolean);
    parts.push(`<section class="block" id="download"><div class="wrap"><div class="download reveal">
      <canvas id="orb3d" aria-hidden="true"></canvas>
      <div class="inner"><span class="kicker">Get started</span><h2 class="title">${esc(d.title)}</h2><p class="sub">${esc(d.subtitle)}</p>
        <div class="stores">${stores.length ? stores.join('') : `<a class="btn primary" href="#contact">Request access ${ICON.arrow}</a>`}</div></div>
    </div></div></section>`);
  }

  if (on('contact')) {
    const c = C.contact;
    const wa = (c.whatsapp || '').replace(/\D/g, '').replace(/^0/, '92');
    const info = [
      c.whatsapp && `<a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i>${ICON.whatsapp}</i><span><small>WhatsApp</small>${esc(c.whatsapp)}</span></a>`,
      c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}"><i>${ICON.phone}</i><span><small>Call</small>${esc(c.phone)}</span></a>`,
      c.email && `<a href="mailto:${esc(c.email)}"><i>${ICON.mail}</i><span><small>Email</small>${esc(c.email)}</span></a>`,
      c.address && `<div><i>${ICON.pin}</i><span><small>Visit</small>${esc(c.address)}</span></div>`,
    ].filter(Boolean);
    parts.push(`<section class="block" id="contact"><div class="wrap contact">
      <div class="reveal"><span class="kicker">Contact</span><h2 class="title">${esc(c.title)}</h2><p class="sub">${esc(c.subtitle)}</p>${info.length ? `<div class="info">${info.join('')}</div>` : ''}</div>
      <form class="lead card reveal" id="leadForm" novalidate>
        <label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
        <label>Business name<input name="business" maxlength="120" autocomplete="organization"></label>
        <label>Phone / WhatsApp<input name="phone" maxlength="40" inputmode="tel" autocomplete="tel"></label>
        <label>Email<input name="email" type="email" maxlength="120" autocomplete="email"></label>
        <label class="full">Interested in<select name="plan"><option value="">Not sure yet</option>${(C.plans || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.price ? ' · ' + money(p.price) + '/month' : ''}</option>`).join('')}</select></label>
        <label class="full">Message<textarea name="message" maxlength="1000" placeholder="Tell us about your business"></textarea></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="msg" id="leadMsg" role="status"></div>
        <button class="btn primary full" type="submit">Send ${ICON.arrow}</button>
      </form>
    </div></section>`);
  }

  const s = C.social || {};
  const socials = [['facebook', s.facebook], ['instagram', s.instagram], ['linkedin', s.linkedin], ['youtube', s.youtube], ['x2', s.x], ['tiktok', s.tiktok]].filter(([, u]) => u);
  parts.push(`<footer><div class="wrap">
    <div class="cols">
      <div><a class="brand" href="#top">${markSvg()}${wordSvg()}</a><p class="sub" style="margin-top:16px;font-size:16px">${esc(C.seo.description)}</p>
        ${socials.length ? `<div class="social">${socials.map(([k, u]) => `<a href="${safe(u)}" target="_blank" rel="noopener" aria-label="${k === 'x2' ? 'X' : k}">${ICON[k]}</a>`).join('')}</div>` : ''}</div>
      <div><h4>Product</h4><ul>${navLinks.map(([href, t]) => `<li><a href="${href}">${t}</a></li>`).join('')}</ul></div>
      <div><h4>Get the app</h4><ul>${[C.download.android && ['Android', C.download.android], C.download.windows && ['Windows', C.download.windows], C.download.web && ['Web app', C.download.web]].filter(Boolean).map(([t, u]) => `<li><a href="${safe(u)}"${ext(u)}>${t}</a></li>`).join('') || '<li><a href="#contact">Request access</a></li>'}</ul></div>
    </div>
    ${wordSvg('big-word')}
    <div class="copy"><span>© ${new Date().getFullYear()} Tijar. All rights reserved.</span><span>Every Business Move, <b class="grad">Made Smarter</b></span></div>
  </div></footer>`);

  document.getElementById('app').innerHTML = parts.join('');
}

// ------------------------------------------------------------------ interactions
function interactions() {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 30), { passive: true });
  nav.classList.toggle('solid', scrollY > 30);
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.links a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));

  // reveal on scroll, and count the stats up
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      e.target.querySelectorAll('[data-count]').forEach(countUp);
      io.unobserve(e.target);
    }),
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // cursor glow and 3D tilt (mouse only)
  if (finePointer && !reduceMotion) {
    const glow = document.getElementById('cursor-glow');
    addEventListener('pointermove', (e) => (glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`), { passive: true });
    document.querySelectorAll('.tilt').forEach((el) => {
      const base = el.classList.contains('hot') ? ' translateY(-14px)' : '';
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 12}deg) rotateY(${(x - 0.5) * 14}deg)${base} scale(1.02)`;
        el.style.setProperty('--mx', `${x * 100}%`);
        el.style.setProperty('--my', `${y * 100}%`);
      });
      el.addEventListener('pointerleave', () => (el.style.transform = ''));
    });
  }

  // plan buttons fill in the contact form
  document.querySelectorAll('[data-plan]').forEach((a) =>
    a.addEventListener('click', () => {
      const sel = document.querySelector('#leadForm select[name=plan]');
      if (sel) sel.value = a.dataset.plan;
    }),
  );

  leadForm();
  showcase();
  ring();
}

function countUp(el) {
  const m = /^([^\d]*)([\d,.]+)(.*)$/.exec(el.dataset.count || '');
  if (!m || reduceMotion) return;
  const target = parseFloat(m[2].replace(/,/g, ''));
  const dec = (m[2].split('.')[1] || '').length;
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / 1600);
    const v = target * (1 - Math.pow(1 - p, 3));
    el.textContent = `${m[1]}${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${m[3]}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function leadForm() {
  const f = document.getElementById('leadForm');
  if (!f) return;
  const msg = document.getElementById('leadMsg');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    const btn = f.querySelector('button[type=submit]');
    msg.className = 'msg';
    if (!String(body.name || '').trim()) return show('err', 'Please enter your name.');
    if (!String(body.phone || '').trim() && !String(body.email || '').trim()) return show('err', 'Enter a phone number or an email so we can reach you.');
    btn.disabled = true;
    try {
      const r = await fetch('/site/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send. Please try again.');
      f.reset();
      show('ok', 'Thank you! We will be in touch very soon.');
    } catch (err) {
      show('err', err.message);
    } finally {
      btn.disabled = false;
    }
  });
  function show(kind, text) {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
  }
}

/** The phone turns, and the copy changes, as the showcase section scrolls past. */
function showcase() {
  const sec = document.getElementById('how');
  if (!sec) return;
  const device = document.getElementById('device');
  const arts = sec.querySelectorAll('.steps-copy article');
  const bars = sec.querySelectorAll('.progress b');
  const chips = sec.querySelectorAll('.chip');
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = sec.getBoundingClientRect();
    const span = r.height - innerHeight;
    const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0.5;
    const ry = -32 + p * 64;
    device.style.setProperty('--ry', `${ry}deg`);
    device.style.setProperty('--rx', `${10 - p * 14}deg`);
    device.style.setProperty('--rz', `${Math.sin(p * Math.PI) * -4}deg`);
    const step = Math.min(2, Math.floor(p * 3));
    arts.forEach((a, i) => a.classList.toggle('on', i === step));
    bars.forEach((b, i) => (b.style.width = `${Math.min(100, Math.max(0, (p * 3 - i) * 100))}%`));
    chips.forEach((c, i) => {
      const d = Number(c.dataset.depth || 1);
      const show = p > i * 0.22 - 0.05;
      c.style.opacity = show ? '1' : '0';
      c.style.transform = `translate3d(${(p - 0.5) * 60 * d}px, ${(0.5 - p) * 80 * d}px, 0) scale(${show ? 1 : 0.8})`;
      c.style.transition = 'opacity .5s, transform .2s linear';
    });
  };
  addEventListener('scroll', () => (raf ||= requestAnimationFrame(update)), { passive: true });
  addEventListener('resize', update);
  update();
}

/** Business types on a ring you can spin by dragging; it turns slowly on its own. */
function ring() {
  const stage = document.getElementById('ringStage');
  const el = document.getElementById('ring');
  if (!stage || !el) return;
  const cards = [...el.children];
  const n = cards.length;
  const place = () => {
    const w = cards[0].offsetWidth;
    const radius = Math.max(260, (w / 2 / Math.tan(Math.PI / n)) * 1.12);
    cards.forEach((c, i) => (c.style.transform = `rotateY(${(360 / n) * i}deg) translateZ(${radius}px)`));
    el.style.setProperty('--r', radius);
    stage.style.perspective = `${radius * 3.2}px`;
  };
  place();
  addEventListener('resize', place);
  let angle = 0, vel = reduceMotion ? 0 : 0.12, drag = false, lastX = 0;
  stage.addEventListener('pointerdown', (e) => { drag = true; lastX = e.clientX; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - lastX; lastX = e.clientX; angle += dx * 0.3; vel = dx * 0.3; });
  const up = () => { drag = false; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(stage);
  const loop = () => {
    if (visible) {
      if (!drag) { vel += ((reduceMotion ? 0 : 0.12) - vel) * 0.03; angle += vel; }
      el.style.transform = `translateZ(calc(var(--r) * -1px)) rotateX(-8deg) rotateY(${angle}deg)`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// ------------------------------------------------------------------ 3D
async function three() {
  let THREE, SVGLoader, RoomEnvironment;
  try {
    THREE = await import('three');
    ({ SVGLoader } = await import('three/addons/loaders/SVGLoader.js'));
    ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
  } catch {
    document.documentElement.classList.add('no-webgl');
    return;
  }
  try {
    heroScene(THREE, SVGLoader, RoomEnvironment);
  } catch (e) {
    console.warn('3D hero off:', e);
    document.documentElement.classList.add('no-webgl');
  }
  try {
    orbScene(THREE);
  } catch (e) {
    console.warn('3D orb off:', e);
  }
}

function makeRenderer(THREE, canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  return r;
}

/** Colour each vertex along the mark's diagonal, like the flat logo's gradients. */
function paint(THREE, geo, stops, from, to) {
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const dir = new THREE.Vector2(to[0] - from[0], to[1] - from[1]);
  const len2 = dir.lengthSq();
  const cs = stops.map(([o, c]) => [o, new THREE.Color(c)]);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, ((pos.getX(i) - from[0]) * dir.x + (pos.getY(i) - from[1]) * dir.y) / len2));
    let k = 0;
    while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
    const [o0, c0] = cs[k], [o1, c1] = cs[k + 1];
    c.copy(c0).lerp(c1, Math.min(1, Math.max(0, (t - o0) / (o1 - o0 || 1))));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** A floating UI card drawn on a canvas (invoice, chart, receipt). */
function uiCard(THREE, kind) {
  const W = 520, H = 330;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(22,62,80,0.95)');
  grad.addColorStop(1, 'rgba(8,26,37,0.95)');
  rr(4, 4, W - 8, H - 8, 34); g.fillStyle = grad; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(143,240,214,0.45)'; g.stroke();
  g.font = '700 30px "Plus Jakarta Sans", sans-serif'; g.fillStyle = '#EAF6F3';
  if (kind === 'invoice') {
    g.fillText('Invoice #1024', 40, 70);
    g.font = '500 22px sans-serif'; g.fillStyle = '#95AEB4'; g.fillText('Ahmed General Store', 40, 106);
    g.font = '800 56px "Space Grotesk", sans-serif'; g.fillStyle = '#fff'; g.fillText('Rs 12,500', 40, 190);
    rr(40, 230, 150, 54, 27); g.fillStyle = '#19B892'; g.fill();
    g.font = '800 24px sans-serif'; g.fillStyle = '#03140F'; g.fillText('✓ Paid', 72, 266);
    g.fillStyle = 'rgba(255,255,255,0.12)'; rr(220, 244, 250, 12, 6); g.fill(); rr(220, 266, 180, 12, 6); g.fill();
  } else if (kind === 'chart') {
    g.fillText('Sales this week', 40, 70);
    g.font = '800 26px sans-serif'; g.fillStyle = '#2BD8B0'; g.fillText('▲ 24%', 360, 70);
    [0.35, 0.55, 0.45, 0.7, 0.6, 0.85, 1].forEach((v, i) => {
      const bh = 180 * v; const bg = g.createLinearGradient(0, 290 - bh, 0, 290);
      bg.addColorStop(0, '#2BD8B0'); bg.addColorStop(1, '#0F8A6F');
      rr(46 + i * 64, 290 - bh, 40, bh, 10); g.fillStyle = bg; g.fill();
    });
  } else {
    g.fillText('Counter · Shift 2', 40, 70);
    [['Cooking oil 1L', 'Rs 620'], ['Basmati rice 5kg', 'Rs 1,950'], ['Tea 950g', 'Rs 1,480']].forEach(([a, b], i) => {
      g.font = '500 24px sans-serif'; g.fillStyle = '#C9DCDF'; g.fillText(a, 40, 128 + i * 44);
      g.textAlign = 'right'; g.fillText(b, W - 40, 128 + i * 44); g.textAlign = 'left';
    });
    g.fillStyle = 'rgba(143,240,214,0.3)'; g.fillRect(40, 236, W - 80, 2);
    g.font = '800 34px "Space Grotesk", sans-serif'; g.fillStyle = '#2BD8B0'; g.fillText('Total', 40, 288);
    g.textAlign = 'right'; g.fillText('Rs 4,050', W - 40, 288); g.textAlign = 'left';
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.99), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  return mesh;
}

function glowSprite(THREE, color, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, color);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1);
  return s;
}

function heroScene(THREE, SVGLoader, RoomEnvironment) {
  const canvas = document.getElementById('hero3d');
  if (!canvas) return;
  const renderer = makeRenderer(THREE, canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0, 9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0xbfefff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.PointLight(0x2bd8b0, 60, 30);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const fill = new THREE.PointLight(0x5fb8ff, 25, 30);
  fill.position.set(3, -4, 4);
  scene.add(fill);

  // the mark, extruded
  const root = new THREE.Group();
  scene.add(root);
  const logo = new THREE.Group();
  root.add(logo);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path id="stem" d="${MARK.stem}"/><path id="leaf" d="${MARK.leaf}"/><path id="arrow" d="${MARK.arrow}"/></svg>`;
  const data = new SVGLoader().parse(svg);
  const S = 1 / 88; // svg units → world
  const parts = {};
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
  const grads = {
    stem: [[[0, '#0F2A3B'], [0.5, '#114552'], [0.64, '#17A487'], [1, '#2BD8B0']], [92, 240], [214, 96]],
    leaf: [[[0, '#5BF0CB'], [1, '#14AE8B']], [18, 60], [232, 60]],
    arrow: [[[0, '#19B892'], [1, '#7BF3D6']], [200, 66], [264, 2]],
  };
  data.paths.forEach((p) => {
    const id = p.userData.node.id;
    const shapes = SVGLoader.createShapes(p);
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: 34, bevelEnabled: true, bevelThickness: 7, bevelSize: 4.5, bevelSegments: 6, curveSegments: 28 });
    paint(THREE, geo, ...grads[id]);
    geo.translate(-133, -125, -17);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(S, -S, S);
    const holder = new THREE.Group();
    holder.add(m);
    logo.add(holder);
    parts[id] = holder;
  });
  logo.rotation.set(-0.12, -0.35, 0);

  // glow, particles, glass shapes and UI cards around it
  const halo = glowSprite(THREE, 'rgba(43,216,176,0.55)', 9);
  halo.position.z = -2.5;
  root.add(halo);

  const N = reduceMotion ? 300 : 1400;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 3.2 + Math.random() * 7;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pts.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.6, r * Math.cos(ph) - 2], i * 3);
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const dust = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0x8ff0d6, size: 0.035, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbff3e5, metalness: 0, roughness: 0.05, transmission: 1, thickness: 1.2, ior: 1.4, transparent: true, opacity: 0.9, envMapIntensity: 1.5 });
  const solid = new THREE.MeshPhysicalMaterial({ color: 0x19b892, metalness: 0.6, roughness: 0.2, clearcoat: 1 });
  const floaters = [
    [new THREE.IcosahedronGeometry(0.42, 0), glass, [-2.9, 1.7, -0.6]],
    [new THREE.TorusGeometry(0.34, 0.12, 24, 64), solid, [2.6, -1.8, 0.4]],
    [new THREE.OctahedronGeometry(0.3, 0), solid, [-2.3, -1.9, 0.8]],
    [new THREE.TorusKnotGeometry(0.24, 0.08, 120, 16), glass, [2.9, 1.9, -1.2]],
    [new THREE.SphereGeometry(0.18, 32, 32), solid, [0.3, 2.5, -1.6]],
  ].map(([geo, m, p], i) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...p);
    mesh.userData = { base: new THREE.Vector3(...p), sp: 0.4 + i * 0.13, ph: i * 1.7 };
    root.add(mesh);
    return mesh;
  });

  const cards = ['invoice', 'chart', 'receipt'].map((k, i) => {
    const m = uiCard(THREE, k);
    m.userData = { a: (i / 3) * Math.PI * 2, r: 2.6 };
    root.add(m);
    return m;
  });

  // layout: logo to the right on wide screens, above the text on narrow ones
  let wide = true;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    wide = w > 860;
    root.position.set(wide ? 2.5 : 0, wide ? 0.1 : 0.9, 0);
    root.scale.setScalar(wide ? 1 : Math.min(1, w / 620));
  };
  resize();
  addEventListener('resize', resize);

  // pointer parallax, scroll push-back, and the assembly intro
  const target = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { target.x = e.clientX / innerWidth - 0.5; target.y = e.clientY / innerHeight - 0.5; }, { passive: true });
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const back = (t) => { const c = 1.9; t = Math.min(1, Math.max(0, t)); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const start = performance.now();
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  const clock = new THREE.Clock();

  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = clock.getElapsedTime();
    const intro = reduceMotion ? 10 : (performance.now() - start) / 1000;
    // assemble: stem rises, leaf sweeps in, arrow shoots up
    const a = back((intro - 0.3) / 0.9), b = back((intro - 0.75) / 0.9), c = back((intro - 1.2) / 0.7);
    parts.stem.position.set(0, (1 - a) * -3, 0);
    parts.stem.scale.setScalar(Math.max(0.001, 0.5 + 0.5 * a));
    parts.leaf.position.set((1 - b) * -4, (1 - b) * 0.8, 0);
    parts.leaf.rotation.z = (1 - b) * 0.9;
    parts.leaf.scale.setScalar(Math.max(0.001, b));
    parts.arrow.position.set((1 - c) * -1.8, (1 - c) * -1.8, (1 - c) * 2);
    parts.arrow.scale.setScalar(Math.max(0.001, c));
    // idle float, follow the pointer, turn away as the page scrolls
    const sc = Math.min(1, scrollY / innerHeight);
    const settle = ease((intro - 1.6) / 1.2);
    logo.rotation.y += ((-0.35 + target.x * 0.9 + Math.sin(t * 0.5) * 0.18 * settle + sc * 1.4) - logo.rotation.y) * 0.06;
    logo.rotation.x += ((-0.12 + target.y * 0.5 + sc * 0.4) - logo.rotation.x) * 0.06;
    logo.position.y = Math.sin(t * 1.1) * 0.12 * settle;
    root.position.z = -sc * 3;
    halo.material.opacity = 0.7 + Math.sin(t * 2) * 0.2;
    dust.rotation.y = t * 0.03 + target.x * 0.2;
    dust.rotation.x = target.y * 0.1;
    floaters.forEach((m) => {
      const u = m.userData;
      m.position.y = u.base.y + Math.sin(t * u.sp + u.ph) * 0.25;
      m.rotation.x = t * u.sp * 0.8;
      m.rotation.y = t * u.sp;
      m.scale.setScalar(ease((intro - 1.4 - u.ph * 0.1) / 0.8));
    });
    cards.forEach((m, i) => {
      const u = m.userData;
      const ang = u.a + t * 0.18;
      m.position.set(Math.cos(ang) * u.r, Math.sin(ang * 2) * 0.35 + (i - 1) * 0.6, Math.sin(ang) * u.r * 0.55 - 0.5);
      m.lookAt(camera.position.x, camera.position.y, camera.position.z + 4);
      m.rotation.z += Math.sin(t + i) * 0.04;
      const s = ease((intro - 1.9 - i * 0.2) / 0.8) * (wide ? 0.85 : 0.7);
      m.scale.setScalar(Math.max(0.001, s));
      m.material.opacity = 0.35 + 0.65 * ((Math.sin(ang) + 1) / 2);
    });
    camera.position.x += (target.x * 0.6 - camera.position.x) * 0.04;
    camera.position.y += (-target.y * 0.4 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };
  frame();
}

/** Download section: a turning globe of linked points. */
function orbScene(THREE) {
  const canvas = document.getElementById('orb3d');
  if (!canvas) return;
  const renderer = makeRenderer(THREE, canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.z = 6.4;
  const g = new THREE.Group();
  scene.add(g);
  const N = 420;
  const pts = [];
  for (let i = 0; i < N; i++) {
    // even spread on a sphere (golden spiral)
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * Math.PI * (3 - Math.sqrt(5));
    pts.push(new THREE.Vector3(Math.cos(th) * r * 2, y * 2, Math.sin(th) * r * 2));
  }
  const pg = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8ff0d6, size: 0.045, transparent: true, opacity: 0.95 })));
  const seg = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (pts[i].distanceToSquared(pts[j]) < 0.09) seg.push(pts[i], pts[j]);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x2bd8b0, transparent: true, opacity: 0.28 })));
  const ringM = new THREE.MeshBasicMaterial({ color: 0x2bd8b0, transparent: true, opacity: 0.5 });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 8, 160), ringM);
  r1.rotation.x = 1.2;
  g.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.008, 8, 160), ringM);
  r2.rotation.set(1.6, 0.4, 0);
  g.add(r2);
  const sat = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffc23d }));
  g.add(sat);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  const clock = new THREE.Clock();
  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = clock.getElapsedTime();
    g.rotation.y = t * (reduceMotion ? 0 : 0.15);
    g.rotation.x = 0.35;
    r1.rotation.z = t * 0.3;
    r2.rotation.z = -t * 0.2;
    sat.position.set(Math.cos(t * 0.8) * 2.6, Math.sin(t * 0.8) * 2.6 * Math.cos(1.2), Math.sin(t * 0.8) * 2.6 * Math.sin(1.2));
    renderer.render(scene, camera);
  };
  frame();
}

// ------------------------------------------------------------------ start
page();
interactions();
const loader = document.getElementById('loader');
const hide = () => loader.classList.add('done');
if (reduceMotion) hide();
else setTimeout(hide, 900);
three();
