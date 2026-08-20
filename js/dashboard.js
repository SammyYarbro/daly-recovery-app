// Daly Recovery — Manager Dashboard Logic

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const money = (n) => '$' + Number(n).toLocaleString('en-US');
  const initials = (name) => (name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const DAY = 86400000;
  const cleanDays = (d) => d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / DAY)) : 0;
  const timeAgo = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  let currentUser = null;
  let userProfile = null;
  let houseSettings = {};
  let currentSection = 'board';
  let residents = [];
  let unsubscribers = [];

  // Toast
  let toastTimer;
  function toast(msg) {
    const el = $('#dash-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  // ── Auth ──
  let confirmResult = null;

  function setupAuth() {
    $('#dash-send-code').onclick = async () => {
      const phone = formatPhone($('#dash-phone').value);
      if (!phone) { showError('Enter a valid phone number.'); return; }
      try {
        const rv = new firebase.auth.RecaptchaVerifier('dash-recaptcha', { size: 'invisible' });
        confirmResult = await auth.signInWithPhoneNumber(phone, rv);
        $('#dash-auth-phone').classList.add('hidden');
        $('#dash-auth-code').classList.remove('hidden');
        $('#dash-phone-display').textContent = phone;
      } catch (e) { showError(e.message); }
    };

    $('#dash-verify').onclick = async () => {
      try {
        await confirmResult.confirm($('#dash-code').value.trim());
      } catch (e) { showError('Invalid code.'); }
    };

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists && doc.data().role === 'manager') {
          userProfile = { id: doc.id, ...doc.data() };
          showDashboard();
        } else {
          showError('This account is not a manager.');
          auth.signOut();
        }
      } else {
        $('#dash-auth').classList.remove('hidden');
        $('#dash-auth').style.display = 'flex';
        $('#dashboard').classList.add('hidden');
        cleanupListeners();
      }
    });

    $('#dash-signout').onclick = () => auth.signOut();
  }

  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return null;
  }

  function showError(msg) {
    const el = $('#dash-auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.display = 'block';
  }

  async function showDashboard() {
    $('#dash-auth').classList.add('hidden');
    $('#dash-auth').style.display = 'none';
    $('#dashboard').classList.remove('hidden');

    // Responsive mobile nav
    if (window.innerWidth < 768) $('#mobile-nav').style.display = 'flex';

    await loadHouseSettings();
    setupNav();
    startListeners();
    renderSection('board');
  }

  async function loadHouseSettings() {
    const doc = await db.collection('house').doc('settings').get();
    houseSettings = doc.exists ? doc.data() : {
      name: 'Daly Recovery', earlyCurfew: '10:00 PM', lateCurfew: '12:00 AM',
      weeklyRent: 185, meetingsRequired: 3, testCadence: 'Random, weekly'
    };
  }

  // ── Navigation ──
  function setupNav() {
    $$('[data-section]').forEach(item => {
      item.onclick = () => {
        currentSection = item.dataset.section;
        $$('[data-section]').forEach(n => n.classList.remove('active'));
        $$(`[data-section="${currentSection}"]`).forEach(n => n.classList.add('active'));
        renderSection(currentSection);
      };
    });

    // Sheet
    $('#dash-sheet-overlay').onclick = (e) => { if (e.target === e.currentTarget) closeSheet(); };
    $('#dash-sheet-close').onclick = closeSheet;
  }

  function closeSheet() { $('#dash-sheet-overlay').classList.remove('open'); }

  // ── Listeners ──
  function startListeners() {
    cleanupListeners();

    const unsubRes = db.collection('users')
      .where('role', '==', 'resident')
      .where('active', '==', true)
      .orderBy('bed')
      .onSnapshot(snap => {
        residents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (currentSection === 'board') renderBoard();
        updateAppCount();
      });
    unsubscribers.push(unsubRes);
  }

  function cleanupListeners() { unsubscribers.forEach(fn => fn()); unsubscribers = []; }

  async function updateAppCount() {
    const snap = await db.collection('applications').where('status', '==', 'New').get();
    const badge = $('#nav-app-count');
    if (snap.size > 0) { badge.textContent = snap.size; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }

  // ── Render Sections ──
  function renderSection(section) {
    const el = $('#dash-content');
    switch (section) {
      case 'board': renderBoard(); break;
      case 'apps': renderApps(); break;
      case 'messages': renderMessages(); break;
      case 'money': renderMoney(); break;
      case 'records': renderRecords(); break;
      case 'residents': renderResidents(); break;
      case 'settings': renderSettings(); break;
    }
  }

  // ── Board ──
  function renderBoard() {
    const el = $('#dash-content');
    const homeCount = residents.filter(r => r.status === 'home').length;
    const awayCount = residents.filter(r => r.status === 'away').length;
    const lateCount = residents.filter(r => r.status === 'late').length;
    const totalBeds = 10;
    const openBeds = Math.max(0, totalBeds - residents.length);
    const rent = houseSettings.weeklyRent || 185;
    const collected = residents.reduce((a, r) => a + ((r.balance || 0) <= 0 ? rent : 0), 0);
    const outstanding = residents.reduce((a, r) => a + (r.balance || 0), 0);

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-5)">Tonight's board</h2>

      <div class="dash-grid" style="margin-bottom:var(--space-5)">
        <div class="stat-card"><div class="stat-value" style="color:var(--color-accent-400)">${homeCount}</div><div class="stat-label">Home</div></div>
        <div class="stat-card"><div class="stat-value">${awayCount}</div><div class="stat-label">Away</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--color-accent)">${lateCount}</div><div class="stat-label">Late</div></div>
        <div class="stat-card"><div class="stat-value">${openBeds}</div><div class="stat-label">Open beds</div></div>
      </div>

      <!-- Quick actions -->
      <div class="flex gap-3" style="margin-bottom:var(--space-5);flex-wrap:wrap">
        <button class="btn btn-primary" id="board-notify">Send a notice</button>
        <button class="btn btn-secondary" id="board-incident">Log incident</button>
        <button class="btn btn-secondary" id="board-test">Record test</button>
      </div>

      <!-- Flags -->
      <div id="board-flags" style="margin-bottom:var(--space-5)"></div>

      <!-- Roster -->
      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">All residents</h3>
      <div class="flex flex-col gap-1" style="margin-bottom:var(--space-5)">
        ${residents.map(r => {
          const statusColors = { home: 'var(--color-accent-400)', away: 'var(--color-neutral-500)', late: 'var(--color-accent)' };
          const statusLabels = { home: 'Home', away: 'Out', late: 'Late' };
          const flags = [];
          if (r.testDue) flags.push('screen due');
          if ((r.balance || 0) > 0) flags.push(money(r.balance) + ' behind');
          const flagStr = flags.length ? ' · ' + flags.join(', ') : '';
          const line = r.status === 'home' ? 'In the house · bed ' + r.bed
            : r.status === 'late' ? (r.eta || 'past curfew') + ' · notice given'
            : (r.where || 'Out') + ' · ' + (r.eta || 'no ETA');
          return `
            <div class="row-item" data-resident="${r.id}">
              <div class="avatar">${initials(r.name)}</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:500">${r.name}</div>
                <div class="text-muted" style="font-size:12px">${line}${flagStr}</div>
              </div>
              <span class="tag" style="color:${statusColors[r.status]};${r.status === 'late' ? 'border:1px solid var(--color-accent-700)' : ''}">${statusLabels[r.status] || 'Out'}</span>
            </div>`;
        }).join('')}
      </div>

      <!-- Activity feed -->
      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">Recent activity</h3>
      <div id="activity-feed"></div>
    `;

    // Load flags
    renderBoardFlags();

    // Load activity
    loadActivity();

    // Actions
    $('#board-notify').onclick = () => openManagerSheet('notify');
    $('#board-incident').onclick = () => openManagerSheet('incident');
    $('#board-test').onclick = () => openManagerSheet('test');

    // Click on resident to message
    $$('[data-resident]').forEach(row => {
      row.onclick = () => {
        currentSection = 'messages';
        $$('[data-section]').forEach(n => n.classList.remove('active'));
        $$('[data-section="messages"]').forEach(n => n.classList.add('active'));
        renderThreadView(row.dataset.resident);
      };
    });
  }

  async function renderBoardFlags() {
    const el = $('#board-flags');
    const flags = [];

    // Pending applications
    const appSnap = await db.collection('applications').where('status', '==', 'New').get();
    if (appSnap.size > 0) {
      flags.push({ title: appSnap.size + ' application' + (appSnap.size > 1 ? 's' : '') + ' waiting', cta: 'Review', action: 'apps' });
    }

    // Overdue rent
    const behind = residents.filter(r => (r.balance || 0) >= (houseSettings.weeklyRent || 185) * 2);
    if (behind.length) {
      flags.push({ title: behind[0].name + ' is ' + money(behind[0].balance) + ' behind', cta: 'Ledger', action: 'money' });
    }

    // Test due
    const testDue = residents.filter(r => r.testDue);
    if (testDue.length) {
      flags.push({ title: testDue[0].name + ' is due for a screen', cta: 'Record', action: 'test' });
    }

    if (!flags.length) { el.innerHTML = ''; return; }
    el.innerHTML = flags.map(f => `
      <div class="card flex items-center justify-between" style="margin-bottom:var(--space-2);border-left:3px solid var(--color-accent)">
        <div style="font-size:14px;font-weight:500">${f.title}</div>
        <button class="btn btn-primary" style="font-size:13px" data-flag-action="${f.action}">${f.cta}</button>
      </div>`).join('');

    el.querySelectorAll('[data-flag-action]').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.flagAction;
        if (action === 'test') { openManagerSheet('test'); return; }
        currentSection = action;
        $$('[data-section]').forEach(n => n.classList.remove('active'));
        $$(`[data-section="${action}"]`).forEach(n => n.classList.add('active'));
        renderSection(action);
      };
    });
  }

  async function loadActivity() {
    const snap = await db.collection('activity').orderBy('createdAt', 'desc').limit(8).get();
    const el = $('#activity-feed');
    el.innerHTML = snap.docs.map(d => {
      const a = d.data();
      return `<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider);font-size:13px">
        <div>${a.text}</div>
        <div class="text-muted" style="font-size:11px">${a.createdAt ? timeAgo(a.createdAt) : ''}</div>
      </div>`;
    }).join('') || '<div class="text-muted" style="font-size:13px">No activity yet</div>';
  }

  // ── Applications ──
  async function renderApps() {
    const snap = await db.collection('applications').orderBy('createdAt', 'desc').get();
    const apps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pending = apps.filter(a => a.status === 'New');
    const decided = apps.filter(a => a.status !== 'New');

    const el = $('#dash-content');
    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-2)">Intake queue</h2>
      <p class="text-muted" style="font-size:13px;margin-bottom:var(--space-5)">${pending.length} pending · ${decided.length} decided</p>

      ${pending.length === 0 ? '<div class="text-muted" style="padding:var(--space-8);text-align:center">No pending applications</div>' : ''}

      ${apps.map(a => `
        <div class="card" style="margin-bottom:var(--space-3)">
          <div class="flex items-center gap-3" style="margin-bottom:var(--space-3)">
            <div class="avatar" style="width:42px;height:42px">${initials(a.name)}</div>
            <div style="flex:1">
              <div style="font-weight:600">${a.name}</div>
              <div class="text-muted" style="font-size:12px">${a.dob || a.age || ''} · ${a.soberDate || a.clean || ''} clean · from ${a.referral || 'unknown'}</div>
            </div>
            <span class="tag ${a.status === 'New' ? 'tag-accent' : a.status === 'Accepted' ? 'tag-outline' : 'tag-neutral'}">${a.status}</span>
          </div>

          <div style="display:grid;grid-template-columns:100px 1fr;gap:var(--space-2);font-size:13px;margin-bottom:var(--space-3)">
            ${[
              ['Phone', a.phone], ['Sober date', a.soberDate], ['Substance', a.substance],
              ['Referral', a.referral], ['Income', a.income], ['Legal', a.legal],
              ['Meds', a.meds], ['Sponsor', a.sponsor], ['Emergency', a.emergency],
              ['Why here', a.why]
            ].filter(([,v]) => v).map(([k, v]) => `
              <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em">${k}</div>
              <div>${v}</div>
            `).join('')}
          </div>

          ${a.status === 'New' ? `
            <div class="flex gap-2">
              <button class="btn btn-primary" style="flex:1" data-decide="${a.id}" data-action="accept">Accept</button>
              <button class="btn btn-secondary" data-decide="${a.id}" data-action="waitlist">Waitlist</button>
              <button class="btn btn-ghost" data-decide="${a.id}" data-action="decline">Decline</button>
            </div>` : `
            <div class="text-muted" style="font-size:13px">${a.decisionNote || ''}</div>`}
        </div>`).join('')}
    `;

    el.querySelectorAll('[data-decide]').forEach(btn => {
      btn.onclick = () => decideApp(btn.dataset.decide, btn.dataset.action);
    });
  }

  async function decideApp(appId, action) {
    const appDoc = await db.collection('applications').doc(appId).get();
    const app = appDoc.data();

    if (action === 'accept') {
      const usedBeds = residents.map(r => r.bed);
      let bed = 1;
      for (let i = 1; i <= 10; i++) { if (!usedBeds.includes(i)) { bed = i; break; } }

      // Create user document for the new resident
      const newUserRef = db.collection('users').doc();
      await newUserRef.set({
        name: app.name,
        phone: app.phone || '',
        role: 'resident',
        active: true,
        bed,
        room: 'Room ' + Math.ceil(bed / 2),
        status: 'home',
        where: '',
        eta: '',
        soberDate: app.soberDate || new Date().toISOString().split('T')[0],
        sponsor: app.sponsor || 'Not yet assigned',
        sponsorPhone: '',
        sponsorHome: 'Needs a home group',
        sponsorLast: 'n/a',
        step: 1,
        chore: 'Unassigned — set at house meeting',
        meetings: 0,
        balance: houseSettings.weeklyRent || 185,
        paidThrough: 'Intake',
        testDue: true,
        tierResetOn: null,
        emergencyContacts: app.emergency ? [{ name: app.emergency, role: 'Emergency', phone: '' }] : [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('applications').doc(appId).update({
        status: 'Accepted',
        decisionNote: 'Accepted — bed ' + bed + ', intake today.'
      });

      // Send welcome message
      await db.collection('messages').add({
        threadId: newUserRef.id,
        from: currentUser.uid,
        senderName: userProfile.name,
        text: 'Welcome to the house, ' + app.name.split(' ')[0] + '. Bed ' + bed + '. Curfew is ' + (houseSettings.earlyCurfew || '10:00 PM') + ' for your first 30 days.',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await logActivity(app.name + ' accepted — bed ' + bed + '.');
      toast(app.name + ' accepted into bed ' + bed + '.');

    } else if (action === 'waitlist') {
      await db.collection('applications').doc(appId).update({
        status: 'Waitlist',
        decisionNote: 'On the waitlist. We\'ll call when a bed opens.'
      });
      toast(app.name + ' moved to waitlist.');

    } else {
      await db.collection('applications').doc(appId).update({
        status: 'Declined',
        decisionNote: 'Declined — referred out.'
      });
      toast(app.name + ' declined.');
    }

    renderApps();
  }

  // ── Messages ──
  async function renderMessages() {
    const el = $('#dash-content');

    // Build thread list
    const threads = [
      { id: 'house', name: 'House group', initials: 'HG', accent: true }
    ].concat(residents.map(r => ({
      id: r.id, name: r.name, initials: initials(r.name)
    })));

    // Get last message for each thread
    const threadData = await Promise.all(threads.map(async t => {
      const snap = await db.collection('messages')
        .where('threadId', '==', t.id)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      const lastMsg = snap.empty ? null : snap.docs[0].data();
      return { ...t, lastMsg };
    }));

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-5)">Messages</h2>
      <div class="flex flex-col gap-1">
        ${threadData.map(t => `
          <div class="row-item" data-thread="${t.id}">
            <div class="avatar ${t.accent ? 'avatar-accent' : ''}">${t.initials}</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500">${t.name}</div>
              <div class="text-muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">${t.lastMsg ? t.lastMsg.text : 'No messages'}</div>
            </div>
            <div class="text-muted" style="font-size:11px">${t.lastMsg ? timeAgo(t.lastMsg.createdAt) : ''}</div>
          </div>`).join('')}
      </div>
    `;

    el.querySelectorAll('[data-thread]').forEach(row => {
      row.onclick = () => renderThreadView(row.dataset.thread);
    });
  }

  async function renderThreadView(threadId) {
    const el = $('#dash-content');
    const threadName = threadId === 'house' ? 'House group' : (residents.find(r => r.id === threadId)?.name || 'Unknown');

    const snap = await db.collection('messages')
      .where('threadId', '==', threadId)
      .orderBy('createdAt', 'asc')
      .limitToLast(50)
      .get();

    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    el.innerHTML = `
      <div class="flex items-center gap-3" style="margin-bottom:var(--space-5)">
        <button class="btn btn-ghost" id="back-to-threads" style="padding:var(--space-2)">
          <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M224 128a8 8 0 01-8 8H59.3l58.4 58.3a8 8 0 01-11.4 11.4l-72-72a8 8 0 010-11.4l72-72a8 8 0 0111.4 11.4L59.3 120H216a8 8 0 018 8z"/></svg>
        </button>
        <div>
          <div style="font-weight:600;font-size:16px">${threadName}</div>
          <div class="text-muted" style="font-size:12px">${threadId === 'house' ? residents.length + ' residents' : ''}</div>
        </div>
      </div>

      <div id="thread-messages" style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)">
        ${messages.length === 0 ? '<div class="text-muted" style="text-align:center;padding:var(--space-8)">No messages yet</div>' : ''}
        ${messages.map(m => {
          const isManager = m.from === currentUser.uid;
          return `
            <div style="display:flex;justify-content:${isManager ? 'flex-end' : 'flex-start'}">
              <div style="max-width:70%;padding:var(--space-3) var(--space-4);border-radius:var(--radius-lg);
                background:${isManager ? 'var(--color-accent-900)' : 'var(--color-surface)'};
                border:1px solid ${isManager ? 'var(--color-accent-700)' : 'var(--color-divider)'}">
                <div style="font-size:14px">${m.text}</div>
                <div class="text-muted" style="font-size:11px;margin-top:2px">${m.senderName ? m.senderName.split(' ')[0] + ' · ' : ''}${timeAgo(m.createdAt)}</div>
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="flex gap-2" style="position:sticky;bottom:0;padding:var(--space-3) 0;background:var(--color-bg)">
        <input type="text" class="input" id="mgr-msg-input" placeholder="Message..." style="flex:1">
        <button class="btn btn-primary" id="mgr-send-btn" style="padding:0 var(--space-4)">
          <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M227.3 132.4l-176 88A8 8 0 0140 210.4L60.5 128 40 45.6a8 8 0 0111.3-9.2l176 88a8 8 0 010 8z"/></svg>
        </button>
      </div>
    `;

    const sendMsg = async () => {
      const input = $('#mgr-msg-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await db.collection('messages').add({
        threadId, from: currentUser.uid, senderName: userProfile.name,
        text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      renderThreadView(threadId); // refresh
    };

    $('#mgr-send-btn').onclick = sendMsg;
    $('#mgr-msg-input').onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
    $('#back-to-threads').onclick = () => renderMessages();

    // Scroll to bottom
    const msgs = $('#thread-messages');
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Rent Ledger ──
  async function renderMoney() {
    const el = $('#dash-content');
    const rent = houseSettings.weeklyRent || 185;
    const collected = residents.reduce((a, r) => a + ((r.balance || 0) <= 0 ? rent : 0), 0);
    const outstanding = residents.reduce((a, r) => a + Math.max(0, r.balance || 0), 0);

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-5)">Rent ledger</h2>

      <div class="dash-grid" style="margin-bottom:var(--space-5)">
        <div class="stat-card"><div class="stat-value">${money(collected)}</div><div class="stat-label">Collected this week</div></div>
        <div class="stat-card"><div class="stat-value" style="color:${outstanding > 0 ? 'var(--color-accent)' : ''}">${money(outstanding)}</div><div class="stat-label">Outstanding</div></div>
        <div class="stat-card"><div class="stat-value">${money(rent)}</div><div class="stat-label">Weekly rate</div></div>
      </div>

      <div class="flex flex-col gap-1" style="margin-bottom:var(--space-5)">
        ${residents.map(r => `
          <div class="row-item">
            <div class="avatar">${initials(r.name)}</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500">${r.name}</div>
              <div class="text-muted" style="font-size:12px">${(r.balance || 0) > 0 ? 'Paid through ' + (r.paidThrough || '—') : 'Current · through ' + (r.paidThrough || '—')}</div>
            </div>
            <div style="font-size:14px;color:${(r.balance || 0) > 0 ? 'var(--color-accent)' : 'var(--color-neutral-500)'}">${(r.balance || 0) > 0 ? money(r.balance) : 'Paid'}</div>
            <button class="btn btn-ghost" style="font-size:12px;padding:var(--space-1) var(--space-2)" data-record-pay="${r.id}">Record</button>
          </div>`).join('')}
      </div>

      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">Recent payments</h3>
      <div id="recent-payments"></div>
    `;

    // Load recent payments
    const paySnap = await db.collection('payments').orderBy('createdAt', 'desc').limit(10).get();
    const payEl = $('#recent-payments');
    payEl.innerHTML = paySnap.docs.map(d => {
      const p = d.data();
      return `<div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider);font-size:13px">
        <div>${p.userName || 'Unknown'}</div>
        <div class="text-muted">${p.method || ''}</div>
        <div>${money(p.amount)}</div>
        <span class="tag ${p.status === 'confirmed' ? 'tag-accent' : 'tag-neutral'}">${p.status || 'pending'}</span>
        ${p.status !== 'confirmed' ? `<button class="btn btn-ghost" style="font-size:11px;padding:2px 6px" data-confirm-pay="${d.id}" data-pay-uid="${p.userId}" data-pay-amt="${p.amount}">Confirm</button>` : ''}
      </div>`;
    }).join('') || '<div class="text-muted" style="font-size:13px">No payments recorded</div>';

    // Record payment buttons
    el.querySelectorAll('[data-record-pay]').forEach(btn => {
      btn.onclick = () => openRecordPayment(btn.dataset.recordPay);
    });

    // Confirm payment buttons
    el.querySelectorAll('[data-confirm-pay]').forEach(btn => {
      btn.onclick = async () => {
        const payId = btn.dataset.confirmPay;
        const uid = btn.dataset.payUid;
        const amt = parseFloat(btn.dataset.payAmt);
        await db.collection('payments').doc(payId).update({ status: 'confirmed' });
        await db.collection('users').doc(uid).update({
          balance: firebase.firestore.FieldValue.increment(-amt)
        });
        toast('Payment confirmed.');
        renderMoney();
      };
    });
  }

  function openRecordPayment(residentId) {
    const r = residents.find(x => x.id === residentId);
    if (!r) return;
    const rent = houseSettings.weeklyRent || 185;

    const overlay = $('#dash-sheet-overlay');
    $('#dash-sheet-title').textContent = 'Record payment — ' + r.name;
    $('#dash-sheet-body').textContent = 'Balance: ' + ((r.balance || 0) > 0 ? money(r.balance) : 'paid up');
    $('#dash-sheet-cta').textContent = 'Record payment';

    let method = 'Cash App';
    $('#dash-sheet-content').innerHTML = `
      <div style="margin-bottom:var(--space-3)">
        <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2)">Method</div>
        <div class="flex gap-2" style="flex-wrap:wrap" id="pay-method-chips">
          ${['Cash App', 'Zelle', 'Cash', 'Money order', 'Stripe'].map(m =>
            `<div class="chip ${m === 'Cash App' ? 'active' : ''}" data-method="${m}">${m}</div>`
          ).join('')}
        </div>
      </div>
      <div>
        <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Amount</label>
        <input type="text" class="input" id="pay-amount-input" placeholder="${money(rent)}" value="${rent}">
      </div>
    `;

    $('#pay-method-chips').querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        method = c.dataset.method;
        $('#pay-method-chips').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
      };
    });

    $('#dash-sheet-cta').onclick = async () => {
      const amt = parseFloat($('#pay-amount-input').value.replace(/[^0-9.]/g, '')) || rent;
      await db.collection('payments').add({
        userId: residentId, userName: r.name,
        amount: amt, method, status: 'confirmed',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection('users').doc(residentId).update({
        balance: firebase.firestore.FieldValue.increment(-amt)
      });
      await logActivity(money(amt) + ' recorded for ' + r.name + '.');
      toast('Recorded ' + money(amt) + ' from ' + r.name + '.');
      closeSheet();
      renderMoney();
    };

    overlay.classList.add('open');
  }

  // ── Records ──
  async function renderRecords() {
    const el = $('#dash-content');

    const [incSnap, testSnap, alumniSnap] = await Promise.all([
      db.collection('incidents').orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('tests').orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('alumni').orderBy('createdAt', 'desc').limit(10).get()
    ]);

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-5)">House records</h2>

      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">Incidents</h3>
      <div style="margin-bottom:var(--space-5)">
        ${incSnap.docs.map(d => {
          const i = d.data();
          return `<div class="card" style="margin-bottom:var(--space-2)">
            <div class="flex items-center justify-between">
              <div style="font-weight:500;font-size:14px">${i.residentName || ''}</div>
              <span class="tag tag-outline">${i.kind || ''}</span>
            </div>
            <div class="text-muted" style="font-size:13px;margin-top:var(--space-1)">${i.note || ''}</div>
            <div class="text-muted" style="font-size:11px;margin-top:var(--space-1)">${i.createdAt ? timeAgo(i.createdAt) : ''}</div>
          </div>`;
        }).join('') || '<div class="text-muted">No incidents</div>'}
      </div>

      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">Drug tests</h3>
      <div style="margin-bottom:var(--space-5)">
        ${testSnap.docs.map(d => {
          const t = d.data();
          return `<div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider)">
            <div style="font-size:14px">${t.residentName || ''}</div>
            <div class="text-muted" style="font-size:12px">${t.testType || ''}</div>
            <span class="tag ${t.result === 'Negative' ? 'tag-neutral' : 'tag-outline'}">${t.result || ''}</span>
            <div class="text-muted" style="font-size:11px">${t.createdAt ? timeAgo(t.createdAt) : ''}</div>
          </div>`;
        }).join('') || '<div class="text-muted">No tests</div>'}
      </div>

      <h3 style="font-size:16px;font-weight:600;margin-bottom:var(--space-3)">Alumni</h3>
      <div>
        ${alumniSnap.docs.map(d => {
          const a = d.data();
          return `<div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-divider)">
            <div style="font-size:14px">${a.name || ''}</div>
            <div class="text-muted" style="font-size:12px">${a.stay || ''}</div>
            <span class="tag ${a.kind === 'Graduated' ? 'tag-accent' : 'tag-neutral'}">${a.kind || ''}</span>
          </div>`;
        }).join('') || '<div class="text-muted">No alumni records</div>'}
      </div>
    `;
  }

  // ── Manage Residents ──
  function renderResidents() {
    const el = $('#dash-content');

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-2)">Manage residents</h2>
      <p class="text-muted" style="font-size:13px;margin-bottom:var(--space-5)">${residents.length} active residents</p>

      <button class="btn btn-primary" id="add-resident-btn" style="margin-bottom:var(--space-5)">+ Add resident manually</button>

      <div class="flex flex-col gap-2">
        ${residents.map(r => {
          const cd = cleanDays(r.soberDate);
          return `
            <div class="card" style="padding:var(--space-4)">
              <div class="flex items-center gap-3" style="margin-bottom:var(--space-3)">
                <div class="avatar" style="width:44px;height:44px;font-size:15px">${initials(r.name)}</div>
                <div style="flex:1">
                  <div style="font-weight:600">${r.name}</div>
                  <div class="text-muted" style="font-size:12px">Bed ${r.bed} · ${r.room || ''} · ${cd} days clean · ${r.phone || ''}</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);font-size:12px">
                <div><span class="text-muted">Chore:</span> ${r.chore || 'None'}</div>
                <div><span class="text-muted">Sponsor:</span> ${r.sponsor || 'None'}</div>
                <div><span class="text-muted">Balance:</span> ${(r.balance || 0) > 0 ? money(r.balance) : 'Paid'}</div>
              </div>
              <div class="flex gap-2" style="margin-top:var(--space-3)">
                <button class="btn btn-ghost" style="font-size:12px" data-edit-resident="${r.id}">Edit</button>
                <button class="btn btn-ghost" style="font-size:12px;color:#fca5a5" data-discharge="${r.id}">Discharge</button>
              </div>
            </div>`;
        }).join('')}
      </div>

      <!-- Room map -->
      <h3 style="font-size:16px;font-weight:600;margin:var(--space-5) 0 var(--space-3)">Rooms</h3>
      <div class="dash-grid">
        ${[1,2,3,4,5].map(roomNum => {
          const beds = [roomNum * 2 - 1, roomNum * 2];
          return `<div class="card">
            <h6 class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2)">Room ${roomNum}</h6>
            ${beds.map(bed => {
              const r = residents.find(x => x.bed === bed);
              if (r) {
                return `<div style="padding:var(--space-2) 0;font-size:13px">
                  <span class="text-muted">Bed ${bed}:</span> ${r.name.split(' ')[0]} ${r.name.split(' ')[1]?.[0] || ''}.
                  · ${cleanDays(r.soberDate)} days
                </div>`;
              }
              return `<div style="padding:var(--space-2) 0;font-size:13px;color:var(--color-accent)">
                <span class="text-muted">Bed ${bed}:</span> Open — ready for intake
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    `;

    // Add resident
    $('#add-resident-btn').onclick = () => openAddResident();

    // Edit buttons
    el.querySelectorAll('[data-edit-resident]').forEach(btn => {
      btn.onclick = () => openEditResident(btn.dataset.editResident);
    });

    // Discharge
    el.querySelectorAll('[data-discharge]').forEach(btn => {
      btn.onclick = () => dischargeResident(btn.dataset.discharge);
    });
  }

  function openAddResident() {
    const overlay = $('#dash-sheet-overlay');
    $('#dash-sheet-title').textContent = 'Add resident';
    $('#dash-sheet-body').textContent = 'Fill in the basics — you can edit the rest later.';
    $('#dash-sheet-cta').textContent = 'Add to house';

    const usedBeds = residents.map(r => r.bed);
    let nextBed = 1;
    for (let i = 1; i <= 10; i++) { if (!usedBeds.includes(i)) { nextBed = i; break; } }

    $('#dash-sheet-content').innerHTML = `
      <div class="flex flex-col gap-3">
        <input type="text" class="input" id="add-name" placeholder="Full name">
        <input type="tel" class="input" id="add-phone" placeholder="Phone number">
        <input type="text" class="input" id="add-sober" placeholder="Sober date (YYYY-MM-DD)">
        <input type="number" class="input" id="add-bed" placeholder="Bed number" value="${nextBed}" min="1" max="10">
      </div>
    `;

    $('#dash-sheet-cta').onclick = async () => {
      const name = $('#add-name').value.trim();
      const phone = $('#add-phone').value.trim();
      const sober = $('#add-sober').value.trim();
      const bed = parseInt($('#add-bed').value) || nextBed;

      if (!name) { toast('Name is required.'); return; }

      await db.collection('users').doc().set({
        name, phone, role: 'resident', active: true,
        bed, room: 'Room ' + Math.ceil(bed / 2),
        status: 'home', where: '', eta: '',
        soberDate: sober || new Date().toISOString().split('T')[0],
        sponsor: 'Not yet assigned', sponsorPhone: '', sponsorHome: '',
        sponsorLast: 'n/a', step: 1,
        chore: 'Unassigned', meetings: 0,
        balance: houseSettings.weeklyRent || 185,
        paidThrough: 'Intake', testDue: true, tierResetOn: null,
        emergencyContacts: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await logActivity(name + ' added to the house — bed ' + bed + '.');
      toast(name + ' added to bed ' + bed + '.');
      closeSheet();
      renderResidents();
    };

    overlay.classList.add('open');
  }

  function openEditResident(id) {
    const r = residents.find(x => x.id === id);
    if (!r) return;

    const overlay = $('#dash-sheet-overlay');
    $('#dash-sheet-title').textContent = 'Edit — ' + r.name;
    $('#dash-sheet-body').textContent = '';
    $('#dash-sheet-cta').textContent = 'Save changes';

    $('#dash-sheet-content').innerHTML = `
      <div class="flex flex-col gap-3">
        <div><label class="text-muted" style="font-size:11px">Chore</label><input type="text" class="input" id="edit-chore" value="${r.chore || ''}"></div>
        <div><label class="text-muted" style="font-size:11px">Bed</label><input type="number" class="input" id="edit-bed" value="${r.bed}" min="1" max="10"></div>
        <div><label class="text-muted" style="font-size:11px">Sponsor</label><input type="text" class="input" id="edit-sponsor" value="${r.sponsor || ''}"></div>
        <div><label class="text-muted" style="font-size:11px">Sponsor phone</label><input type="text" class="input" id="edit-sponsor-phone" value="${r.sponsorPhone || ''}"></div>
        <div><label class="text-muted" style="font-size:11px">Balance adjustment ($)</label><input type="number" class="input" id="edit-balance" value="${r.balance || 0}"></div>
        <div class="flex items-center gap-2">
          <input type="checkbox" id="edit-test-due" ${r.testDue ? 'checked' : ''} style="accent-color:var(--color-accent)">
          <label for="edit-test-due" style="font-size:13px">Test due</label>
        </div>
      </div>
    `;

    $('#dash-sheet-cta').onclick = async () => {
      await db.collection('users').doc(id).update({
        chore: $('#edit-chore').value,
        bed: parseInt($('#edit-bed').value) || r.bed,
        room: 'Room ' + Math.ceil((parseInt($('#edit-bed').value) || r.bed) / 2),
        sponsor: $('#edit-sponsor').value,
        sponsorPhone: $('#edit-sponsor-phone').value,
        balance: parseFloat($('#edit-balance').value) || 0,
        testDue: $('#edit-test-due').checked
      });
      toast('Updated ' + r.name + '.');
      closeSheet();
      renderResidents();
    };

    overlay.classList.add('open');
  }

  async function dischargeResident(id) {
    const r = residents.find(x => x.id === id);
    if (!r) return;
    if (!confirm('Discharge ' + r.name + '? This marks them inactive.')) return;

    await db.collection('users').doc(id).update({ active: false });
    await db.collection('alumni').add({
      name: r.name,
      stay: cleanDays(r.soberDate) + ' days',
      kind: 'Discharged',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await logActivity(r.name + ' discharged.');
    toast(r.name + ' discharged.');
    renderResidents();
  }

  // ── Settings ──
  function renderSettings() {
    const s = houseSettings;
    const el = $('#dash-content');

    el.innerHTML = `
      <h2 style="font-size:22px;font-weight:700;margin-bottom:var(--space-5)">House settings</h2>
      <div class="card" style="max-width:500px">
        <div class="flex flex-col gap-4">
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">House name</label>
            <input type="text" class="input" id="set-name" value="${s.name || ''}"></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Early curfew (first 30 days)</label>
            <input type="text" class="input" id="set-early" value="${s.earlyCurfew || '10:00 PM'}"></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Late curfew (good standing)</label>
            <input type="text" class="input" id="set-late" value="${s.lateCurfew || '12:00 AM'}"></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Weekly rent ($)</label>
            <input type="number" class="input" id="set-rent" value="${s.weeklyRent || 185}" min="100" max="500" step="5"></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Meetings required per week</label>
            <input type="number" class="input" id="set-meetings" value="${s.meetingsRequired || 3}" min="1" max="7"></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Test cadence</label>
            <select class="input" id="set-tests">
              ${['Random, weekly', 'Random, twice weekly', 'Weekly scheduled', 'For cause only'].map(o =>
                `<option ${s.testCadence === o ? 'selected' : ''}>${o}</option>`
              ).join('')}
            </select></div>
          <div><label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">Manager phone</label>
            <input type="tel" class="input" id="set-mgr-phone" value="${s.managerPhone || ''}"></div>
          <button class="btn btn-primary" id="save-settings" style="min-height:48px">Save settings</button>
        </div>
      </div>
    `;

    $('#save-settings').onclick = async () => {
      const newSettings = {
        name: $('#set-name').value,
        earlyCurfew: $('#set-early').value,
        lateCurfew: $('#set-late').value,
        weeklyRent: parseInt($('#set-rent').value) || 185,
        meetingsRequired: parseInt($('#set-meetings').value) || 3,
        testCadence: $('#set-tests').value,
        managerPhone: $('#set-mgr-phone').value
      };
      await db.collection('house').doc('settings').set(newSettings, { merge: true });
      houseSettings = { ...houseSettings, ...newSettings };
      toast('Settings saved.');
    };
  }

  // ── Manager Sheets (notify, incident, test) ──
  function openManagerSheet(type) {
    const overlay = $('#dash-sheet-overlay');
    let pick = null;
    let selectedResident = null;

    const defs = {
      notify: {
        title: 'Send a notice',
        body: 'Goes as a push notification. Leave everyone unpicked for house-wide.',
        chips: [['mail', 'Mail arrived'], ['test', 'Drug test'], ['meeting', 'House meeting'], ['rent', 'Rent'], ['curfew', 'Curfew check']],
        cta: 'Send notice'
      },
      incident: {
        title: 'Log an incident',
        body: 'Missed curfew and failed screens reset to early curfew for 30 days.',
        chips: ['Missed curfew', 'Late w/ notice', 'Failed test', 'Chore', 'Positive note'],
        cta: 'Save to record'
      },
      test: {
        title: 'Record a drug screen',
        body: 'Results go on the resident\'s record.',
        chips: ['Negative', 'Positive', 'Refused', 'Diluted'],
        cta: 'Save result'
      }
    };
    const def = defs[type];
    pick = typeof def.chips[0] === 'string' ? def.chips[0] : def.chips[0][0];

    $('#dash-sheet-title').textContent = def.title;
    $('#dash-sheet-body').textContent = def.body;
    $('#dash-sheet-cta').textContent = def.cta;

    $('#dash-sheet-content').innerHTML = `
      <div style="margin-bottom:var(--space-3)">
        <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2)">Type</div>
        <div class="flex gap-2" style="flex-wrap:wrap" id="mgr-chips">
          ${def.chips.map(c => {
            const val = typeof c === 'string' ? c : c[0];
            const label = typeof c === 'string' ? c : c[1];
            return `<div class="chip ${val === pick ? 'active' : ''}" data-val="${val}">${label}</div>`;
          }).join('')}
        </div>
      </div>
      <div style="margin-bottom:var(--space-3)">
        <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-2)">Resident</div>
        <div class="flex gap-2" style="flex-wrap:wrap" id="mgr-people">
          ${residents.map(r => `<div class="chip" data-pid="${r.id}">${r.name.split(' ')[0]} ${(r.name.split(' ')[1] || '')[0] || ''}.</div>`).join('')}
        </div>
      </div>
      <div>
        <label class="text-muted" style="font-size:12px;display:block;margin-bottom:4px">${type === 'test' ? 'Test type' : 'Details'}</label>
        <input type="text" class="input" id="mgr-sheet-input" placeholder="${type === 'test' ? 'Random, for cause, 12-panel' : 'Notes...'}">
      </div>
    `;

    // Chip selection
    $('#mgr-chips').querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        pick = c.dataset.val;
        $('#mgr-chips').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
      };
    });

    // People selection
    $('#mgr-people').querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        selectedResident = c.dataset.pid;
        $('#mgr-people').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x.dataset.pid === selectedResident));
      };
    });

    // CTA
    $('#dash-sheet-cta').onclick = async () => {
      const note = $('#mgr-sheet-input').value.trim();

      if (type === 'notify') {
        const ids = selectedResident ? [selectedResident] : residents.map(r => r.id);
        const copies = { mail: 'You\'ve got mail at the house.', test: 'You\'re up for a drug screen.', meeting: 'House meeting — attendance required.', rent: 'Rent reminder.', curfew: 'Curfew check tonight.' };
        const body = (copies[pick] || '') + (note ? ' ' + note : '');

        for (const id of ids) {
          await db.collection('notifications').add({
            to: id, type: pick, body, read: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await db.collection('messages').add({
            threadId: id, from: currentUser.uid, senderName: userProfile.name,
            text: body, createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        await logActivity('Notice sent to ' + (selectedResident ? '1 resident' : 'the whole house') + '.');
        toast('Notice sent.');

      } else if (type === 'incident') {
        if (!selectedResident) { toast('Pick a resident first.'); return; }
        const r = residents.find(x => x.id === selectedResident);
        const resets = pick === 'Missed curfew' || pick === 'Failed test';
        await db.collection('incidents').add({
          residentId: selectedResident, residentName: r?.name || '',
          kind: pick, note: note || 'No detail.', createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (resets && r) {
          await db.collection('users').doc(selectedResident).update({
            tierResetOn: new Date().toISOString().split('T')[0]
          });
        }
        await logActivity(pick + ' logged for ' + (r?.name || '') + '.');
        toast(resets ? (r?.name || '') + '\'s curfew reset to ' + (houseSettings.earlyCurfew || '10:00 PM') + ' for 30 days.' : 'Logged.');

      } else if (type === 'test') {
        if (!selectedResident) { toast('Pick a resident first.'); return; }
        const r = residents.find(x => x.id === selectedResident);
        await db.collection('tests').add({
          residentId: selectedResident, residentName: r?.name || '',
          result: pick, testType: note || 'Random',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('users').doc(selectedResident).update({ testDue: false });
        await logActivity('Drug screen for ' + (r?.name || '') + ' — ' + pick + '.');
        toast('Recorded. ' + (r?.name || '') + ' — ' + pick + '.');
      }

      closeSheet();
      if (currentSection === 'board') renderBoard();
    };

    overlay.classList.add('open');
  }

  async function logActivity(text) {
    await db.collection('activity').add({
      text, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      userId: currentUser.uid
    });
  }

  // ── Init ──
  setupAuth();
})();
