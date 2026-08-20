// Daly Recovery — Resident PWA Logic
// Requires Firebase to be initialized in firebase-config.js

(function () {
  'use strict';

  // ── Helpers ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const money = (n) => '$' + Number(n).toLocaleString('en-US');
  const initials = (name) => name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const DAY = 86400000;
  const cleanDays = (soberDate) => Math.max(0, Math.round((Date.now() - new Date(soberDate).getTime()) / DAY));
  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeAgo = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── State ──
  let currentUser = null;
  let userProfile = null;
  let houseSettings = null;
  let currentTab = 'home';
  let chatWith = 'mgr'; // 'mgr' or 'house'
  let activeSheet = null;
  let sheetPick = null;
  let unsubscribers = [];

  // ── Toast ──
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  // ── Auth ──
  let confirmationResult = null;

  function setupAuth() {
    $('#send-code-btn').onclick = async () => {
      const phone = formatPhone($('#phone-input').value);
      if (!phone) { showAuthError('Enter a valid phone number.'); return; }
      try {
        showAuthLoading(true);
        const recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { size: 'invisible' });
        confirmationResult = await auth.signInWithPhoneNumber(phone, recaptchaVerifier);
        $('#auth-step-phone').classList.add('hidden');
        $('#auth-step-code').classList.remove('hidden');
        $('#auth-phone-display').textContent = phone;
        showAuthLoading(false);
      } catch (err) {
        showAuthError(err.message);
        showAuthLoading(false);
      }
    };

    $('#verify-code-btn').onclick = async () => {
      const code = $('#code-input').value.trim();
      if (code.length !== 6) { showAuthError('Enter the 6-digit code.'); return; }
      try {
        showAuthLoading(true);
        await confirmationResult.confirm(code);
        // Auth state listener will handle the rest
      } catch (err) {
        showAuthError('Invalid code. Try again.');
        showAuthLoading(false);
      }
    };

    $('#back-to-phone-btn').onclick = () => {
      $('#auth-step-code').classList.add('hidden');
      $('#auth-step-phone').classList.remove('hidden');
      hideAuthError();
    };

    $('#apply-link').onclick = (e) => {
      e.preventDefault();
      $('#auth-screen').classList.add('hidden');
      $('#apply-screen').classList.remove('hidden');
      setupApplyForm();
    };

    $('#apply-back-to-login').onclick = () => {
      $('#apply-screen').classList.add('hidden');
      $('#auth-screen').classList.remove('hidden');
    };

    // Listen for auth state
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        await loadUserProfile();
        if (userProfile) {
          showApp();
        } else {
          // User exists in auth but not in Firestore — they might not be a resident yet
          showAuthError('Your account is not set up as a resident. Contact the house manager.');
          auth.signOut();
        }
      } else {
        currentUser = null;
        userProfile = null;
        showAuth();
      }
    });
  }

  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    if (digits.startsWith('+')) return raw.replace(/[^\d+]/g, '');
    return null;
  }

  function showAuthError(msg) {
    const el = $('#auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.display = 'block';
  }
  function hideAuthError() { $('#auth-error').classList.add('hidden'); }
  function showAuthLoading(on) {
    const el = $('#auth-loading');
    if (on) { el.classList.remove('hidden'); el.style.display = 'flex'; }
    else { el.classList.add('hidden'); }
  }

  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#auth-screen').style.display = 'flex';
    $('#app').classList.add('hidden');
    $('#apply-screen').classList.add('hidden');
    cleanupListeners();
  }

  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#auth-screen').style.display = 'none';
    $('#apply-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    loadHouseSettings();
    setupTabs();
    setupButtons();
    startListeners();
    renderHome();
  }

  // ── Load Data ──
  async function loadUserProfile() {
    try {
      const doc = await db.collection('users').doc(currentUser.uid).get();
      if (doc.exists) {
        userProfile = { id: doc.id, ...doc.data() };
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    }
  }

  async function loadHouseSettings() {
    try {
      const doc = await db.collection('house').doc('settings').get();
      if (doc.exists) {
        houseSettings = doc.data();
      } else {
        houseSettings = {
          name: 'Daly Recovery',
          earlyCurfew: '10:00 PM',
          lateCurfew: '12:00 AM',
          weeklyRent: 185,
          meetingsRequired: 3,
          testCadence: 'Random, weekly'
        };
      }
      $('#house-name').textContent = houseSettings.name;
    } catch (err) {
      console.error('Failed to load house settings:', err);
    }
  }

  function getCurfew() {
    if (!userProfile || !houseSettings) return '10:00 PM';
    const cd = cleanDays(userProfile.soberDate);
    if (userProfile.tierResetOn) {
      const resetDays = Math.round((Date.now() - new Date(userProfile.tierResetOn).getTime()) / DAY);
      if (resetDays < 30) return houseSettings.earlyCurfew;
    }
    return cd < 30 ? houseSettings.earlyCurfew : houseSettings.lateCurfew;
  }

  // ── Real-time Listeners ──
  function startListeners() {
    cleanupListeners();

    // Listen to own profile changes
    const unsubProfile = db.collection('users').doc(currentUser.uid)
      .onSnapshot(doc => {
        if (doc.exists) {
          userProfile = { id: doc.id, ...doc.data() };
          renderCurrentTab();
        }
      });
    unsubscribers.push(unsubProfile);

    // Listen to notifications
    const unsubNotifs = db.collection('notifications')
      .where('to', 'in', [currentUser.uid, 'all'])
      .where('read', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .onSnapshot(snap => {
        renderAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    unsubscribers.push(unsubNotifs);

    // Listen to messages (manager DMs)
    const unsubMsgs = db.collection('messages')
      .where('threadId', '==', currentUser.uid)
      .orderBy('createdAt', 'asc')
      .limitToLast(50)
      .onSnapshot(snap => {
        if (currentTab === 'chat' && chatWith === 'mgr') {
          renderChatThread(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      });
    unsubscribers.push(unsubMsgs);

    // Listen to house group chat
    const unsubHouse = db.collection('messages')
      .where('threadId', '==', 'house')
      .orderBy('createdAt', 'asc')
      .limitToLast(50)
      .onSnapshot(snap => {
        if (currentTab === 'chat' && chatWith === 'house') {
          renderChatThread(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      });
    unsubscribers.push(unsubHouse);
  }

  function cleanupListeners() {
    unsubscribers.forEach(fn => fn());
    unsubscribers = [];
  }

  // ── Tabs ──
  function setupTabs() {
    $$('.nav-item').forEach(item => {
      item.onclick = () => {
        const tab = item.dataset.tab;
        switchTab(tab);
      };
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.add('hidden'));
    $(`#tab-${tab}`).classList.remove('hidden');
    renderCurrentTab();
  }

  function renderCurrentTab() {
    if (!userProfile) return;
    switch (currentTab) {
      case 'home': renderHome(); break;
      case 'chat': renderChat(); break;
      case 'house': renderHouse(); break;
      case 'me': renderMe(); break;
    }
  }

  // ── Render: Home Tab ──
  function renderHome() {
    if (!userProfile) return;
    const p = userProfile;
    const s = houseSettings || {};

    // Greeting
    $('#greeting').textContent = getGreeting() + ', ' + (p.name || '').split(' ')[0];

    // Status
    const statusColors = { home: 'var(--color-accent-400)', away: 'var(--color-neutral-500)', late: 'var(--color-accent)' };
    $('#status-dot').style.background = statusColors[p.status] || statusColors.away;
    $('#status-label').textContent = p.status === 'home' ? 'Home' : p.status === 'late' ? 'Running late' : 'Checked out';
    if (p.status === 'home') {
      $('#status-detail').textContent = 'Signed in at the house.';
    } else if (p.status === 'late') {
      $('#status-detail').textContent = 'Notice sent — ' + (p.eta || 'past curfew') + '. Get here safe.';
    } else {
      $('#status-detail').textContent = (p.where || 'Out') + ' · ' + (p.eta || 'back before curfew');
    }

    // Chore
    $('#my-chore').textContent = p.chore || 'No chore assigned';

    // Rent
    const balance = p.balance || 0;
    $('#my-balance').textContent = balance > 0 ? money(balance) + ' due' : 'Paid up';
    $('#my-balance').style.color = balance > 0 ? 'var(--color-accent)' : 'var(--color-text)';
    $('#my-rent-note').textContent = balance > 0 ? 'Paid through ' + (p.paidThrough || '—') : 'Current through ' + (p.paidThrough || '—');

    // Events
    loadEvents();
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  }

  async function loadEvents() {
    try {
      const snap = await db.collection('events')
        .where('date', '>=', new Date().toISOString().split('T')[0])
        .orderBy('date')
        .limit(5)
        .get();

      const el = $('#events-list');
      if (snap.empty) {
        el.innerHTML = '<div class="text-muted" style="font-size:13px">No upcoming events</div>';
        return;
      }

      el.innerHTML = snap.docs.map(d => {
        const ev = d.data();
        const date = new Date(ev.date + 'T00:00:00');
        const day = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dateNum = date.getDate();
        return `
          <div class="card flex gap-3 items-center" style="padding:var(--space-3) var(--space-4)">
            <div style="text-align:center;min-width:36px">
              <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase" class="text-muted">${day}</div>
              <div style="font-size:18px;font-weight:600">${dateNum}</div>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500">${ev.title}</div>
              <div class="text-muted" style="font-size:12px">${ev.time || ''} · ${ev.location || ''}</div>
            </div>
            ${ev.tag ? `<span class="tag ${ev.required ? 'tag-outline' : 'tag-neutral'}">${ev.tag}</span>` : ''}
          </div>`;
      }).join('');
    } catch (err) {
      console.error('Failed to load events:', err);
    }
  }

  // ── Render: Alerts ──
  function renderAlerts(alerts) {
    const section = $('#alerts-section');
    const badge = $('#alert-badge');

    if (!alerts.length) {
      section.classList.add('hidden');
      badge.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    badge.classList.remove('hidden');

    const glyphs = { mail: '✉', test: '◎', meeting: '⚑', rent: '$', curfew: '◔' };
    const titles = { mail: 'You\'ve got mail', test: 'Drug screen', meeting: 'House meeting', rent: 'Rent reminder', curfew: 'Curfew check' };

    section.innerHTML = alerts.map(a => {
      const urgent = a.type === 'test' || a.type === 'curfew';
      return `
        <div class="card" style="margin-bottom:var(--space-2);border-left:3px solid ${urgent ? 'var(--color-accent)' : 'var(--color-accent-900)'}">
          <div class="flex items-center justify-between" style="margin-bottom:var(--space-1)">
            <div class="flex items-center gap-2">
              <span style="font-size:16px">${glyphs[a.type] || '📢'}</span>
              <span style="font-weight:500;font-size:14px">${titles[a.type] || 'Notice'}</span>
            </div>
            <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" data-ack="${a.id}">Got it</button>
          </div>
          <div class="text-muted" style="font-size:13px">${a.body || ''}</div>
          <div class="text-muted" style="font-size:11px;margin-top:var(--space-1)">${a.createdAt ? timeAgo(a.createdAt) : ''}</div>
        </div>`;
    }).join('');

    section.querySelectorAll('[data-ack]').forEach(btn => {
      btn.onclick = () => {
        db.collection('notifications').doc(btn.dataset.ack).update({ read: true });
        toast('Marked as seen.');
      };
    });
  }

  // ── Render: Chat Tab ──
  function renderChat() {
    $('#chat-mgr-tab').classList.toggle('active', chatWith === 'mgr');
    $('#chat-house-tab').classList.toggle('active', chatWith === 'house');

    const threadId = chatWith === 'house' ? 'house' : currentUser.uid;
    db.collection('messages')
      .where('threadId', '==', threadId)
      .orderBy('createdAt', 'asc')
      .limitToLast(50)
      .get()
      .then(snap => renderChatThread(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }

  function renderChatThread(messages) {
    const el = $('#chat-thread');
    if (!messages.length) {
      el.innerHTML = '<div class="text-muted" style="text-align:center;padding:var(--space-8);font-size:13px">No messages yet</div>';
      return;
    }

    el.innerHTML = messages.map(m => {
      const mine = m.from === currentUser.uid;
      const senderName = m.senderName || '';
      const who = chatWith === 'house' && !mine ? senderName.split(' ')[0] + ' · ' : '';
      return `
        <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'}">
          <div style="max-width:80%;padding:var(--space-3) var(--space-4);border-radius:var(--radius-lg);
            background:${mine ? 'var(--color-accent-900)' : 'var(--color-surface)'};
            border:1px solid ${mine ? 'var(--color-accent-700)' : 'var(--color-divider)'}">
            <div style="font-size:14px;line-height:1.5">${m.text}</div>
            <div class="text-muted" style="font-size:11px;margin-top:2px">${who}${m.createdAt ? timeAgo(m.createdAt) : ''}</div>
          </div>
        </div>`;
    }).join('');

    el.scrollTop = el.scrollHeight;
  }

  // ── Render: House Tab ──
  async function renderHouse() {
    // Roster
    try {
      const snap = await db.collection('users')
        .where('role', '==', 'resident')
        .where('active', '==', true)
        .orderBy('bed')
        .get();

      const el = $('#roster-list');
      el.innerHTML = snap.docs.map(d => {
        const r = d.data();
        const statusColors = { home: 'var(--color-accent-400)', away: 'var(--color-neutral-500)', late: 'var(--color-accent)' };
        const statusLabels = { home: 'Home', away: 'Out', late: 'Late' };
        return `
          <div class="row-item">
            <div class="avatar">${initials(r.name)}</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500">${r.name}</div>
              <div class="text-muted" style="font-size:12px">Bed ${r.bed} · ${r.status === 'home' ? 'In the house' : r.where || 'Out'}</div>
            </div>
            <span class="tag" style="background:${r.status === 'home' ? 'var(--color-accent-900)' : r.status === 'late' ? 'transparent' : 'var(--color-neutral-800)'};
              color:${statusColors[r.status] || statusColors.away};
              ${r.status === 'late' ? 'border:1px solid var(--color-accent-700)' : ''}">${statusLabels[r.status] || 'Out'}</span>
          </div>`;
      }).join('');
    } catch (err) {
      console.error('Roster load failed:', err);
    }

    // Chores
    try {
      const snap = await db.collection('chores')
        .orderBy('assignedTo')
        .get();

      const el = $('#chores-list');
      el.innerHTML = snap.docs.map(d => {
        const c = d.data();
        return `
          <div class="card" style="padding:var(--space-3) var(--space-4)">
            <div class="flex items-center justify-between">
              <div>
                <div style="font-size:14px;font-weight:500">${c.task}</div>
                <div class="text-muted" style="font-size:12px">${c.assignedToName || 'Unassigned'}</div>
              </div>
              <span class="tag ${c.done ? 'tag-accent' : 'tag-neutral'}">${c.done ? 'Done' : 'Open'}</span>
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      console.error('Chores load failed:', err);
    }

    // Calendar
    loadEvents().then(() => {
      // Events already rendered in #events-list, copy to calendar
      const calEl = $('#calendar-list');
      calEl.innerHTML = $('#events-list').innerHTML;
    });
  }

  // ── Render: Me Tab ──
  function renderMe() {
    if (!userProfile) return;
    const p = userProfile;
    const s = houseSettings || {};

    $('#my-avatar').textContent = initials(p.name);
    $('#my-name').textContent = p.name;
    $('#my-bed-line').textContent = `Bed ${p.bed} · ${p.room || ''} · ${cleanDays(p.soberDate)} days clean`;

    // Clean time
    const cd = cleanDays(p.soberDate);
    $('#clean-days').textContent = cd;
    $('#sober-date').textContent = fmt(p.soberDate);
    const pct = Math.min(100, Math.round((cd % 90) / 90 * 100));
    $('#milestone-bar').style.width = pct + '%';
    if (cd < 30) $('#milestone-note').textContent = (30 - cd) + ' days to your 30-day chip';
    else if (cd < 90) $('#milestone-note').textContent = (90 - cd) + ' days to 90';
    else $('#milestone-note').textContent = 'Past 90 — keep going';

    // Sponsor
    $('#sponsor-avatar').textContent = initials(p.sponsor || 'NA');
    $('#sponsor-name').textContent = p.sponsor || 'Not yet assigned';
    $('#sponsor-detail').textContent = (p.sponsorPhone || '') + (p.sponsorHome ? ' · ' + p.sponsorHome : '');
    $('#sponsor-meta').textContent = `Last contact ${p.sponsorLast || 'n/a'}. Step ${p.step || 1} in progress with ${(p.sponsor || '').split(' ')[0] || 'sponsor'}.`;

    // Meetings
    $('#meetings-label').textContent = `${p.meetings || 0} of ${s.meetingsRequired || 3} this week`;
    $('#my-step').textContent = p.step || 1;

    // Rent
    const balance = p.balance || 0;
    $('#me-balance').textContent = balance > 0 ? money(balance) + ' due' : 'Paid up';
    $('#me-balance').style.color = balance > 0 ? 'var(--color-accent)' : '';
    $('#me-rent-note').textContent = balance > 0 ? 'Paid through ' + (p.paidThrough || '—') : 'Current through ' + (p.paidThrough || '—');

    // Payment history
    loadPaymentHistory();

    // Contacts
    renderContacts();

    // Meeting log
    loadMeetingLog();
  }

  async function loadPaymentHistory() {
    try {
      const snap = await db.collection('payments')
        .where('userId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      const el = $('#payment-history');
      el.innerHTML = snap.docs.map(d => {
        const p = d.data();
        return `
          <div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-top:1px solid var(--color-divider)">
            <div class="text-muted" style="font-size:13px">${p.createdAt ? timeAgo(p.createdAt) : ''} · ${p.method || ''}</div>
            <div style="font-size:14px">${money(p.amount)}</div>
          </div>`;
      }).join('');
    } catch (err) { console.error('Payment history error:', err); }
  }

  async function loadMeetingLog() {
    try {
      const snap = await db.collection('checkins')
        .where('userId', '==', currentUser.uid)
        .where('type', '==', 'meeting')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      const el = $('#meeting-log');
      el.innerHTML = snap.docs.map(d => {
        const m = d.data();
        return `
          <div class="flex items-center justify-between" style="padding:var(--space-2) 0;border-top:1px solid var(--color-divider)">
            <div style="font-size:13px">${m.meetingName || 'Meeting'}</div>
            <div class="text-muted" style="font-size:12px">${m.createdAt ? timeAgo(m.createdAt) : ''}</div>
          </div>`;
      }).join('');
    } catch (err) { console.error('Meeting log error:', err); }
  }

  function renderContacts() {
    const p = userProfile;
    const contacts = [
      { name: 'Pat Daly', role: 'House manager', phone: houseSettings?.managerPhone || '(415) 555-0100' },
      ...(p.emergencyContacts || [])
    ];
    const el = $('#contacts-list');
    el.innerHTML = contacts.map(c => `
      <div class="card" style="padding:var(--space-3) var(--space-4)">
        <div class="flex items-center justify-between">
          <div>
            <div style="font-size:14px;font-weight:500">${c.name}</div>
            <div class="text-muted" style="font-size:12px">${c.role} · ${c.phone}</div>
          </div>
          <a href="tel:${c.phone.replace(/\D/g, '')}" class="btn btn-ghost" style="padding:var(--space-2)">
            <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M222.4 158.3l-47.1-21.1a8 8 0 00-7.7.9l-33.2 24.9a7.8 7.8 0 01-8 .3 139.8 139.8 0 01-37.7-37.7 7.8 7.8 0 01.3-8l24.9-33.2a8 8 0 00.9-7.7L93.7 29.6A8 8 0 0085.3 24h-40A8 8 0 0037.2 32C32 139.6 116.4 224 224 218.8a8 8 0 008-8.1v-40a8 8 0 00-5.6-8.4z"/></svg>
          </a>
        </div>
      </div>`).join('');
  }

  // ── Buttons & Actions ──
  function setupButtons() {
    // Check in
    $('#btn-checkin').onclick = async () => {
      if (userProfile.status === 'home') { toast('You\'re already marked home.'); return; }
      await db.collection('users').doc(currentUser.uid).update({
        status: 'home', where: '', eta: ''
      });
      await db.collection('checkins').add({
        userId: currentUser.uid, userName: userProfile.name,
        type: 'checkin', createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await sendMsg(currentUser.uid, 'Checked in — I\'m home.');
      await logActivity(userProfile.name + ' checked in — home.');
      toast('Checked in. The board shows you home.');
    };

    // Check out
    $('#btn-checkout').onclick = () => openSheet('checkout');
    $('#btn-late').onclick = () => openSheet('late');
    $('#btn-pay-rent').onclick = () => openSheet('pay');
    $('#btn-chore-done').onclick = async () => {
      try {
        const snap = await db.collection('chores')
          .where('assignedTo', '==', currentUser.uid)
          .where('done', '==', false)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ done: true });
          toast('Chore marked done. Nice work.');
        } else {
          toast('No open chore to mark.');
        }
      } catch (err) { toast('Error marking chore.'); }
    };

    // Chat tabs
    $('#chat-mgr-tab').onclick = () => { chatWith = 'mgr'; renderChat(); };
    $('#chat-house-tab').onclick = () => { chatWith = 'house'; renderChat(); };

    // Send message
    $('#btn-send-msg').onclick = sendChatMessage;
    $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') sendChatMessage(); };

    // Alert bell
    $('#alert-bell').onclick = () => switchTab('home');

    // Sponsor buttons
    $('#btn-call-sponsor').onclick = () => {
      if (userProfile.sponsorPhone && userProfile.sponsorPhone !== '—') {
        window.location.href = 'tel:' + userProfile.sponsorPhone.replace(/\D/g, '');
      } else { toast('No sponsor phone on file.'); }
    };
    $('#btn-text-sponsor').onclick = () => {
      if (userProfile.sponsorPhone && userProfile.sponsorPhone !== '—') {
        window.location.href = 'sms:' + userProfile.sponsorPhone.replace(/\D/g, '');
      } else { toast('No sponsor phone on file.'); }
    };

    // Log meeting
    $('#btn-log-meeting').onclick = async () => {
      const req = houseSettings?.meetingsRequired || 3;
      const current = (userProfile.meetings || 0) + 1;
      await db.collection('users').doc(currentUser.uid).update({
        meetings: firebase.firestore.FieldValue.increment(1)
      });
      await db.collection('checkins').add({
        userId: currentUser.uid, userName: userProfile.name,
        type: 'meeting', meetingName: 'Meeting logged',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await logActivity(userProfile.name + ' logged a meeting.');
      toast('Meeting logged. ' + current + ' of ' + req + ' this week.');
    };

    // Sign out
    $('#btn-sign-out').onclick = () => {
      auth.signOut();
      toast('Signed out.');
    };

    // Sheet overlay close
    $('#sheet-overlay').onclick = (e) => { if (e.target === e.currentTarget) closeSheet(); };
    $('#sheet-close').onclick = closeSheet;
    $('#sheet-cta').onclick = confirmSheet;
  }

  async function sendChatMessage() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    const threadId = chatWith === 'house' ? 'house' : currentUser.uid;
    await db.collection('messages').add({
      threadId, from: currentUser.uid, senderName: userProfile.name,
      text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function sendMsg(threadId, text) {
    await db.collection('messages').add({
      threadId, from: currentUser.uid, senderName: userProfile.name,
      text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function logActivity(text) {
    await db.collection('activity').add({
      text, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      userId: currentUser.uid
    });
  }

  // ── Sheet / Bottom-sheet Actions ──
  const SHEET_DEFS = {
    checkout: {
      title: 'Where are you headed?',
      body: 'This marks you out and tells the house when to expect you back.',
      chipsLabel: 'Reason',
      chips: ['Work', 'Meeting', 'Appointment', 'Family', 'Gym', 'Errand'],
      inputLabel: 'Details (optional)', placeholder: 'e.g. Work — back 6:30',
      cta: 'Check out'
    },
    late: {
      title: 'Give notice before curfew',
      body: 'Notice ahead of time gets handled differently than walking in late with no word.',
      chipsLabel: 'How late',
      chips: ['15 minutes', '30 minutes', '1 hour', 'More than an hour'],
      inputLabel: 'What\'s going on', placeholder: 'Ride fell through, meeting ran long...',
      cta: 'Send notice'
    },
    pay: {
      title: 'Pay rent',
      body: '',
      chipsLabel: 'Method',
      chips: ['Stripe (card)', 'Cash App', 'Zelle', 'Cash to Pat', 'Money order'],
      inputLabel: 'Amount', placeholder: '',
      cta: 'Send payment'
    }
  };

  function openSheet(type) {
    activeSheet = type;
    const def = SHEET_DEFS[type];
    if (!def) return;

    const s = houseSettings || {};
    const rent = s.weeklyRent || 185;
    const balance = userProfile?.balance || 0;

    if (type === 'pay') {
      def.body = `Weekly rate is ${money(rent)}. Balance: ${balance > 0 ? money(balance) : 'paid up'}.`;
      def.placeholder = money(rent);
    }
    if (type === 'late') {
      def.body += ` Curfew tonight is ${getCurfew()}.`;
    }

    sheetPick = def.chips[0];
    $('#sheet-title').textContent = def.title;
    $('#sheet-body').textContent = def.body;
    $('#sheet-cta').textContent = def.cta;

    // Chips
    if (def.chips) {
      $('#sheet-chips-section').classList.remove('hidden');
      $('#sheet-chips-label').textContent = def.chipsLabel;
      renderSheetChips(def.chips);
    } else {
      $('#sheet-chips-section').classList.add('hidden');
    }

    // Input
    if (def.inputLabel) {
      $('#sheet-input-section').classList.remove('hidden');
      $('#sheet-input-label').textContent = def.inputLabel;
      $('#sheet-input').placeholder = def.placeholder;
      $('#sheet-input').value = '';
    } else {
      $('#sheet-input-section').classList.add('hidden');
    }

    $('#sheet-overlay').classList.add('open');
  }

  function renderSheetChips(chips) {
    const el = $('#sheet-chips');
    el.innerHTML = chips.map(c => {
      const active = c === sheetPick;
      return `<div class="chip ${active ? 'active' : ''}" data-chip="${c}">${c}</div>`;
    }).join('');
    el.querySelectorAll('.chip').forEach(chip => {
      chip.onclick = () => {
        sheetPick = chip.dataset.chip;
        renderSheetChips(chips);
      };
    });
  }

  function closeSheet() {
    $('#sheet-overlay').classList.remove('open');
    activeSheet = null;
  }

  async function confirmSheet() {
    const input = $('#sheet-input').value.trim();
    const type = activeSheet;

    if (type === 'checkout') {
      const where = input || sheetPick || 'Out';
      await db.collection('users').doc(currentUser.uid).update({
        status: 'away', where, eta: 'back by ' + getCurfew()
      });
      await db.collection('checkins').add({
        userId: currentUser.uid, userName: userProfile.name,
        type: 'checkout', where, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await sendMsg(currentUser.uid, 'Checked out — ' + where + '. Back before curfew.');
      await logActivity(userProfile.name + ' checked out — ' + where + '.');
      toast('Checked out. Pat can see where you are.');

    } else if (type === 'late') {
      const mins = sheetPick || '30 minutes';
      const why = input || 'no reason given';
      await db.collection('users').doc(currentUser.uid).update({
        status: 'late', eta: mins + ' late'
      });
      await sendMsg(currentUser.uid, 'Heads up — I\'m going to be about ' + mins + ' past curfew. Reason: ' + why + '.');
      await logActivity(userProfile.name + ' gave notice — ' + mins + ' past curfew.');
      toast('Notice sent. Giving notice counts — it\'s logged with the time.');

    } else if (type === 'pay') {
      const method = sheetPick || 'Cash App';
      const rent = houseSettings?.weeklyRent || 185;
      const amt = parseFloat(input.replace(/[^0-9.]/g, '')) || rent;

      if (method === 'Stripe (card)') {
        // Redirect to Stripe checkout
        try {
          toast('Redirecting to payment...');
          const response = await fetch(STRIPE_CHECKOUT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: Math.round(amt * 100), // cents
              userId: currentUser.uid,
              userName: userProfile.name,
              email: currentUser.email || ''
            })
          });
          const { url } = await response.json();
          if (url) window.location.href = url;
          else toast('Payment setup failed. Try another method.');
        } catch (err) {
          toast('Payment error. Try Cash App or Zelle instead.');
          console.error('Stripe error:', err);
        }
      } else {
        // Manual payment record (manager confirms)
        await db.collection('payments').add({
          userId: currentUser.uid, userName: userProfile.name,
          amount: amt, method, status: 'pending',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await logActivity(userProfile.name + ' submitted ' + money(amt) + ' rent payment (' + method + ').');
        toast('Payment of ' + money(amt) + ' submitted. Pat will confirm it.');
      }
    }

    closeSheet();
  }

  // ── Apply Form (no auth) ──
  const APPLY_STEPS = [
    { label: 'Step 1 of 3 — About you', fields: [
      { key: 'name', label: 'Full name', placeholder: 'First and last' },
      { key: 'phone', label: 'Cell phone', placeholder: '(415) 000-0000', hint: 'We text your sign-in code here.' },
      { key: 'dob', label: 'Date of birth', placeholder: 'MM / DD / YYYY' },
      { key: 'emergency', label: 'Emergency contact', placeholder: 'Name, relationship, phone' },
    ] },
    { label: 'Step 2 of 3 — Your recovery', fields: [
      { key: 'soberDate', label: 'Sober date', placeholder: 'MM / DD / YYYY', hint: 'Best guess is fine. Honesty matters more than the number.' },
      { key: 'substance', label: 'Drug of choice', placeholder: 'What you were using' },
      { key: 'referral', label: 'Coming from', placeholder: 'Detox, jail, treatment, the street, home' },
      { key: 'meds', label: 'Current medications', placeholder: 'Include anything prescribed' },
      { key: 'sponsor', label: 'Sponsor, if you have one', placeholder: 'Name and phone' },
    ] },
    { label: 'Step 3 of 3 — Practical', fields: [
      { key: 'income', label: 'Income or work', placeholder: 'Job, benefits, or none yet' },
      { key: 'legal', label: 'Legal situation', placeholder: 'Probation, court dates, PO name' },
      { key: 'why', label: 'Why this house, why now', placeholder: 'A few sentences in your own words' },
    ] },
  ];

  let applyStep = 0;
  let applyData = {};

  function setupApplyForm() {
    applyStep = 0;
    applyData = {};
    renderApplyStep();

    $('#apply-next-btn').onclick = () => {
      // Save current fields
      $$('#apply-fields input, #apply-fields textarea').forEach(f => {
        applyData[f.dataset.key] = f.value;
      });

      if (applyStep < 2) {
        applyStep++;
        renderApplyStep();
      } else {
        // Submit
        if (!$('#apply-agree-check').checked) {
          toast('Check the house agreement box to send it in.');
          return;
        }
        submitApplication();
      }
    };

    $('#apply-back-btn').onclick = () => {
      // Save current
      $$('#apply-fields input, #apply-fields textarea').forEach(f => {
        applyData[f.dataset.key] = f.value;
      });
      if (applyStep > 0) { applyStep--; renderApplyStep(); }
    };
  }

  function renderApplyStep() {
    const step = APPLY_STEPS[applyStep];
    $('#apply-step-label').textContent = step.label;

    const bars = ['#step-1-bar', '#step-2-bar', '#step-3-bar'];
    bars.forEach((b, i) => {
      $(b).style.background = i <= applyStep ? 'var(--color-accent)' : 'var(--color-neutral-800)';
    });

    $('#apply-fields').innerHTML = step.fields.map(f => `
      <div>
        <label style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">${f.label}</label>
        ${f.key === 'why' ?
          `<textarea class="input" data-key="${f.key}" placeholder="${f.placeholder}" rows="3" style="resize:vertical">${applyData[f.key] || ''}</textarea>` :
          `<input type="text" class="input" data-key="${f.key}" placeholder="${f.placeholder}" value="${applyData[f.key] || ''}">`
        }
        ${f.hint ? `<div class="text-muted" style="font-size:11px;margin-top:2px">${f.hint}</div>` : ''}
      </div>`).join('');

    if (applyStep > 0) $('#apply-back-btn').classList.remove('hidden');
    else $('#apply-back-btn').classList.add('hidden');

    if (applyStep === 2) {
      $('#apply-next-btn').textContent = 'Send my application';
      $('#apply-agree-section').classList.remove('hidden');
    } else {
      $('#apply-next-btn').textContent = 'Continue';
      $('#apply-agree-section').classList.add('hidden');
    }
  }

  async function submitApplication() {
    try {
      await db.collection('applications').add({
        name: applyData.name || 'Unknown',
        phone: applyData.phone || '',
        dob: applyData.dob || '',
        emergency: applyData.emergency || '',
        soberDate: applyData.soberDate || '',
        substance: applyData.substance || '',
        referral: applyData.referral || '',
        meds: applyData.meds || '',
        sponsor: applyData.sponsor || '',
        income: applyData.income || '',
        legal: applyData.legal || '',
        why: applyData.why || '',
        status: 'New',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $('#apply-form').classList.add('hidden');
      $('#apply-success').classList.remove('hidden');
    } catch (err) {
      toast('Error sending application. Try again.');
      console.error('Apply error:', err);
    }
  }

  // ── Init ──
  setupAuth();
})();
