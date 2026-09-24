// migration.js
// Moves saved games from the old address (osmanyo.github.io/colordle) to the new
// domain, and gives players a manual "backup code" they can copy between devices.
//
// How the automatic move works:
//   1. On the new domain a banner offers "Restore my progress".
//   2. That sends the player (a normal top-level navigation) to the bridge page
//      at osmanyo.github.io/colordle-bridge/, which shares the old site's origin
//      and can therefore read the old localStorage.
//   3. The bridge sends the player back to the new domain with the data in the
//      URL fragment (#migrate=...). Fragments are never sent to any server.
//   4. importCode() below validates everything and only fills in what is missing.
//
// Nothing here ever overwrites progress that already exists on the current device.

import { isKnownList } from './dictionary.js';

export const NEW_ORIGIN = 'https://colordle.org';
export const BRIDGE_URL = 'https://osmanyo.github.io/colordle-bridge/';

// The import handler and banner only run on these hostnames.
const IMPORT_HOSTS = ['colordle.org', 'localhost', '127.0.0.1'];

const LIST_KEY = 'colordle_list';
const FLAG_KEY = 'colordle_migration';            // 'done' | 'dismissed'
// colordle_save_<list>_<seed>   (list names can contain underscores, seeds can be negative)
const SAVE_RE = /^colordle_save_([A-Za-z0-9._-]{1,60})_(-?\d{1,10})$/;
const PREFIX = 'colordle1:';
const MAX_CODE_CHARS = 400000;
const MAX_ENTRIES = 2000;

// ---------- encoding ----------

function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

// ---------- export ----------

export function collectProgress(storage = localStorage) {
    const data = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === LIST_KEY || SAVE_RE.test(key)) data[key] = storage.getItem(key);
    }
    return data;
}

export function exportCode(storage = localStorage) {
    return PREFIX + b64urlEncode(JSON.stringify({ v: 1, d: collectProgress(storage) }));
}

// ---------- import (treat every byte as untrusted) ----------

// Saved guesses are later drawn with innerHTML in index.html, so a save is only
// accepted if every field has exactly the shape the game itself writes.
function cleanSave(raw, seed) {
    let o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || !Array.isArray(o.guesses) || o.guesses.length > 500) return null;

    const guesses = [];
    for (const g of o.guesses) {
        if (!g || typeof g !== 'object') return null;
        const number = Number(g.number);
        const score = Number(g.score);
        const name = String(g.name);
        const hex = String(g.hex);
        if (!Number.isInteger(number) || number < 1 || number > 100000) return null;
        if (!Number.isFinite(score) || score < 0 || score > 100) return null;
        if (name.length === 0 || name.length > 120 || /[<>]/.test(name)) return null;
        if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) return null;
        guesses.push({ number, name, hex, score: score.toFixed(2) });
    }

    const clean = {
        seed,
        won: o.won === true,
        guesses,
        submitted: o.submitted === true,
        rank: Number.isInteger(o.rank) && o.rank > 0 && o.rank < 1e7 ? o.rank : null
    };
    if (Number.isFinite(o.startTime) && o.startTime > 0 && o.startTime < 4e12) clean.startTime = o.startTime;
    return clean;
}

export function importCode(code, storage = localStorage) {
    const text = String(code || '').trim().replace(/\s+/g, '').replace(PREFIX, '');
    if (!text || text.length > MAX_CODE_CHARS) throw new Error('That code looks invalid.');

    let obj;
    try { obj = JSON.parse(b64urlDecode(text)); } catch (e) { throw new Error('That code looks invalid.'); }
    if (!obj || obj.v !== 1 || !obj.d || typeof obj.d !== 'object') throw new Error('That code looks invalid.');

    let imported = 0;
    let skipped = 0;
    let seen = 0;
    for (const [key, value] of Object.entries(obj.d)) {
        if (++seen > MAX_ENTRIES) break;
        if (typeof value !== 'string' || value.length > 100000) { skipped++; continue; }

        if (key === LIST_KEY) {
            if (isKnownList(value) && storage.getItem(LIST_KEY) === null) storage.setItem(LIST_KEY, value);
            continue;
        }

        const m = SAVE_RE.exec(key);
        if (!m || !isKnownList(m[1])) { skipped++; continue; }
        if (storage.getItem(key) !== null) { skipped++; continue; }   // keep what is already here

        const clean = cleanSave(value, Number(m[2]));
        if (!clean) { skipped++; continue; }
        storage.setItem(key, JSON.stringify(clean));
        imported++;
    }
    return { imported, skipped };
}

// ---------- new-domain entry point (call once, before the game reads localStorage) ----------

// The tiny inline script in <head> moves "#migrate=..." out of the URL into
// window.__colordleMigrate so analytics never sees it.
export function handleMigrationHash() {
    const payload = window.__colordleMigrate;
    if (!payload || !IMPORT_HOSTS.includes(location.hostname)) return;
    delete window.__colordleMigrate;

    try {
        if (payload === 'none' || payload === 'toolarge') {
            window.__colordleMigrated = payload;
        } else {
            window.__colordleMigrated = importCode(payload).imported;
        }
        localStorage.setItem(FLAG_KEY, 'done');
    } catch (e) {
        window.__colordleMigrated = 'error';
        console.warn('Colordle: could not import progress', e);
    }
}

// ---------- small UI (built in JS so index.html needs no extra markup) ----------

function makeBar(html) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed; left:50%; bottom:16px; transform:translateX(-50%); z-index:1100; ' +
        'max-width:min(420px, 92vw); background:#1a1a1a; color:#eee; border:1px solid #3a3a3c; border-radius:10px; ' +
        'padding:12px 14px; font:13px/1.4 "Helvetica Neue", Arial, sans-serif; box-shadow:0 8px 32px rgba(0,0,0,0.7); text-align:center;';
    bar.innerHTML = html;    // static strings only, no user data
    document.body.appendChild(bar);
    return bar;
}

function linkBtn(label, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:8px 4px 0; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold; ' +
        (primary ? 'background:#00d2ff; color:#000; border:none;' : 'background:transparent; color:#aaa; border:1px solid #555;');
    return b;
}

export function showMigrationBannerIfNeeded() {
    if (!IMPORT_HOSTS.includes(location.hostname)) return;

    const result = window.__colordleMigrated;
    if (result !== undefined) {
        const messages = {
            none: 'No saved games were found on the old address.',
            toolarge: 'Your history is too big to move automatically. Use "Copy backup code" on the old site instead.',
            error: 'Sorry, your progress could not be restored.'
        };
        const text = typeof result === 'number'
            ? (result > 0 ? `Restored ${result} saved game${result === 1 ? '' : 's'}.` : 'Nothing new to restore.')
            : messages[result];
        const bar = makeBar(text);
        setTimeout(() => bar.remove(), 6000);
        return;
    }

    if (localStorage.getItem(FLAG_KEY)) return;
    if (Object.keys(localStorage).some(k => SAVE_RE.test(k))) return;   // already has progress here

    const bar = makeBar('Played Colordle before on the old address?<br>Bring your saved games and streak with you.');
    const yes = linkBtn('Restore my progress', true);
    const no = linkBtn('No thanks', false);
    yes.onclick = () => {
        location.href = BRIDGE_URL + '?r=' + encodeURIComponent(location.search);
    };
    no.onclick = () => {
        localStorage.setItem(FLAG_KEY, 'dismissed');
        bar.remove();
    };
    bar.appendChild(document.createElement('br'));
    bar.appendChild(yes);
    bar.appendChild(no);
}

// ---------- "Backup / restore code" box inside the Saved Games modal ----------

export function initBackupUI() {
    const copyBtn = document.getElementById('copyBackupBtn');
    const box = document.getElementById('restoreBox');
    const restoreBtn = document.getElementById('restoreBtn');
    const msg = document.getElementById('backupMsg');
    if (!copyBtn || !box || !restoreBtn || !msg) return;

    const say = (text, bad) => {
        msg.textContent = text;
        msg.style.color = bad ? '#f87171' : '#4ade80';
    };

    copyBtn.addEventListener('click', async () => {
        const code = exportCode();
        try {
            await navigator.clipboard.writeText(code);
            say('Copied! Paste it into "Restore" on your other device or the new site.');
        } catch (e) {
            box.value = code;
            box.select();
            say('Copy the code from the box below.');
        }
    });

    restoreBtn.addEventListener('click', () => {
        try {
            const { imported } = importCode(box.value);
            say(imported > 0 ? `Restored ${imported} saved game${imported === 1 ? '' : 's'}. Reloading…` : 'Nothing new to restore.');
            if (imported > 0) setTimeout(() => location.reload(), 900);
        } catch (e) {
            say(e.message, true);
        }
    });
}
