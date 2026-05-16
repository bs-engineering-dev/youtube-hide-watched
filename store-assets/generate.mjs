import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const icon128Base64 = readFileSync(join(__dirname, '..', 'icons', 'icon128.png')).toString('base64');
const iconDataUrl = `data:image/png;base64,${icon128Base64}`;
const avatarBase64 = readFileSync(join(__dirname, 'bs_engineering_profile.png')).toString('base64');
const avatarDataUrl = `data:image/png;base64,${avatarBase64}`;

const EYE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

const VIDEOS = [
  { title: 'Building a REST API with Hono and Bun', channel: 'CodeCraft', avatar: '#4285f4', views: '142K views', age: '2 days ago', gradient: 'linear-gradient(135deg, #1a73e8 0%, #4fc3f7 100%)', duration: '24:15', progress: 0 },
  { title: 'I Mass-Deleted My Old Videos. Here\'s Why.', channel: 'TechLead', avatar: '#ea4335', views: '892K views', age: '5 days ago', gradient: 'linear-gradient(135deg, #c62828 0%, #ef5350 100%)', duration: '18:42', progress: 82 },
  { title: 'The CSS Feature You\'re Not Using Yet', channel: 'Kevin Powell', avatar: '#fbbc04', views: '310K views', age: '1 day ago', gradient: 'linear-gradient(135deg, #ff6f00 0%, #ffca28 100%)', duration: '12:08', progress: 0 },
  { title: 'Neovim Setup for Full Stack Development', channel: 'ThePrimeagen', avatar: '#34a853', views: '567K views', age: '4 days ago', gradient: 'linear-gradient(135deg, #1b5e20 0%, #66bb6a 100%)', duration: '31:20', progress: 100 },
  { title: 'Stop Using console.log — Use This Instead', channel: 'Fireship', avatar: '#ff6d00', views: '1.4M views', age: '6 days ago', gradient: 'linear-gradient(135deg, #e65100 0%, #ff9800 100%)', duration: '5:22', progress: 45 },
  { title: 'Docker Explained in 100 Seconds', channel: 'Fireship', avatar: '#ff6d00', views: '2.1M views', age: '1 week ago', gradient: 'linear-gradient(135deg, #0288d1 0%, #4fc3f7 100%)', duration: '1:40', progress: 100 },
  { title: 'My Minimal Desk Setup 2026', channel: 'Matt D\'Avella', avatar: '#6d4c41', views: '780K views', age: '3 days ago', gradient: 'linear-gradient(135deg, #4e342e 0%, #8d6e63 100%)', duration: '14:55', progress: 0 },
  { title: 'Understanding TypeScript Generics', channel: 'Matt Pocock', avatar: '#7b1fa2', views: '198K views', age: '2 days ago', gradient: 'linear-gradient(135deg, #4a148c 0%, #ab47bc 100%)', duration: '20:30', progress: 0 },
  { title: 'Linux Tips Every Developer Should Know', channel: 'NetworkChuck', avatar: '#00695c', views: '445K views', age: '5 days ago', gradient: 'linear-gradient(135deg, #004d40 0%, #26a69a 100%)', duration: '16:12', progress: 67 },
  { title: 'Making a Game in 48 Hours', channel: 'Brackeys', avatar: '#283593', views: '1.1M views', age: '1 week ago', gradient: 'linear-gradient(135deg, #1a237e 0%, #5c6bc0 100%)', duration: '22:45', progress: 100 },
  { title: 'How I Stay Productive Working From Home', channel: 'Ali Abdaal', avatar: '#0097a7', views: '520K views', age: '4 days ago', gradient: 'linear-gradient(135deg, #006064 0%, #4dd0e1 100%)', duration: '11:33', progress: 0 },
  { title: 'Postgres is All You Need', channel: 'Hussein Nasser', avatar: '#558b2f', views: '340K views', age: '3 days ago', gradient: 'linear-gradient(135deg, #33691e 0%, #8bc34a 100%)', duration: '28:17', progress: 0 },
];

function ytLogoSVG() {
  return `<svg viewBox="0 0 120 20" width="120" height="20" style="vertical-align:middle">
    <rect x="0" y="0" width="28" height="20" rx="4" fill="#cc0000"/>
    <polygon points="11,4 11,16 22,10" fill="white"/>
    <text x="33" y="16" font-family="Arial,sans-serif" font-weight="700" font-size="17" fill="#0f0f0f">YouTube</text>
  </svg>`;
}

function videoCardHTML(v, opts = {}) {
  const { showEyeBtn = false, showUndo = false, dimmed = false, labelWatched = false } = opts;
  const opacity = dimmed ? '0.35' : '1';
  const metaEyeBtn = showEyeBtn
    ? `<span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:transparent; color:#aaa; margin-left:4px; vertical-align:middle; cursor:pointer;">${EYE_SVG}</span>`
    : '';
  return `
    <div style="opacity:${opacity}; ${showUndo ? 'position:relative;' : ''}">
      <div style="position:relative; width:100%; aspect-ratio:16/9; background:${v.gradient}; border-radius:12px; overflow:hidden;">
        <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;">
          <div style="width:44px; height:44px; background:rgba(0,0,0,0.5); border-radius:50%; display:flex; align-items:center; justify-content:center;">
            <div style="width:0; height:0; border-left:16px solid white; border-top:10px solid transparent; border-bottom:10px solid transparent; margin-left:4px;"></div>
          </div>
        </div>
        ${v.duration ? `<span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.8); color:white; font-size:12px; padding:2px 6px; border-radius:4px; font-weight:500; font-family:Roboto,sans-serif;">${v.duration}</span>` : ''}
        ${v.progress > 0 ? `<div style="position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(255,255,255,0.3);"><div style="height:100%; width:${v.progress}%; background:#cc0000;"></div></div>` : ''}
        ${labelWatched ? `<div style="position:absolute; top:8px; left:8px; background:rgba(204,0,0,0.9); color:white; font-size:11px; font-weight:600; padding:3px 8px; border-radius:4px; font-family:Roboto,sans-serif; letter-spacing:0.5px;">WATCHED</div>` : ''}
      </div>
      ${showUndo ? `
        <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:12px; background:#f2f2f2; border-radius:12px; z-index:10;">
          <span style="color:#606060; font-size:14px; font-family:Roboto,sans-serif;">Video hidden</span>
          <button style="background:none; border:1px solid #065fd4; color:#065fd4; padding:6px 16px; border-radius:18px; font-size:14px; font-family:Roboto,sans-serif; font-weight:500; cursor:pointer;">Undo</button>
        </div>
      ` : ''}
      <div style="display:flex; gap:12px; margin-top:12px;">
        <div style="width:36px; height:36px; border-radius:50%; background:${v.avatar}; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:white; font-weight:600; font-size:14px; font-family:Roboto,sans-serif;">${v.channel[0]}</div>
        <div style="min-width:0;">
          <div style="font-size:14px; font-weight:500; color:#0f0f0f; font-family:Roboto,sans-serif; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${v.title}</div>
          <div style="font-size:12px; color:#606060; font-family:Roboto,sans-serif; margin-top:2px;">${v.channel}</div>
          <div style="font-size:12px; color:#606060; font-family:Roboto,sans-serif; display:flex; align-items:center;">${v.views} · ${v.age}${metaEyeBtn}</div>
        </div>
      </div>
    </div>`;
}

function ytPageShell(content, { annotation = '', badge = '' } = {}) {
  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Roboto,'Segoe UI',sans-serif; background:#fff; overflow:hidden; }
  </style></head><body>
    ${annotation ? `<div style="position:fixed; top:0; left:0; right:0; background:rgba(204,0,0,0.95); color:white; text-align:center; padding:12px 20px; z-index:1000; font-size:20px; font-weight:600; letter-spacing:-0.3px;">${annotation}</div>` : ''}
    <div style="margin-top:${annotation ? '52px' : '0'};">
      <div style="display:flex; align-items:center; padding:8px 24px; border-bottom:1px solid #e5e5e5; height:56px;">
        ${ytLogoSVG()}
        <div style="flex:1; display:flex; justify-content:center;">
          <div style="display:flex; width:530px; height:36px;">
            <div style="flex:1; border:1px solid #ccc; border-right:none; border-radius:20px 0 0 20px; padding:0 16px; display:flex; align-items:center; color:#888; font-size:14px;">Search</div>
            <div style="width:60px; background:#f8f8f8; border:1px solid #ccc; border-radius:0 20px 20px 0; display:flex; align-items:center; justify-content:center;">
              <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#606060" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </div>
          </div>
        </div>
        ${badge ? `<div style="display:flex; align-items:center; gap:8px; margin-left:12px;">${badge}</div>` : ''}
        <img src="${avatarDataUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; margin-left:16px;" />
      </div>
      <div style="display:flex; gap:10px; padding:12px 24px; border-bottom:1px solid #e5e5e5;">
        ${['All', 'Today', 'Live', 'Music', 'Gaming', 'News', 'Recently uploaded'].map((c, i) =>
          `<div style="padding:6px 14px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap; ${i === 0 ? 'background:#0f0f0f; color:white;' : 'background:#f2f2f2; color:#0f0f0f;'}">${c}</div>`
        ).join('')}
      </div>
      <div style="padding:24px;">
        ${content}
      </div>
    </div>
  </body></html>`;
}

function screenshot1HTML() {
  const unwatched = VIDEOS.filter(v => v.progress === 0);
  const watchedCount = VIDEOS.length - unwatched.length;
  const cards = unwatched.map(v => `<div>${videoCardHTML(v, { showEyeBtn: true })}</div>`).join('');
  const grid = `
    <div style="display:flex; align-items:center; margin-bottom:16px;">
      <div style="font-size:14px; color:#606060;">Subscriptions</div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:20px 16px;">${cards}</div>`;
  return ytPageShell(grid, { annotation: 'Your subscriptions feed — only unwatched videos' });
}

function screenshot2HTML() {
  const popupHTML = `
    <div style="width:300px; background:white; border-radius:12px; box-shadow:0 8px 40px rgba(0,0,0,0.25); padding:20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14px; color:#1a1a1a;">
      <div style="font-weight:600; margin-bottom:8px; font-size:15px;">Hide Watched</div>
      <div style="font-size:13px; color:#c00; font-weight:500; margin-bottom:12px;">6 watched videos hidden</div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <span>Hide watched videos</span>
        <div style="width:40px; height:22px; background:#c00; border-radius:22px; position:relative;">
          <div style="width:16px; height:16px; background:white; border-radius:50%; position:absolute; top:3px; right:3px;"></div>
        </div>
      </div>
      <button style="width:100%; padding:9px 0; background:#c00; color:white; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:14px;">Mark All Watched</button>
      <hr style="border:none; border-top:1px solid #e0e0e0; margin:0 0 14px 0;">
      <div style="margin-bottom:14px;">
        <div style="font-size:13px; font-weight:500; margin-bottom:6px;">Watch threshold: <b>1%</b></div>
        <div style="height:4px; background:#e5e5e5; border-radius:2px; position:relative;"><div style="height:100%; width:1%; background:#c00; border-radius:2px; min-width:8px;"></div></div>
        <div style="font-size:11px; color:#888; margin-top:4px;">Hide videos watched past this percentage</div>
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-size:13px; font-weight:500; margin-bottom:6px;">Subscriptions max age: <b>14 days</b></div>
        <div style="height:4px; background:#e5e5e5; border-radius:2px; position:relative;"><div style="height:100%; width:15%; background:#c00; border-radius:2px;"></div></div>
        <div style="font-size:11px; color:#888; margin-top:4px;">Hide videos older than this on Subscriptions (0 = off)</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;"><input type="checkbox" checked style="width:14px; height:14px; accent-color:#c00;"> Hide "Most relevant" section</label>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;"><input type="checkbox" checked style="width:14px; height:14px; accent-color:#c00;"> Hide "Latest" section</label>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;"><input type="checkbox" style="width:14px; height:14px;"> Hide "Shorts" section</label>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; cursor:pointer;"><input type="checkbox" style="width:14px; height:14px;"> Show hide icon on thumbnail</label>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:13px;">847 videos cached</span>
        <button style="background:none; border:1px solid #ccc; color:#555; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">Clear cache</button>
      </div>
      <div style="margin-top:8px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; height:6px; background:#e5e7eb; border-radius:3px; overflow:hidden;"><div style="height:100%; width:12%; background:#16a34a; border-radius:3px;"></div></div>
          <span style="font-size:11px; color:#888; white-space:nowrap;">1.2 MB / 10 MB</span>
        </div>
      </div>
    </div>`;

  const bgCards = VIDEOS.slice(0, 8).filter(v => v.progress === 0).map(v => `<div>${videoCardHTML(v)}</div>`).join('');
  const bgGrid = `<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:20px 16px; filter:blur(2px); opacity:0.4;">${bgCards}</div>`;

  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Roboto,'Segoe UI',sans-serif; background:#fff; overflow:hidden; }
  </style></head><body>
    <div style="position:relative; width:1280px; height:800px;">
      <div style="padding:80px 24px 24px;">
        ${bgGrid}
      </div>
      <div style="position:absolute; top:50%; right:180px; transform:translateY(-50%);">
        ${popupHTML}
      </div>
      <div style="position:absolute; top:50%; left:60px; transform:translateY(-50%); max-width:440px;">
        <div style="font-size:38px; font-weight:700; color:#0f0f0f; line-height:1.25; letter-spacing:-0.5px;">Powerful controls at your fingertips</div>
        <div style="font-size:18px; color:#606060; margin-top:12px; line-height:1.5;">Toggle hiding, mark all watched, set thresholds, and more — all from the extension popup.</div>
      </div>
    </div>
  </body></html>`;
}

function screenshot3HTML() {
  const v1 = VIDEOS[0];
  const v2 = VIDEOS[2];

  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Roboto,'Segoe UI',sans-serif; background:#f9f9f9; overflow:hidden; }
  </style></head><body>
    <div style="width:1280px; height:800px; display:flex; align-items:center; justify-content:center; gap:80px;">
      <div style="text-align:center;">
        <div style="width:380px; margin-bottom:24px;">
          ${videoCardHTML(v1, { showEyeBtn: true })}
        </div>
        <div style="display:inline-flex; align-items:center; gap:8px; background:white; padding:10px 20px; border-radius:24px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#cc0000" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
          <span style="font-size:15px; font-weight:500; color:#0f0f0f;">Click the eye icon to mark as watched</span>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <svg width="48" height="48" viewBox="0 0 24 24" style="margin-bottom:8px;"><path fill="#999" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </div>
      <div style="text-align:center;">
        <div style="width:380px; margin-bottom:24px; position:relative;">
          <div style="aspect-ratio:16/9; background:#f2f2f2; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:12px;">
            <span style="color:#606060; font-size:15px;">Video hidden</span>
            <button style="background:none; border:1px solid #065fd4; color:#065fd4; padding:7px 18px; border-radius:18px; font-size:14px; font-weight:500; cursor:pointer;">Undo</button>
          </div>
          <div style="display:flex; gap:12px; margin-top:12px;">
            <div style="width:36px; height:36px; border-radius:50%; background:#ccc; flex-shrink:0;"></div>
            <div>
              <div style="height:14px; width:200px; background:#e5e5e5; border-radius:4px; margin-bottom:8px;"></div>
              <div style="height:10px; width:120px; background:#e5e5e5; border-radius:4px;"></div>
            </div>
          </div>
        </div>
        <div style="display:inline-flex; align-items:center; gap:8px; background:white; padding:10px 20px; border-radius:24px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#065fd4" d="M12.5 8c-2.65 0-5.05 1.04-6.93 2.73l2.12 2.12c1.27-1.07 2.9-1.72 4.71-1.72.41 0 .81.04 1.2.11l2.09-2.09C14.67 8.43 13.62 8 12.5 8z"/><path fill="#065fd4" d="M3 4l1.41 1.41L19.59 20.41 21 19l-6.03-6.03"/></svg>
          <span style="font-size:15px; font-weight:500; color:#0f0f0f;">Undo within 60 seconds</span>
        </div>
      </div>
    </div>
    <div style="position:absolute; top:40px; left:0; right:0; text-align:center;">
      <div style="font-size:36px; font-weight:700; color:#0f0f0f; letter-spacing:-0.5px;">Mark individual videos as watched</div>
      <div style="font-size:18px; color:#606060; margin-top:8px;">Hover any thumbnail to reveal the hide button — undo if you change your mind</div>
    </div>
  </body></html>`;
}

function screenshot4HTML() {
  const before = VIDEOS.slice(0, 8);
  const after = before.filter(v => v.progress === 0);

  const cardsBefore = before.map(v =>
    `<div>${videoCardHTML(v, { labelWatched: v.progress > 0, dimmed: v.progress > 0 })}</div>`
  ).join('');

  const cardsAfter = after.map(v =>
    `<div>${videoCardHTML(v, { showEyeBtn: true })}</div>`
  ).join('');

  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Roboto,'Segoe UI',sans-serif; background:#fff; overflow:hidden; }
  </style></head><body>
    <div style="width:1280px; height:800px; display:flex;">
      <div style="flex:1; padding:20px; background:#fafafa; position:relative; overflow:hidden;">
        <div style="text-align:center; margin-bottom:16px;">
          <div style="display:inline-flex; align-items:center; gap:8px; background:#fee2e2; padding:6px 16px; border-radius:20px;">
            <div style="width:8px; height:8px; border-radius:50%; background:#ef4444;"></div>
            <span style="font-size:15px; font-weight:600; color:#991b1b;">Before</span>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:14px 12px; transform:scale(0.92); transform-origin:top center;">${cardsBefore}</div>
      </div>
      <div style="width:4px; background:linear-gradient(to bottom, #cc0000, #ff4444);"></div>
      <div style="flex:1; padding:20px; position:relative; overflow:hidden;">
        <div style="text-align:center; margin-bottom:16px;">
          <div style="display:inline-flex; align-items:center; gap:8px; background:#dcfce7; padding:6px 16px; border-radius:20px;">
            <div style="width:8px; height:8px; border-radius:50%; background:#16a34a;"></div>
            <span style="font-size:15px; font-weight:600; color:#166534;">After</span>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:14px 12px; transform:scale(0.92); transform-origin:top center;">${cardsAfter}</div>
      </div>
    </div>
    <div style="position:absolute; bottom:16px; left:0; right:0; text-align:center;">
      <span style="font-size:14px; color:#999;">Hide Watched YouTube Videos — see only what's new</span>
    </div>
  </body></html>`;
}

function smallPromoHTML() {
  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; overflow:hidden; }
  </style></head><body>
    <div style="width:440px; height:280px; background:linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;">
      <img src="${iconDataUrl}" width="72" height="72" />
      <div style="font-size:22px; font-weight:700; color:white; text-align:center; letter-spacing:-0.3px;">Hide Watched<br>YouTube Videos</div>
      <div style="font-size:14px; color:rgba(255,255,255,0.6); text-align:center;">See only what's new</div>
    </div>
  </body></html>`;
}

function marqueeHTML() {
  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; overflow:hidden; }
  </style></head><body>
    <div style="width:1400px; height:560px; background:linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); display:flex; align-items:center; padding:0 100px; gap:80px;">
      <div style="flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:20px;">
        <img src="${iconDataUrl}" width="120" height="120" />
        <div style="font-size:32px; font-weight:700; color:white; text-align:center; letter-spacing:-0.5px; line-height:1.2;">Hide Watched<br>YouTube Videos</div>
      </div>
      <div style="height:300px; width:2px; background:rgba(255,255,255,0.1); flex-shrink:0;"></div>
      <div style="display:flex; flex-direction:column; gap:28px;">
        ${[
          { icon: '👁️‍🗨️', text: 'Automatically hides watched videos from Home, Subscriptions, and Channel pages' },
          { icon: '🎯', text: 'Adjustable watch threshold — set the minimum percentage before hiding' },
          { icon: '⚡', text: 'One-click "Mark All Watched" to clear your entire feed' },
          { icon: '↩️', text: '60-second undo when you accidentally mark a video' },
          { icon: '🔒', text: 'Completely private — no data collection, no account access' },
        ].map(f => `
          <div style="display:flex; align-items:flex-start; gap:16px;">
            <span style="font-size:24px; flex-shrink:0; width:32px; text-align:center;">${f.icon}</span>
            <span style="font-size:18px; color:rgba(255,255,255,0.85); line-height:1.4;">${f.text}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </body></html>`;
}

async function capture(browser, width, height, html, filename) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const path = join(__dirname, filename);
  await page.screenshot({ path, type: 'png', scale: 'css' });
  await page.close();
  await context.close();
  console.log(`  ✓ ${filename} (${width}×${height} @2x)`);
  return path;
}

async function main() {
  console.log('Generating Chrome Web Store assets...\n');
  const browser = await chromium.launch();

  await capture(browser, 1280, 800, screenshot1HTML(), 'screenshot-1-feed.png');
  await capture(browser, 1280, 800, screenshot2HTML(), 'screenshot-2-controls.png');
  await capture(browser, 1280, 800, screenshot3HTML(), 'screenshot-3-mark-undo.png');
  await capture(browser, 1280, 800, screenshot4HTML(), 'screenshot-4-before-after.png');
  await capture(browser, 440, 280, smallPromoHTML(), 'promo-small-440x280.png');
  await capture(browser, 1400, 560, marqueeHTML(), 'promo-marquee-1400x560.png');

  await browser.close();
  console.log('\nDone! All assets saved to store-assets/');
}

main().catch(err => { console.error(err); process.exit(1); });
