// Accounts stored in this browser only (no server, works offline).
// Passwords are salted and hashed with PBKDF2 before saving.
// To move to cloud accounts later, replace these four functions.

const USERS = 'es_users';
const SESSION = 'es_session';

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: session only */ }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hash(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}

export async function signUp(name, email, password) {
  email = email.trim().toLowerCase();
  if (!name.trim()) throw new Error('Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email.');
  if (password.length < 6) throw new Error('Password needs at least 6 characters.');
  const users = load(USERS, {});
  if (users[email]) throw new Error('An account with this email already exists. Sign in instead.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  users[email] = { name: name.trim(), salt, hash: await hash(password, salt), created: Date.now() };
  store(USERS, users);
  store(SESSION, { email, at: Date.now() });
  return currentUser();
}

export async function signIn(email, password) {
  email = email.trim().toLowerCase();
  const u = load(USERS, {})[email];
  if (!u || (await hash(password, u.salt)) !== u.hash) throw new Error('Email or password is incorrect.');
  store(SESSION, { email, at: Date.now() });
  return currentUser();
}

export function signOut() {
  try { localStorage.removeItem(SESSION); } catch { /* ignore */ }
}

export function currentUser() {
  const s = load(SESSION, null);
  if (!s) return null;
  const u = load(USERS, {})[s.email];
  return u ? { email: s.email, name: u.name } : null;
}

// Per-user saved data (calibration snapshots, session history).
export function userData(email) {
  return load('es_data_' + email, { sessions: [], profile: null });
}
export function saveUserData(email, data) {
  store('es_data_' + email, data);
}
