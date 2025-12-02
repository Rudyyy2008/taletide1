// app.js (module) — Firebase Realtime Database backed chat
// Uses modular Firebase SDK via CDN imports.

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getDatabase, ref, set, push, onValue, onChildAdded, get
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/* ----------------- YOUR FIREBASE CONFIG (you provided) ----------------- */
const firebaseConfig = {
  apiKey: "AIzaSyB5QdYXlHUbggPEPAxHpCCFdjR6UhqTLz0",
  authDomain: "taletidetrials1.firebaseapp.com",
  databaseURL: "https://taletidetrials1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "taletidetrials1",
  storageBucket: "taletidetrials1.firebasestorage.app",
  messagingSenderId: "557745150722",
  appId: "1:557745150722:web:31245ede24ccf15beb001b",
  measurementId: "G-GCZM5MFRXY"
};

/* ------------------------------------------------------------------------ */

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

/* ----------------- utility helpers ----------------- */
function nowTs(){ return new Date().toISOString(); }
function fmtTime(iso){
  const d = new Date(iso);
  return d.toLocaleString();
}

/* hash password using SubtleCrypto -> hex */
async function hashPassword(password){
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(password));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
}

/* Case-sensitive usernames chosen by you (Option 2)
   To use usernames as safe DB keys, we'll encode with encodeURIComponent.
*/
function userKey(username){
  return encodeURIComponent(username);
}

/* canonical chat id: join two encoded usernames lexicographically (case-sensitive compare) */
function chatId(a,b){
  const A = userKey(a), B = userKey(b);
  // compare using localeCompare with case-sensitive default
  return (A < B) ? `${A}|${B}` : `${B}|${A}`;
}

/* ----------------- DOM helpers ----------------- */
const el = id => document.getElementById(id);

const regUser = el('reg-username');
const regPass = el('reg-password');
const btnRegister = el('btn-register');
const regMsg = el('reg-msg');

const loginUser = el('login-username');
const loginPass = el('login-password');
const btnLogin = el('btn-login');
const loginMsg = el('login-msg');

const usersList = el('users-list');
const recipientSelect = el('recipient');

const chatWith = el('chat-with');
const subtitle = el('subtitle');
const messagesEl = el('messages');
const chatWindow = el('chat-window');

const messageInput = el('message-input');
const btnSend = el('btn-send');
const btnLogout = el('btn-logout');
const currentUserInfo = el('currentUserInfo');

let currentUser = null;   // { username }
let selectedPeer = null;  // username string

/* session persistence */
function saveCurrentUser(u){
  if(u) localStorage.setItem('simplechat_currentUser', JSON.stringify(u));
  else localStorage.removeItem('simplechat_currentUser');
}
function loadCurrentUser(){
  try { return JSON.parse(localStorage.getItem('simplechat_currentUser')); }
  catch(e){ return null; }
}

/* realtime listeners unsubscribe holders */
let usersUnsub = null;
let messagesUnsub = null;

/* ----------------- UI rendering ----------------- */
function setStatus(msgHtml){
  currentUserInfo.innerHTML = msgHtml;
}
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

function renderHeader(){
  if(!currentUser){
    chatWith.textContent = 'Not logged in';
    subtitle.textContent = 'Select a user to chat with.';
    setStatus('Not logged in');
    btnLogout.style.display = 'none';
  } else {
    btnLogout.style.display = 'inline-block';
    setStatus(`Logged in as <strong>${escapeHtml(currentUser.username)}</strong>`);
    if(selectedPeer){
      chatWith.textContent = `Chat with ${selectedPeer}`;
      subtitle.textContent = `Messages between you and ${selectedPeer}`;
    } else {
      chatWith.textContent = `Logged in: ${currentUser.username}`;
      subtitle.textContent = `Select a user (left) or choose recipient below.`;
    }
  }
}

/* ----------------- Users list (realtime) ----------------- */
function startUsersListener(){
  // detach prior
  if(typeof usersUnsub === 'function') usersUnsub();

  const usersRef = ref(db, 'users');
  usersUnsub = onValue(usersRef, (snapshot) => {
    const data = snapshot.val() || {};
    renderUsersFromData(data);
  });
}

function renderUsersFromData(usersData){
  usersList.innerHTML = '';
  recipientSelect.innerHTML = '';
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = 'Select recipient...';
  recipientSelect.appendChild(placeholderOpt);

  // usersData keys are encoded usernames; values have { username, passwordHash, createdAt }
  const entries = Object.entries(usersData);
  // sort by display username (case-sensitive)
  entries.sort((a,b) => {
    const ua = a[1].username, ub = b[1].username;
    return ua < ub ? -1 : (ua > ub ? 1 : 0);
  });

  entries.forEach(([key, u])=>{
    const username = u.username;
    const li = document.createElement('li');
    li.textContent = username;
    li.addEventListener('click', ()=> selectPeer(username));
    usersList.appendChild(li);

    const opt = document.createElement('option');
    opt.value = username;
    opt.textContent = username;
    recipientSelect.appendChild(opt);
  });
}

/* ----------------- Messages (per chat) ----------------- */
function stopMessagesListener(){
  if(typeof messagesUnsub === 'function') messagesUnsub();
  messagesUnsub = null;
}

function startMessagesListenerFor(a, b) {
  stopMessagesListener();
  if (!a || !b) return;

  const id = chatId(a, b);
  const chatRef = ref(db, `messages/${id}`);

  // Use onValue so it fires ONCE per update, not once per message
  messagesUnsub = onValue(chatRef, () => {
    renderMessages();
  });
}

async function renderMessages(){
  messagesEl.innerHTML = '';
  if(!currentUser || !selectedPeer){
    messagesEl.innerHTML = '<div class="meta" style="color:var(--muted)">No conversation selected.</div>';
    return;
  }
  const id = chatId(currentUser.username, selectedPeer);
  const chatRef = ref(db, `messages/${id}`);
  const snap = await get(chatRef);
  const msgsObj = snap.val() || {};
  const msgs = Object.values(msgsObj).sort((a,b)=> new Date(a.ts) - new Date(b.ts));

  if(msgs.length === 0){
    messagesEl.innerHTML = `<div class="meta" style="color:var(--muted)">No messages between you and ${escapeHtml(selectedPeer)} yet.</div>`;
    return;
  }

  msgs.forEach(m=>{
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(m.from === currentUser.username ? 'me' : 'them');

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `${escapeHtml(m.from)} • ${fmtTime(m.ts)}`;
    div.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = escapeHtml(m.text);
    div.appendChild(body);

    messagesEl.appendChild(div);
  });

  // scroll bottom
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* ----------------- Select peer ----------------- */
function selectPeer(username){
  if(!currentUser){
    alert('Please login first.');
    return;
  }
  if(username === currentUser.username){
    alert("You can't chat with yourself (for this demo).");
    return;
  }
  selectedPeer = username;
  recipientSelect.value = username;
  renderHeader();
  renderMessages();
  startMessagesListenerFor(currentUser.username, selectedPeer);
}

/* ----------------- Register / Login / Logout ----------------- */
btnRegister.addEventListener('click', async ()=>{
  regMsg.textContent = '';
  const username = String(regUser.value || '').trim();
  const password = regPass.value || '';
  if(!username || !password){ regMsg.textContent = 'Enter username & password'; regMsg.className='msg error'; return; }

  const key = userKey(username);
  const usersRef = ref(db, `users/${key}`);
  const existing = await get(usersRef);
  if(existing.exists()){
    regMsg.textContent = 'Username already exists';
    regMsg.className = 'msg error';
    return;
  }

  regMsg.textContent = 'Registering...'; regMsg.className = 'msg';
  try {
    const hashed = await hashPassword(password);
    const userObj = { username: username, passwordHash: hashed, createdAt: nowTs() };
    await set(usersRef, userObj);
    regMsg.textContent = 'Registered ✔';
    regMsg.className = 'msg success';
    regUser.value=''; regPass.value='';
    // users list will update automatically via listener
  } catch(e){
    console.error(e);
    regMsg.textContent = 'Error registering';
    regMsg.className = 'msg error';
  }
});

btnLogin.addEventListener('click', async ()=>{
  loginMsg.textContent = '';
  const username = String(loginUser.value || '').trim();
  const password = loginPass.value || '';
  if(!username || !password){ loginMsg.textContent = 'Enter username & password'; loginMsg.className='msg error'; return; }

  const key = userKey(username);
  const usersRef = ref(db, `users/${key}`);
  const snap = await get(usersRef);
  if(!snap.exists()){
    loginMsg.textContent = 'User not found'; loginMsg.className = 'msg error'; return;
  }

  loginMsg.textContent = 'Checking...'; loginMsg.className = 'msg';
  try {
    const userRec = snap.val();
    const hashed = await hashPassword(password);
    if(hashed !== userRec.passwordHash){
      loginMsg.textContent = 'Incorrect password'; loginMsg.className = 'msg error';
      return;
    }

    currentUser = { username: userRec.username };
    saveCurrentUser(currentUser);            // persist session
    loginMsg.textContent = 'Logged in ✔'; loginMsg.className = 'msg success';
    loginUser.value = ''; loginPass.value = '';

    renderHeader();
    renderMessages();
    if(selectedPeer) startMessagesListenerFor(currentUser.username, selectedPeer);
  } catch(e){
    console.error(e);
    loginMsg.textContent = 'Login error'; loginMsg.className = 'msg error';
  }
});

btnLogout.addEventListener('click', ()=>{
  saveCurrentUser(null);
  currentUser = null;
  selectedPeer = null;
  renderHeader();
  renderMessages();
  stopMessagesListener();
});

/* ----------------- Send message ----------------- */
btnSend.addEventListener('click', async ()=>{
  const to = recipientSelect.value;
  const text = String(messageInput.value || '').trim();
  if(!currentUser){ alert('Please login to send messages.'); return; }
  if(!to){ alert('Select a recipient.'); return; }
  if(to === currentUser.username){ alert("You can't send a message to yourself."); return; }
  if(!text) return;

  // ensure recipient exists
  const toRef = ref(db, `users/${userKey(to)}`);
  const snap = await get(toRef);
  if(!snap.exists()){
    alert('Recipient does not exist.');
    return;
  }

  const id = chatId(currentUser.username, to);
  const chatRef = ref(db, `messages/${id}`);
  const newMsgRef = push(chatRef);
  const msgObj = {
    from: currentUser.username,
    to,
    text,
    ts: nowTs()
  };
  await set(newMsgRef, msgObj);
  messageInput.value = '';

  if(selectedPeer === to) renderMessages();
  else {
    selectedPeer = to;
    renderHeader();
    renderMessages();
    startMessagesListenerFor(currentUser.username, selectedPeer);
  }
});

/* Enter to send */
messageInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    btnSend.click();
  }
});

/* recipient select */
recipientSelect.addEventListener('change', ()=>{
  const val = recipientSelect.value;
  if(val) selectPeer(val);
  else {
    selectedPeer = null;
    renderHeader();
    renderMessages();
    stopMessagesListener();
  }
});

/* ----------------- Restore session & start listeners ----------------- */
currentUser = loadCurrentUser();
startUsersListener();
renderHeader();
renderMessages();
