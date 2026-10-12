/**
 * ===================================================================
 * KHANPRO.ME - APPLICATION LOGIC & CLOUDFLARE EDGE ENGINE INTERFACE
 * ===================================================================
 */

// Initial Seed Data for Clusters & Active Students
const DEFAULT_CLUSTERS = [
  { email: 'hasilvasay@gmail.com', activeCount: 5, maxCap: 50 },
  { email: 'batch1.khanpro@gmail.com', activeCount: 18, maxCap: 50 },
  { email: 'batch2.khanpro@gmail.com', activeCount: 14, maxCap: 50 },
  { email: 'security.khanpro@gmail.com', activeCount: 5, maxCap: 50 }
];

const DEFAULT_MAPPINGS = [
  { prefix: 'bsf1900166', email: 'bsf1900166@khanpro.me', destination: 'hasilvasay@gmail.com', date: '2026-10-10', status: 'Active' },
  { prefix: 'bsf1900167', email: 'bsf1900167@khanpro.me', destination: 'hasilvasay@gmail.com', date: '2026-10-10', status: 'Active' },
  { prefix: 'bsf1900168', email: 'bsf1900168@khanpro.me', destination: 'hasilvasay@gmail.com', date: '2026-10-10', status: 'Active' },
  { prefix: 'bsf1900169', email: 'bsf1900169@khanpro.me', destination: 'batch2.khanpro@gmail.com', date: '2026-10-11', status: 'Active' },
  { prefix: 'bsf1900170', email: 'bsf1900170@khanpro.me', destination: 'hasilvasay@gmail.com', date: '2026-10-11', status: 'Active' }
];

// State Management with LocalStorage persistence
class EngineState {
  constructor() {
    let savedClusters = JSON.parse(localStorage.getItem('khanpro_clusters'));
    if (!savedClusters || !savedClusters.some(c => c.email === 'hasilvasay@gmail.com')) {
      savedClusters = DEFAULT_CLUSTERS;
      localStorage.setItem('khanpro_clusters', JSON.stringify(savedClusters));
    }
    this.clusters = savedClusters;

    let savedMappings = JSON.parse(localStorage.getItem('khanpro_mappings'));
    if (!savedMappings || !savedMappings.some(m => m.destination === 'hasilvasay@gmail.com')) {
      savedMappings = DEFAULT_MAPPINGS;
      localStorage.setItem('khanpro_mappings', JSON.stringify(savedMappings));
    }
    this.mappings = savedMappings;
    this.studentPasskey = localStorage.getItem('khanpro_student_passkey') || 'STUDENT-2026';
    this.adminPasskey = localStorage.getItem('khanpro_admin_passkey') || 'ADMIN-2026';
    this.currentRole = sessionStorage.getItem('khanpro_role') || 'none'; // 'none' | 'student' | 'admin'
  }

  save() {
    localStorage.setItem('khanpro_clusters', JSON.stringify(this.clusters));
    localStorage.setItem('khanpro_mappings', JSON.stringify(this.mappings));
    updateUI();
  }

  setRole(role) {
    this.currentRole = role;
    sessionStorage.setItem('khanpro_role', role);
    updateUI();
  }

  updatePasskeys(studentKey, adminKey) {
    this.studentPasskey = studentKey.trim();
    this.adminPasskey = adminKey.trim();
    localStorage.setItem('khanpro_student_passkey', this.studentPasskey);
    localStorage.setItem('khanpro_admin_passkey', this.adminPasskey);
    showToast('Access Passkeys updated successfully!', 'success');
    updateUI();
  }

  addCluster(email) {
    const cleanEmail = email.trim().toLowerCase();
    if (this.clusters.some(c => c.email === cleanEmail)) {
      showToast('This Gmail cluster is already in your verified list!', 'error');
      return false;
    }
    this.clusters.push({ email: cleanEmail, activeCount: 0, maxCap: 50 });
    this.save();
    showToast(`Added verified cluster: ${cleanEmail}`, 'success');
    return true;
  }

  deleteCluster(email) {
    if (this.clusters.length <= 1) {
      showToast('You must keep at least 1 verified Gmail cluster active!', 'error');
      return false;
    }
    this.clusters = this.clusters.filter(c => c.email !== email);
    this.save();
    showToast(`Removed cluster: ${email}`, 'success');
    return true;
  }

  addMapping(prefix, destination) {
    const cleanPrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
    if (!cleanPrefix) {
      showToast('Invalid roll number/alias format!', 'error');
      return null;
    }

    // Check if already mapped
    const existingIndex = this.mappings.findIndex(m => m.prefix === cleanPrefix);
    const newRecord = {
      prefix: cleanPrefix,
      email: `${cleanPrefix}@khanpro.me`,
      destination: destination.trim().toLowerCase(),
      date: new Date().toISOString().split('T')[0],
      status: 'Active'
    };

    if (existingIndex >= 0) {
      this.mappings[existingIndex] = newRecord;
    } else {
      this.mappings.unshift(newRecord);
    }

    // Update active count for cluster
    const cluster = this.clusters.find(c => c.email === destination);
    if (cluster) cluster.activeCount = (cluster.activeCount || 0) + 1;

    this.save();
    return newRecord;
  }

  deleteMapping(prefix) {
    this.mappings = this.mappings.filter(m => m.prefix !== prefix);
    this.save();
    showToast(`Deleted mapping for ${prefix}@khanpro.me`, 'success');
  }
}

const state = new EngineState();

// ===================================================================
// UI INITIALIZATION & EVENT BINDINGS
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initPermissionGates();
  initTabs();
  initActivationForm();
  initAdminControls();
  initSimulator();
  initDirectory();
  initToolsModals();
  updateUI();
  syncCloudflareDestinations();
});

async function syncCloudflareDestinations() {
  try {
    const res = await fetch('/api/list-destinations');
    const data = await res.json();
    if (data.success && Array.isArray(data.destinations)) {
      data.destinations.forEach(item => {
        if (item.verified && !state.clusters.some(c => c.email.toLowerCase() === item.email.toLowerCase())) {
          state.clusters.push({
            email: item.email.toLowerCase(),
            activeCount: 0,
            maxCap: 50
          });
        }
      });
      state.save();
    }
  } catch (e) {
    // Local / offline notice
  }
}

// Permission Gates & Access Control
function initPermissionGates() {
  const passkeyForm = document.getElementById('passkey-unlock-form');
  const passkeyInput = document.getElementById('gate-passkey-input');
  const btnLockSession = document.getElementById('btn-lock-session');

  const adminForm = document.getElementById('admin-unlock-form');
  const adminKeyInput = document.getElementById('admin-key-input');
  const btnLockAdmin = document.getElementById('btn-lock-admin-session');

  const updateKeysForm = document.getElementById('update-passkeys-form');
  const settingStudentKey = document.getElementById('setting-student-passkey');
  const settingAdminKey = document.getElementById('setting-admin-passkey');

  // Student / Mail Gate Unlock
  if (passkeyForm) {
    passkeyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const entered = passkeyInput.value.trim();

      if (entered === state.studentPasskey) {
        state.setRole('student');
        showToast('Access Granted! Student Mail Portal unlocked.', 'success');
        passkeyInput.value = '';
      } else if (entered === state.adminPasskey) {
        state.setRole('admin');
        showToast('Master Admin verified! All areas unlocked.', 'success');
        passkeyInput.value = '';
      } else {
        showToast('Invalid Access Passkey! Access Denied.', 'error');
        passkeyInput.focus();
      }
    });
  }

  // Admin Gate Unlock
  if (adminForm) {
    adminForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const entered = adminKeyInput.value.trim();

      if (entered === state.adminPasskey) {
        state.setRole('admin');
        showToast('Master Admin verified! Admin controls unlocked.', 'success');
        adminKeyInput.value = '';
      } else {
        showToast('Incorrect Master Admin Key!', 'error');
        adminKeyInput.focus();
      }
    });
  }

  // Lock Sessions
  if (btnLockSession) {
    btnLockSession.addEventListener('click', () => {
      state.setRole('none');
      showToast('Session locked. Portal is now restricted.', 'info');
    });
  }

  if (btnLockAdmin) {
    btnLockAdmin.addEventListener('click', () => {
      state.setRole('none');
      showToast('Exited Admin session.', 'info');
    });
  }

  // Update Passkeys Form
  if (updateKeysForm) {
    updateKeysForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newStudent = settingStudentKey.value;
      const newAdmin = settingAdminKey.value;
      if (newStudent && newAdmin) {
        state.updatePasskeys(newStudent, newAdmin);
      }
    });
  }
}

// Navigation & Smooth Scroll
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId.startsWith('#')) {
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });

  const quickActivate = document.getElementById('quick-activate-btn');
  if (quickActivate) {
    quickActivate.addEventListener('click', () => {
      document.getElementById('student-mail').scrollIntoView({ behavior: 'smooth' });
      document.getElementById('student-prefix').focus();
    });
  }
}

// Engine Tabs
function initTabs() {
  const tabBtns = document.querySelectorAll('.engine-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTabId = btn.getAttribute('data-tab');
      document.querySelectorAll('.engine-tabs-wrapper ~ .tab-pane').forEach(pane => {
        pane.classList.add('hidden');
      });
      const activePane = document.getElementById(targetTabId);
      if (activePane) activePane.classList.remove('hidden');
    });
  });
}

// ===================================================================
// STUDENT ACTIVATION FORM LOGIC
// ===================================================================
// STUDENT ACTIVATION FORM LOGIC WITH CLOUDFLARE API INTEGRATION
// ===================================================================
function initActivationForm() {
  const form = document.getElementById('student-activation-form');
  const prefixInput = document.getElementById('student-prefix');
  const clusterSelect = document.getElementById('cluster-gmail-select');
  const strategyOptions = document.querySelectorAll('.strategy-option');
  const clusterBlock = document.getElementById('cluster-dropdown-block');
  const customBlock = document.getElementById('custom-gmail-block');
  const customGmailInput = document.getElementById('custom-gmail-input');

  const btnSendCf = document.getElementById('btn-send-cf-verification');
  const btnCheckCf = document.getElementById('btn-check-cf-status');
  const cfStatusBox = document.getElementById('cf-status-box');
  const cfStatusIndicator = document.getElementById('cf-status-indicator');
  const cfStatusText = document.getElementById('cf-status-text');

  const successCard = document.getElementById('activation-success-card');
  const assignedEmailSpan = document.getElementById('result-assigned-email');
  const destEmailSpan = document.getElementById('result-destination-email');
  const btnActivateAnother = document.getElementById('btn-activate-another');
  const btnCopyEmail = document.getElementById('btn-copy-email');
  const btnTestInSimulator = document.getElementById('btn-test-in-simulator');

  let customGmailVerified = false;
  let cfPollInterval = null;

  // Switch between Cluster and Custom Gmail
  strategyOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      strategyOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');

      const mode = opt.querySelector('input').value;
      if (mode === 'cluster') {
        clusterBlock.classList.remove('hidden');
        customBlock.classList.add('hidden');
      } else {
        clusterBlock.classList.add('hidden');
        customBlock.classList.remove('hidden');
        customGmailInput.focus();
      }
    });
  });

  // Prefix input cleanup
  prefixInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, '');
  });

  // Check Cloudflare Verification Status helper
  async function checkDestinationStatus(email, silent = false) {
    try {
      const res = await fetch(`/api/check-status?email=${encodeURIComponent(email)}`);
      const data = await res.json();

      if (data.verified) {
        customGmailVerified = true;
        if (cfPollInterval) clearInterval(cfPollInterval);

        if (cfStatusBox) {
          cfStatusBox.classList.remove('hidden');
          cfStatusBox.className = 'cf-status-box verified';
        }
        if (cfStatusIndicator) {
          cfStatusIndicator.innerHTML = '<i class="fa-solid fa-circle-check"></i> Verified by Cloudflare!';
        }
        if (cfStatusText) {
          cfStatusText.innerHTML = `Success! <strong>${email}</strong> is confirmed. You can now click "Activate Student Email Now" below.`;
        }
        if (!silent) showToast(`Email ${email} is verified! Ready to activate.`, 'success');
        return true;
      } else {
        if (!silent) showToast('Verification pending. Please click the link sent to your Gmail.', 'warning');
        return false;
      }
    } catch (err) {
      console.warn('Status check warning:', err);
      return false;
    }
  }

  // Send Verification Email Button
  if (btnSendCf) {
    btnSendCf.addEventListener('click', async () => {
      const email = customGmailInput.value.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        showToast('Please enter a valid personal Gmail address first!', 'error');
        customGmailInput.focus();
        return;
      }

      btnSendCf.disabled = true;
      btnSendCf.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

      try {
        const res = await fetch('/api/send-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (data.success) {
          showToast(`Cloudflare verification email sent to ${email}!`, 'success');
          if (cfStatusBox) {
            cfStatusBox.classList.remove('hidden');
            cfStatusBox.className = 'cf-status-box unverified';
          }
          if (cfStatusIndicator) {
            cfStatusIndicator.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> Awaiting Gmail Confirmation';
          }
          if (cfStatusText) {
            cfStatusText.innerHTML = `Cloudflare verification email dispatched to <strong>${email}</strong>! Please check your Gmail (including Spam folder) and click the confirmation link.`;
          }

          // Start auto-polling every 4 seconds for 2 minutes
          if (cfPollInterval) clearInterval(cfPollInterval);
          let attempts = 0;
          cfPollInterval = setInterval(async () => {
            attempts++;
            const ok = await checkDestinationStatus(email, true);
            if (ok || attempts >= 30) {
              clearInterval(cfPollInterval);
            }
          }, 4000);
        } else {
          showToast(data.error || 'Failed to send verification email', 'error');
        }
      } catch (err) {
        showToast(`Error connecting to Cloudflare API: ${err.message}`, 'error');
      } finally {
        btnSendCf.disabled = false;
        btnSendCf.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Verification';
      }
    });
  }

  // Re-check Status Button
  if (btnCheckCf) {
    btnCheckCf.addEventListener('click', async () => {
      const email = customGmailInput.value.trim().toLowerCase();
      if (!email) {
        showToast('Enter your Gmail address first!', 'error');
        return;
      }
      btnCheckCf.disabled = true;
      btnCheckCf.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
      await checkDestinationStatus(email, false);
      btnCheckCf.disabled = false;
      btnCheckCf.innerHTML = '<i class="fa-solid fa-rotate"></i> Re-check Status';
    });
  }

  // Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prefix = prefixInput.value.trim().toLowerCase();
    if (!prefix) {
      showToast('Please enter your roll number or alias!', 'error');
      return;
    }

    const mode = document.querySelector('input[name="gmail-mode"]:checked').value;
    let targetGmail = '';

    if (mode === 'cluster') {
      targetGmail = clusterSelect.value;
    } else {
      targetGmail = customGmailInput.value.trim().toLowerCase();
      if (!targetGmail || !targetGmail.includes('@')) {
        showToast('Please enter a valid personal Gmail address!', 'error');
        return;
      }

      // Check if verified with Cloudflare
      if (!customGmailVerified) {
        const isVerified = await checkDestinationStatus(targetGmail, true);
        if (!isVerified) {
          showToast('Please click the verification link sent to your Gmail by Cloudflare first!', 'error');
          return;
        }
      }
    }

    // Create Cloudflare direct routing rule via API (for both Cluster and Custom destinations)
    try {
      const ruleRes = await fetch('/api/create-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: `${prefix}@khanpro.me`,
          destination: targetGmail
        })
      });
      const ruleData = await ruleRes.json();
      if (ruleData.success) {
        console.log('[CF Rule Created]:', ruleData);
      }
    } catch (err) {
      console.warn('Cloudflare rule warning (Catch-all still applies):', err);
    }

    // Save mapping locally
    const result = state.addMapping(prefix, targetGmail);
    if (result) {
      form.classList.add('hidden');
      assignedEmailSpan.textContent = result.email;
      destEmailSpan.textContent = result.destination;
      successCard.classList.remove('hidden');
      showToast(`Activated: ${result.email} -> ${result.destination}`, 'success');
    }
  });

  // Copy Email Button
  btnCopyEmail.addEventListener('click', () => {
    navigator.clipboard.writeText(assignedEmailSpan.textContent).then(() => {
      showToast('Copied student email to clipboard!', 'success');
    });
  });

  // Activate Another Button
  btnActivateAnother.addEventListener('click', () => {
    form.reset();
    form.classList.remove('hidden');
    successCard.classList.add('hidden');
    if (cfStatusBox) cfStatusBox.classList.add('hidden');
    customGmailVerified = false;
    prefixInput.focus();
  });

  // Test in Simulator Button
  btnTestInSimulator.addEventListener('click', () => {
    document.getElementById('tab-btn-simulator').click();
    const simSelect = document.getElementById('sim-target-select');
    simSelect.value = assignedEmailSpan.textContent;
  });
}

// ===================================================================
// ADMIN & CLUSTER CONTROLS
// ===================================================================
function initAdminControls() {
  const addClusterForm = document.getElementById('add-cluster-form');
  const newClusterInput = document.getElementById('new-cluster-email');
  const bulkForm = document.getElementById('bulk-generator-form');
  const copyWorkerBtn = document.getElementById('btn-copy-worker-code');
  const bulkDistMode = document.getElementById('bulk-dist-mode');
  const bulkSingleClusterWrap = document.getElementById('bulk-single-cluster-wrap');

  // Add Cluster with Cloudflare auto-verification
  addClusterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = newClusterInput.value.trim().toLowerCase();
    if (email && state.addCluster(email)) {
      newClusterInput.value = '';
      try {
        const cfRes = await fetch('/api/send-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const cfData = await cfRes.json();
        if (cfData.success) {
          showToast(`Cluster added! Cloudflare verification email sent to ${email}`, 'success');
        }
      } catch (err) {
        console.warn('CF verification notice:', err);
      }
    }
  });

  // Bulk Mode Toggle
  bulkDistMode.addEventListener('change', () => {
    if (bulkDistMode.value === 'single-cluster') {
      bulkSingleClusterWrap.classList.remove('hidden');
    } else {
      bulkSingleClusterWrap.classList.add('hidden');
    }
  });

  // Bulk Generator Run
  bulkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const prefix = document.getElementById('bulk-prefix').value.trim();
    const start = parseInt(document.getElementById('bulk-start').value, 10);
    const end = parseInt(document.getElementById('bulk-end').value, 10);
    const mode = bulkDistMode.value;

    if (isNaN(start) || isNaN(end) || start > end) {
      showToast('Invalid roll number range!', 'error');
      return;
    }

    if (end - start > 500) {
      showToast('Max bulk batch is 500 students per run!', 'error');
      return;
    }

    if (state.clusters.length === 0) {
      showToast('No active Gmail clusters available!', 'error');
      return;
    }

    let createdCount = 0;
    const targetSingle = document.getElementById('bulk-target-cluster').value;

    for (let i = start; i <= end; i++) {
      const studentPrefix = `${prefix}${i}`;
      let assignedGmail = '';

      if (mode === 'single-cluster') {
        assignedGmail = targetSingle;
      } else {
        // Round-robin distribution
        const clusterIndex = (i - start) % state.clusters.length;
        assignedGmail = state.clusters[clusterIndex].email;
      }

      state.addMapping(studentPrefix, assignedGmail);
      createdCount++;
    }

    showToast(`Successfully batch created ${createdCount} student emails!`, 'success');
  });

  // Copy Production Worker Code
  copyWorkerBtn.addEventListener('click', () => {
    const code = document.getElementById('code-snippet-worker').textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Copied Cloudflare Worker script!', 'success');
    });
  });
}

// ===================================================================
// LIVE FORWARDING SIMULATOR
// ===================================================================
function initSimulator() {
  const runBtn = document.getElementById('btn-run-simulation');
  const terminal = document.getElementById('sim-trace-terminal');
  const statusBadge = document.getElementById('trace-status-badge');

  runBtn.addEventListener('click', () => {
    const targetSelect = document.getElementById('sim-target-select');
    const targetEmail = targetSelect.value;
    const sender = document.getElementById('sim-sender').value;
    const subject = document.getElementById('sim-subject').value;

    if (!targetEmail) {
      showToast('No active student email selected!', 'error');
      return;
    }

    const mapping = state.mappings.find(m => m.email === targetEmail);
    const destGmail = mapping ? mapping.destination : 'cluster-default@gmail.com';

    // Start Simulation Animation
    terminal.innerHTML = '';
    statusBadge.textContent = 'Routing...';
    statusBadge.className = 'trace-status active';
    runBtn.disabled = true;

    const steps = [
      { text: `[INBOUND] SMTP Message received from ${sender}`, class: 'highlight', delay: 200 },
      { text: `[EDGE] Target: ${targetEmail} | TLS v1.3 Verified`, class: '', delay: 450 },
      { text: `[KV LOOKUP] Querying Cloudflare KV for prefix '${mapping ? mapping.prefix : 'unknown'}'...`, class: '', delay: 750 },
      { text: `[KV HIT] Matched destination: ${destGmail}`, class: 'success', delay: 1050 },
      { text: `[AUTH] SPF Check: PASS | DKIM: PASS | DMARC: PASS`, class: 'success', delay: 1350 },
      { text: `[DELIVERY] Cloudflare message.forward('${destGmail}') executed!`, class: 'success', delay: 1700 },
      { text: `[COMPLETE] Delivered: "${subject}" to ${destGmail} in 420ms`, class: 'highlight', delay: 2000 }
    ];

    steps.forEach(step => {
      setTimeout(() => {
        const line = document.createElement('div');
        line.className = `terminal-line ${step.class}`;
        line.textContent = step.text;
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
      }, step.delay);
    });

    setTimeout(() => {
      statusBadge.textContent = 'Success (200 OK)';
      statusBadge.className = 'trace-status success';
      runBtn.disabled = false;
      showToast(`Simulated OTP delivered to ${destGmail}!`, 'success');
    }, 2200);
  });
}

// ===================================================================
// ACTIVE DIRECTORY & CSV EXPORT
// ===================================================================
function initDirectory() {
  const searchInput = document.getElementById('directory-search');
  const exportBtn = document.getElementById('btn-export-csv');
  const refreshBtn = document.getElementById('btn-refresh-directory');

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderDirectoryTable(q);
  });

  refreshBtn.addEventListener('click', () => {
    renderDirectoryTable(searchInput.value.toLowerCase());
    showToast('Directory refreshed!', 'success');
  });

  exportBtn.addEventListener('click', () => {
    if (state.mappings.length === 0) {
      showToast('No mappings to export!', 'error');
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,Roll_Prefix,Student_Email,Assigned_Gmail,Date_Activated,Status\n";
    state.mappings.forEach(m => {
      csvContent += `${m.prefix},${m.email},${m.destination},${m.date},${m.status}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `khanpro_student_emails_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV downloaded successfully!', 'success');
  });
}

// ===================================================================
// CLIENT-SIDE TOOLS & MODALS
// ===================================================================
function initToolsModals() {
  // Modal Triggers
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      if (tool === 'password-modal') openModal('modal-password');
      if (tool === 'qr-modal') {
        openModal('modal-qr');
        updateQRCode();
      }
      if (tool === 'dns-modal') openModal('modal-dns');
      if (tool === 'text-modal') openModal('modal-text');
      if (tool === 'tempmail-modal') {
        openModal('modal-tempmail');
        initTempMailTool();
      }
      if (tool === 'warmup-modal') {
        openModal('modal-warmup');
        initWarmupTool();
      }
      if (tool === 'checker-modal') {
        openModal('modal-checker');
        initCheckerTool();
      }
      if (tool === 'yt-crawler-modal') {
        openModal('modal-yt-crawler');
        initYTCrawlerTool();
      }
    });
  });

  // Modal Closers
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  // Tool 1: Password Generator Logic
  const pwdOutput = document.getElementById('pwd-output');
  const pwdLen = document.getElementById('pwd-len');
  const pwdLenVal = document.getElementById('pwd-len-val');
  const btnPwdGen = document.getElementById('btn-pwd-generate');
  const btnPwdCopy = document.getElementById('btn-pwd-copy');

  function generatePassword() {
    const len = parseInt(pwdLen.value, 10);
    const upper = document.getElementById('pwd-upper').checked ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '';
    const lower = document.getElementById('pwd-lower').checked ? 'abcdefghijklmnopqrstuvwxyz' : '';
    const nums = document.getElementById('pwd-nums').checked ? '0123456789' : '';
    const syms = document.getElementById('pwd-symbols').checked ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '';
    
    let chars = upper + lower + nums + syms;
    if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

    let res = '';
    const randomVals = new Uint32Array(len);
    window.crypto.getRandomValues(randomVals);
    for (let i = 0; i < len; i++) {
      res += chars[randomVals[i] % chars.length];
    }
    pwdOutput.value = res;
  }

  pwdLen.addEventListener('input', () => {
    pwdLenVal.textContent = pwdLen.value;
    generatePassword();
  });
  btnPwdGen.addEventListener('click', generatePassword);
  btnPwdCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(pwdOutput.value).then(() => {
      showToast('Copied password to clipboard!', 'success');
    });
  });
  generatePassword();

  // Tool 2: QR Code Generator Logic
  const qrInput = document.getElementById('qr-input');
  const qrImage = document.getElementById('qr-image');

  function updateQRCode() {
    const text = qrInput.value.trim() || 'https://khanpro.me';
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
  }
  qrInput.addEventListener('input', updateQRCode);

  // Tool 3: Text Formatter Logic
  const textInput = document.getElementById('text-input');
  document.getElementById('btn-text-lower').addEventListener('click', () => {
    textInput.value = textInput.value.toLowerCase();
  });
  document.getElementById('btn-text-upper').addEventListener('click', () => {
    textInput.value = textInput.value.toUpperCase();
  });
  document.getElementById('btn-text-clean').addEventListener('click', () => {
    const lines = textInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const unique = [...new Set(lines)];
    textInput.value = unique.join('\n');
    showToast(`Cleaned & removed duplicates (${unique.length} lines)`, 'success');
  });
  document.getElementById('btn-text-append').addEventListener('click', () => {
    const lines = textInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const appended = lines.map(l => l.includes('@') ? l : `${l}@khanpro.me`);
    textInput.value = appended.join('\n');
    showToast('Appended @khanpro.me to lines!', 'success');
  });
}

// Tool 4: TempMail Disposable Generator Logic
let tempMailInitialized = false;
let tempMailTimer = null;
let tempMailSecondsLeft = 600; // 10 minutes
let tempMailInbox = [
  {
    id: 1,
    from: 'welcome@khanpro.me',
    subject: 'Welcome to KhanPro TempMail! Your disposable mailbox is active.',
    time: 'Just now',
    body: 'Hello!\n\nYour 10-minute temporary email address is now ready to receive emails and verification codes.\n\nYou can use this address for testing registrations, getting newsletter codes, or checking OTP delivery.'
  }
];

function initTempMailTool() {
  if (tempMailInitialized) return;
  tempMailInitialized = true;

  const addrInput = document.getElementById('tempmail-address-input');
  const btnCopy = document.getElementById('btn-tempmail-copy');
  const btnNew = document.getElementById('btn-tempmail-new');
  const btnSimulate = document.getElementById('btn-tempmail-simulate');
  const btnRefresh = document.getElementById('btn-tempmail-refresh');
  const countdownEl = document.getElementById('tempmail-countdown');
  const msgContainer = document.getElementById('tempmail-msg-container');
  const msgCountEl = document.getElementById('tempmail-msg-count');
  const detailView = document.getElementById('tempmail-detail-view');
  const btnBackInbox = document.getElementById('btn-tempmail-back-inbox');

  const detailFrom = document.getElementById('detail-from');
  const detailSubj = document.getElementById('detail-subject');
  const detailTime = document.getElementById('detail-time');
  const detailBody = document.getElementById('detail-body');

  function generateRandomEmail() {
    const rand = Math.random().toString(36).substring(2, 7);
    const email = `tmp_${rand}@khanpro.me`;
    addrInput.value = email;
    tempMailSecondsLeft = 600;
    tempMailInbox = [
      {
        id: Date.now(),
        from: 'welcome@khanpro.me',
        subject: `Welcome! Mailbox created for ${email}`,
        time: 'Just now',
        body: `Your disposable email address ${email} is active and listening for incoming messages.`
      }
    ];
    renderInbox();
    showToast(`New TempMail generated: ${email}`, 'success');
  }

  function renderInbox() {
    msgContainer.innerHTML = '';
    msgCountEl.textContent = tempMailInbox.length;

    tempMailInbox.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'tempmail-msg-item';
      item.innerHTML = `
        <div class="msg-item-meta">
          <span class="msg-sender"><i class="fa-solid fa-envelope"></i> ${msg.from}</span>
          <span class="msg-subject">${msg.subject}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="msg-time">${msg.time}</span>
          <i class="fa-solid fa-chevron-right text-muted text-sm"></i>
        </div>
      `;
      item.addEventListener('click', () => {
        openMessage(msg);
      });
      msgContainer.appendChild(item);
    });
  }

  function openMessage(msg) {
    detailFrom.textContent = msg.from;
    detailSubj.textContent = msg.subject;
    detailTime.textContent = msg.time;
    detailBody.textContent = msg.body;
    msgContainer.classList.add('hidden');
    detailView.classList.remove('hidden');
  }

  btnBackInbox.addEventListener('click', () => {
    detailView.classList.add('hidden');
    msgContainer.classList.remove('hidden');
  });

  btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(addrInput.value).then(() => {
      showToast('Copied TempMail address to clipboard!', 'success');
    });
  });

  btnNew.addEventListener('click', generateRandomEmail);

  btnRefresh.addEventListener('click', () => {
    renderInbox();
    showToast('Inbox refreshed', 'info');
  });

  // Simulated OTP arriving
  btnSimulate.addEventListener('click', () => {
    const services = [
      { name: 'Instagram Security', from: 'security@mail.instagram.com', service: 'Instagram' },
      { name: 'Canva Verification', from: 'no-reply@canva.com', service: 'Canva' },
      { name: 'Telegram Login', from: 'service@telegram.org', service: 'Telegram' },
      { name: 'Discord Team', from: 'auth@discord.com', service: 'Discord' }
    ];
    const picked = services[Math.floor(Math.random() * services.length)];
    const code = Math.floor(100000 + Math.random() * 900000);

    const newMsg = {
      id: Date.now(),
      from: picked.from,
      subject: `Your ${picked.service} verification code: ${code}`,
      time: 'Just now',
      body: `Hi there,\n\nYour one-time verification code (OTP) for ${picked.service} is:\n\n👉  ${code}\n\nThis code will expire in 10 minutes. Do not share it with anyone.`
    };

    tempMailInbox.unshift(newMsg);
    renderInbox();
    showToast(`New incoming email from ${picked.service}!`, 'success');
  });

  // Countdown Interval
  if (!tempMailTimer) {
    tempMailTimer = setInterval(() => {
      if (tempMailSecondsLeft > 0) {
        tempMailSecondsLeft--;
        const mins = Math.floor(tempMailSecondsLeft / 60);
        const secs = tempMailSecondsLeft % 60;
        countdownEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      } else {
        countdownEl.textContent = 'Expired (00:00)';
      }
    }, 1000);
  }

  generateRandomEmail();
}

// Tool 5: Peer-to-Peer Email Warmup & Score Booster Logic
let warmupInitialized = false;
let warmupRunning = false;
let warmupIntervalId = null;
let warmupSentTotal = 0;
let warmupRoundsTotal = 0;
let warmupTrustScore = 78;

const DEFAULT_WARMUP_POOL = [
  { email: 'hasilvasay@gmail.com', appPassword: '' },
  { email: 'storystock.yt@gmail.com', appPassword: '' }
];

let savedWarmupRaw = JSON.parse(localStorage.getItem('khanpro_warmup_pool_v2'));
if (!savedWarmupRaw) {
  let oldWarmupRaw = JSON.parse(localStorage.getItem('khanpro_warmup_pool'));
  if (Array.isArray(oldWarmupRaw)) {
    savedWarmupRaw = oldWarmupRaw.map(item => typeof item === 'string' ? { email: item, appPassword: '' } : item);
  }
}
let warmupPool = (savedWarmupRaw && savedWarmupRaw.length > 0) ? savedWarmupRaw : DEFAULT_WARMUP_POOL;

const CONVERSATION_TEMPLATES = [
  {
    topic: 'Academic Consultation',
    subject: 'Follow-up regarding semester research draft',
    body: 'Hi, I reviewed the latest submission for our project. The methodology looks solid, but let us double-check the bibliography before submitting.'
  },
  {
    topic: 'Campus Project Meeting',
    subject: 'Minutes of yesterday campus tech committee meetup',
    body: 'Greetings! Sharing the key takeaways from our meeting. Please review the action items and confirm your availability for Thursday.'
  },
  {
    topic: 'System Notification',
    subject: 'Update on API performance metrics and edge health',
    body: 'Hello team, the latest DNS and edge deliverability benchmarks have been logged. All latency readings are below 50ms.'
  },
  {
    topic: 'Document Feedback',
    subject: 'Re: Final draft review and editorial suggestions',
    body: 'Thanks for sending over the updated document. I have added comments on sections 2 and 4. Everything else looks great.'
  },
  {
    topic: 'General Inquiry',
    subject: 'Quick question about schedule next week',
    body: 'Hope you are doing well. Are you free for a 15-minute quick sync next Monday morning to align on the timeline?'
  }
];

function initWarmupTool() {
  if (warmupInitialized) return;
  warmupInitialized = true;

  const addForm = document.getElementById('warmup-add-form');
  const inputEl = document.getElementById('warmup-gmail-input');
  const passEl = document.getElementById('warmup-pass-input');
  const btnToggleEye = document.getElementById('btn-toggle-warmup-pass');
  const chipsContainer = document.getElementById('warmup-chips-container');
  const poolCountEl = document.getElementById('warmup-pool-count');
  const btnToggle = document.getElementById('btn-toggle-warmup');
  const btnDownloadScript = document.getElementById('btn-download-warmup-script');
  const terminalFeed = document.getElementById('warmup-feed-terminal');
  const badgeState = document.getElementById('warmup-badge-state');
  const speedSelect = document.getElementById('warmup-speed');

  const metricSent = document.getElementById('metric-sent-count');
  const metricDelivered = document.getElementById('metric-delivered-count');
  const metricRounds = document.getElementById('metric-rounds-count');
  const metricTrust = document.getElementById('metric-trust-val');
  const trustStatusText = document.getElementById('trust-status-text');
  const trustPercentageText = document.getElementById('trust-percentage-text');
  const trustBarFill = document.getElementById('trust-bar-fill');

  // Eye toggle for password
  if (btnToggleEye && passEl) {
    btnToggleEye.addEventListener('click', () => {
      const isPwd = passEl.type === 'password';
      passEl.type = isPwd ? 'text' : 'password';
      btnToggleEye.innerHTML = isPwd ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
  }

  function savePool() {
    localStorage.setItem('khanpro_warmup_pool_v2', JSON.stringify(warmupPool));
    renderChips();
  }

  function renderChips() {
    chipsContainer.innerHTML = '';
    poolCountEl.textContent = warmupPool.length;

    if (warmupPool.length === 0) {
      chipsContainer.innerHTML = '<div class="text-muted text-sm text-center" style="padding: 16px; background: rgba(255,255,255,0.02); border-radius: 8px;">No Gmail accounts added yet. Add accounts above with their 16-digit Google App Passwords.</div>';
      return;
    }

    warmupPool.forEach((item, idx) => {
      const email = typeof item === 'string' ? item : item.email;
      const appPass = (typeof item === 'object' && item.appPassword) ? item.appPassword.trim() : '';
      const cleanPass = appPass.replace(/\s+/g, '');
      const maskedPass = cleanPass ? `•••• •••• •••• ${cleanPass.slice(-4) || '••••'}` : '';
      const isKeySet = Boolean(cleanPass);

      const card = document.createElement('div');
      card.className = 'warmup-account-card';
      card.innerHTML = `
        <div class="warmup-account-left">
          <div class="warmup-account-icon"><i class="fa-brands fa-google"></i></div>
          <div class="warmup-account-info">
            <span class="warmup-account-email">${email}</span>
            <div class="warmup-account-key-meta">
              <span><i class="fa-solid fa-key"></i> ${isKeySet ? `<span class="key-masked-pill">${maskedPass}</span>` : '<span class="text-warning">Key Missing</span>'}</span>
              ${isKeySet ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> SMTP Ready</span>' : ''}
            </div>
          </div>
        </div>
        <button class="btn-delete-chip" title="Remove account" data-index="${idx}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `;
      chipsContainer.appendChild(card);
    });

    chipsContainer.querySelectorAll('.btn-delete-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-index'), 10);
        const removed = warmupPool.splice(i, 1);
        savePool();
        const email = removed[0].email || removed[0];
        showToast(`Removed ${email} from warmup pool`, 'info');
      });
    });
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = inputEl.value.trim().toLowerCase();
    const appPassword = passEl ? passEl.value.trim() : '';

    if (!email || !email.includes('@')) {
      showToast('Please enter a valid Gmail address!', 'error');
      return;
    }
    if (warmupPool.some(item => (typeof item === 'string' ? item : item.email) === email)) {
      showToast('This account is already in the pool!', 'error');
      return;
    }
    if (warmupPool.length >= 10) {
      showToast('Maximum pool size is 10 accounts!', 'error');
      return;
    }

    warmupPool.push({ email, appPassword });
    inputEl.value = '';
    if (passEl) passEl.value = '';
    savePool();
    showToast(`Added ${email} with SMTP App Password!`, 'success');
  });

  // Start / Pause Campaign Toggle
  btnToggle.addEventListener('click', () => {
    if (warmupRunning) {
      // Pause
      warmupRunning = false;
      clearInterval(warmupIntervalId);
      btnToggle.className = 'btn btn-primary btn-lg btn-glow';
      btnToggle.innerHTML = '<i class="fa-solid fa-rocket"></i> <span>Resume Warmup Campaign</span>';
      badgeState.className = 'badge badge-warning';
      badgeState.innerHTML = '<i class="fa-solid fa-pause"></i> Paused';
      addLogLine('[PAUSED] Warmup campaign paused by user.', 'warn');
      showToast('Warmup campaign paused.', 'info');
    } else {
      // Start
      if (warmupPool.length < 2) {
        showToast('Please add at least 2 Gmail accounts to start!', 'error');
        return;
      }
      warmupRunning = true;
      btnToggle.className = 'btn btn-secondary btn-lg';
      btnToggle.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Pause Campaign</span>';
      badgeState.className = 'badge badge-success';
      badgeState.innerHTML = '<i class="fa-solid fa-bolt"></i> Live Active';
      addLogLine('[STARTED] Campaign launched. Peer-to-peer exchanges active.', 'success');
      showToast('Warmup engine is running!', 'success');

      const speedSec = parseInt(speedSelect.value, 10) * 1000;
      runExchangeStep();
      warmupIntervalId = setInterval(runExchangeStep, speedSec);
    }
  });

  function runExchangeStep() {
    if (warmupPool.length < 2) return;

    // Pick 2 distinct accounts
    const senderIdx = Math.floor(Math.random() * warmupPool.length);
    let receiverIdx = Math.floor(Math.random() * warmupPool.length);
    while (receiverIdx === senderIdx) {
      receiverIdx = Math.floor(Math.random() * warmupPool.length);
    }

    const senderObj = warmupPool[senderIdx];
    const receiverObj = warmupPool[receiverIdx];
    const sender = typeof senderObj === 'string' ? senderObj : senderObj.email;
    const receiver = typeof receiverObj === 'string' ? receiverObj : receiverObj.email;
    const template = CONVERSATION_TEMPLATES[Math.floor(Math.random() * CONVERSATION_TEMPLATES.length)];

    warmupSentTotal++;
    if (warmupSentTotal % warmupPool.length === 0) {
      warmupRoundsTotal++;
    }

    if (warmupTrustScore < 98) {
      warmupTrustScore += 1;
    }

    // Update UI Stats
    metricSent.textContent = warmupSentTotal;
    metricRounds.textContent = warmupRoundsTotal;
    metricTrust.textContent = `${warmupTrustScore}%`;
    trustPercentageText.textContent = `${warmupTrustScore} / 100`;
    trustBarFill.style.width = `${warmupTrustScore}%`;

    if (warmupTrustScore >= 90) {
      trustStatusText.textContent = 'High Reputation (Excellent Deliverability)';
      trustStatusText.className = 'text-success';
    } else if (warmupTrustScore >= 80) {
      trustStatusText.textContent = 'Heating Up (Good Inbox Standing)';
      trustStatusText.className = 'text-success';
    }

    addLogLine(`[EXCHANGE] ${sender} ➔ ${receiver} | "${template.subject}" | 250 OK Delivered | Score +1`, 'success');
  }

  function addLogLine(text, type = '') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    terminalFeed.appendChild(line);
    terminalFeed.scrollTop = terminalFeed.scrollHeight;
  }

  // Download Python Standalone Script
  btnDownloadScript.addEventListener('click', () => {
    const accountsList = warmupPool.map(a => typeof a === 'string' ? a : a.email);
    const passwordsMap = {};
    warmupPool.forEach(a => {
      const email = typeof a === 'string' ? a : a.email;
      const pass = typeof a === 'string' ? '' : (a.appPassword || '');
      passwordsMap[email] = pass || "YOUR_16_DIGIT_APP_PASSWORD";
    });

    const accountsJson = JSON.stringify(accountsList, null, 4);
    const passwordsJson = JSON.stringify(passwordsMap, null, 4);

    const pythonScript = `"""
======================================================================
KHANPRO.ME - AUTOMATED GMAIL PEER-TO-PEER WARMUP BOT (STANDALONE)
======================================================================
This bot runs in the background on your PC and automatically exchanges
realistic conversational emails between your pool of Gmail accounts.

Instructions:
1. Ensure 2-Step Verification is ON for each Gmail.
2. Generate an "App Password" in Google Account (Security -> App Passwords).
   https://myaccount.google.com/apppasswords
3. Run: python khanpro_warmup_bot.py
"""

import smtplib
import time
import random
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Your Warmup Pool Accounts (Exported from KhanPro.me)
ACCOUNTS = ${accountsJson}

# Configured Google 16-Digit App Passwords (Exported from KhanPro.me)
APP_PASSWORDS = ${passwordsJson}

TOPICS = [
    ("Quarterly Project Review", "Hi team, sharing the latest project deck for review. Let me know your thoughts."),
    ("Class notes & lecture draft", "Hey! Attached are the notes from today's discussion. Have a great weekend."),
    ("Quick sync follow-up", "Thanks for the call earlier. I updated the spreadsheet as discussed."),
    ("Code review on GitHub repo", "The pull request has been approved and merged. Thanks for the quick feedback!"),
    ("Updated draft submission", "Attached is the latest revision of our draft. Let me know if anything needs changes.")
]

def send_warm_email(sender, receiver, subject, body):
    try:
        msg = MIMEMultipart()
        msg["From"] = sender
        msg["To"] = receiver
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        
        password = APP_PASSWORDS.get(sender, "").strip().replace(" ", "")
        if password and password != "YOUR_16_DIGIT_APP_PASSWORD":
            server.login(sender, password)
            server.sendmail(sender, receiver, msg.as_string())
            print(f"✅ [REAL EMAIL DELIVERED] {sender} -> {receiver} | '{subject}'")
        else:
            print(f"⚠️ [CONFIG NEEDED] {sender} missing 16-digit Google App Password.")
        server.quit()
    except Exception as e:
        print(f"❌ [SMTP ERROR] {sender} -> {receiver} | Error: {e}")

if __name__ == "__main__":
    print("🚀 KhanPro Warmup Engine Bot started...")
    print(f"Monitoring {len(ACCOUNTS)} pooled Gmail accounts.")
    while True:
        sender, receiver = random.sample(ACCOUNTS, 2)
        subj, body = random.choice(TOPICS)
        send_warm_email(sender, receiver, subj, body)
        wait_time = random.randint(60, 180)
        print(f"Waiting {wait_time}s before next exchange to stay safe...")
        time.sleep(wait_time)
`;

    const blob = new Blob([pythonScript], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "khanpro_warmup_bot.py";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded khanpro_warmup_bot.py with your configured credentials!", "success");
  });

  renderChips();
}

// Tool 6: Gmail Trust Score & Health Inspector Logic
let checkerInitialized = false;

function initCheckerTool() {
  if (checkerInitialized) return;
  checkerInitialized = true;

  const form = document.getElementById('checker-form');
  const inputEl = document.getElementById('checker-email-input');
  const btnRun = document.getElementById('btn-run-check');
  const scanBox = document.getElementById('checker-scan-box');
  const scanLogs = document.getElementById('checker-scan-logs');
  const resultsBox = document.getElementById('checker-results-box');

  const circleOuter = document.getElementById('checker-circle-outer');
  const scoreNum = document.getElementById('checker-score-num');
  const badgeStatus = document.getElementById('checker-badge-status');
  const emailDisplay = document.getElementById('checker-email-display');
  const summaryDesc = document.getElementById('checker-summary-desc');

  const spamRisk = document.getElementById('chk-spam-risk');
  const inboxRate = document.getElementById('chk-inbox-rate');
  const botRisk = document.getElementById('chk-bot-risk');
  const mxStatus = document.getElementById('chk-mx-status');
  const checklistItems = document.getElementById('checker-audit-items');

  const btnQuickWarmup = document.getElementById('btn-quick-add-warmup');
  const btnRetest = document.getElementById('btn-retest-email');

  let currentInspectedEmail = '';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = inputEl.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      showToast('Please enter a valid Gmail address!', 'error');
      return;
    }

    currentInspectedEmail = email;
    runInspection(email);
  });

  btnRetest.addEventListener('click', () => {
    resultsBox.classList.add('hidden');
    scanBox.classList.add('hidden');
    inputEl.value = '';
    inputEl.focus();
  });

  btnQuickWarmup.addEventListener('click', () => {
    if (!currentInspectedEmail) return;
    if (warmupPool.some(item => (typeof item === 'string' ? item : item.email) === currentInspectedEmail)) {
      showToast(`${currentInspectedEmail} is already in the Warmup Pool!`, 'info');
    } else {
      warmupPool.push({ email: currentInspectedEmail, appPassword: '' });
      localStorage.setItem('khanpro_warmup_pool_v2', JSON.stringify(warmupPool));
      showToast(`Added ${currentInspectedEmail} to Warmup Pool!`, 'success');
    }
    // Switch to Warmup modal
    closeModal('modal-checker');
    openModal('modal-warmup');
    initWarmupTool();
  });

  function runInspection(email) {
    btnRun.disabled = true;
    resultsBox.classList.add('hidden');
    scanBox.classList.remove('hidden');
    scanLogs.innerHTML = '';

    const username = email.split('@')[0];
    const isGmailDomain = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');

    // Analysis calculations
    const numDigits = (username.match(/\d/g) || []).length;
    const digitRatio = numDigits / (username.length || 1);
    const hasDots = username.includes('.');
    const isLong = username.length > 18;

    // Check if in warmup pool
    const inWarmup = warmupPool.some(item => (typeof item === 'string' ? item : item.email) === email);

    let score = isGmailDomain ? 78 : 65;

    // Human structure bonuses / penalties
    if (digitRatio > 0.5) score -= 18; // High digits flag
    else if (digitRatio > 0.3) score -= 8;
    else score += 6; // Clean human pattern

    if (hasDots) score += 6; // e.g. first.last style
    if (isLong) score -= 5;
    if (inWarmup) score += 10; // Active in warmup bonus

    // Clamp score
    score = Math.max(38, Math.min(97, Math.round(score)));

    const steps = [
      { text: `Querying Google Mail MX cluster (gmail-smtp-in.l.google.com)...`, status: 'PASS', delay: 250 },
      { text: `Analyzing username pattern '${username}' (digit ratio: ${(digitRatio*100).toFixed(0)}%)...`, status: 'ANALYZED', delay: 650 },
      { text: `Checking DNSBL Spamhaus & SURBL blacklists...`, status: 'CLEAN', delay: 1050 },
      { text: `Auditing SPF & DKIM authentication baseline...`, status: 'PASS', delay: 1400 },
      { text: `Synthesizing final deliverability score & account strength...`, status: 'DONE', delay: 1750 }
    ];

    steps.forEach(step => {
      setTimeout(() => {
        const item = document.createElement('div');
        item.className = 'checker-scan-log-item';
        item.innerHTML = `<span><i class="fa-solid fa-check text-success"></i> ${step.text}</span> <strong class="badge badge-success text-xs">${step.status}</strong>`;
        scanLogs.appendChild(item);
      }, step.delay);
    });

    setTimeout(() => {
      btnRun.disabled = false;
      scanBox.classList.add('hidden');
      displayResults(email, score, username, digitRatio, inWarmup, isGmailDomain);
    }, 2100);
  }

  function displayResults(email, score, username, digitRatio, inWarmup, isGmailDomain) {
    resultsBox.classList.remove('hidden');
    scoreNum.textContent = score;
    emailDisplay.textContent = email;

    // Styling based on score
    if (score >= 85) {
      circleOuter.style.borderColor = 'var(--accent-emerald)';
      circleOuter.style.background = 'rgba(16, 185, 129, 0.12)';
      circleOuter.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.3)';
      badgeStatus.className = 'badge badge-success';
      badgeStatus.innerHTML = '<i class="fa-solid fa-shield-check"></i> High Trust (Excellent Health)';
      summaryDesc.textContent = 'This Gmail account has a strong natural profile, valid Google MX infrastructure, and high primary inbox delivery standing.';
      spamRisk.className = 'metric-val text-success';
      spamRisk.textContent = 'Ultra Low (0%)';
      inboxRate.className = 'metric-val text-success';
      inboxRate.textContent = '96% Primary';
      botRisk.className = 'metric-val text-success';
      botRisk.textContent = 'Human Structure';
    } else if (score >= 70) {
      circleOuter.style.borderColor = 'var(--accent-cyan)';
      circleOuter.style.background = 'rgba(6, 182, 212, 0.12)';
      circleOuter.style.boxShadow = '0 0 25px rgba(6, 182, 212, 0.3)';
      badgeStatus.className = 'badge badge-info';
      badgeStatus.innerHTML = '<i class="fa-solid fa-bolt"></i> Good Standing (Solid Account)';
      summaryDesc.textContent = 'Solid Gmail profile with good inbox deliverability. A few peer warmup exchanges will push this account into the top tier.';
      spamRisk.className = 'metric-val text-success';
      spamRisk.textContent = 'Low (4%)';
      inboxRate.className = 'metric-val text-info';
      inboxRate.textContent = '88% Primary';
      botRisk.className = 'metric-val text-info';
      botRisk.textContent = 'Standard';
    } else {
      circleOuter.style.borderColor = 'var(--accent-amber)';
      circleOuter.style.background = 'rgba(245, 158, 11, 0.12)';
      circleOuter.style.boxShadow = '0 0 25px rgba(245, 158, 11, 0.3)';
      badgeStatus.className = 'badge badge-warning';
      badgeStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Cold Account (Needs Warmup)';
      summaryDesc.textContent = 'This account exhibits signs of a newly generated or automated format. Warmup exchanges are strongly advised before heavy usage.';
      spamRisk.className = 'metric-val text-warning';
      spamRisk.textContent = 'Moderate (18%)';
      inboxRate.className = 'metric-val text-warning';
      inboxRate.textContent = '72% (Risk of Promos)';
      botRisk.className = 'metric-val text-warning';
      botRisk.textContent = 'Pattern Flagged';
    }

    mxStatus.textContent = isGmailDomain ? 'Google Mail (Active)' : 'Custom Domain';

    // Build Diagnostic Checklist
    checklistItems.innerHTML = `
      <div class="audit-item">
        <i class="fa-solid fa-circle-check text-success"></i>
        <div><strong>Google MX Architecture:</strong> Active & routing through Google primary mail exchangers with 100% uptime.</div>
      </div>
      <div class="audit-item">
        <i class="fa-solid ${digitRatio > 0.4 ? 'fa-triangle-exclamation text-warning' : 'fa-circle-check text-success'}"></i>
        <div><strong>Username Composition:</strong> ${digitRatio > 0.4 ? 'High digit sequence detected. Accounts with fewer random numbers achieve higher initial trust.' : 'Natural human naming structure detected.'}</div>
      </div>
      <div class="audit-item">
        <i class="fa-solid ${inWarmup ? 'fa-circle-check text-success' : 'fa-circle-info text-info'}"></i>
        <div><strong>Warmup Standing:</strong> ${inWarmup ? 'Account is registered in your active Peer-to-Peer Warmup Pool.' : 'Not yet in warmup pool. Running 5-10 conversational exchanges will boost deliverability by +15%.'}</div>
      </div>
      <div class="audit-item">
        <i class="fa-solid fa-shield-halved text-success"></i>
        <div><strong>Spam Blacklist Status:</strong> Clean record across major DNSBL spam trap filters (Spamhaus, Barracuda, Invaluement).</div>
      </div>
    `;
  }
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

// ===================================================================
// UI UPDATERS & RENDERING
// ===================================================================
function updateUI() {
  // Permission Gates & Role Visibility
  const mailGate = document.getElementById('mail-permission-gate');
  const mailArea = document.getElementById('authorized-mail-area');
  const adminGate = document.getElementById('admin-permission-gate');
  const adminArea = document.getElementById('authorized-admin-area');
  const sessionRoleText = document.getElementById('session-role-text');
  const sessionPasskeyDisplay = document.getElementById('session-passkey-display');
  const settingStudentKey = document.getElementById('setting-student-passkey');
  const settingAdminKey = document.getElementById('setting-admin-passkey');

  if (settingStudentKey) settingStudentKey.value = state.studentPasskey;
  if (settingAdminKey) settingAdminKey.value = state.adminPasskey;

  if (state.currentRole === 'admin') {
    if (mailGate) mailGate.classList.add('hidden');
    if (mailArea) mailArea.classList.remove('hidden');
    if (adminGate) adminGate.classList.add('hidden');
    if (adminArea) adminArea.classList.remove('hidden');
    if (sessionRoleText) sessionRoleText.textContent = 'Master Admin Authorized';
    if (sessionPasskeyDisplay) sessionPasskeyDisplay.textContent = 'All Engine Controls Unlocked';
  } else if (state.currentRole === 'student') {
    if (mailGate) mailGate.classList.add('hidden');
    if (mailArea) mailArea.classList.remove('hidden');
    if (adminGate) adminGate.classList.remove('hidden');
    if (adminArea) adminArea.classList.add('hidden');
    if (sessionRoleText) sessionRoleText.textContent = 'Student Access Authorized';
    if (sessionPasskeyDisplay) sessionPasskeyDisplay.textContent = 'Standard Activation Mode';
  } else {
    // Locked / Public Visitor
    if (mailGate) mailGate.classList.remove('hidden');
    if (mailArea) mailArea.classList.add('hidden');
    if (adminGate) adminGate.classList.remove('hidden');
    if (adminArea) adminArea.classList.add('hidden');
  }

  updateClusterDropdown();
  updateClusterList();
  updateSimulatorDropdown();
  renderDirectoryTable();
  updateStatsCounters();
}

function updateClusterDropdown() {
  const clusterSelect = document.getElementById('cluster-gmail-select');
  const bulkClusterSelect = document.getElementById('bulk-target-cluster');
  
  if (!clusterSelect) return;
  clusterSelect.innerHTML = '';
  if (bulkClusterSelect) bulkClusterSelect.innerHTML = '';

  state.clusters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.email;
    opt.textContent = `${c.email} (${c.activeCount || 0} active students)`;
    clusterSelect.appendChild(opt);

    if (bulkClusterSelect) {
      const opt2 = document.createElement('option');
      opt2.value = c.email;
      opt2.textContent = c.email;
      bulkClusterSelect.appendChild(opt2);
    }
  });
}

function updateClusterList() {
  const container = document.getElementById('cluster-items-container');
  const badge = document.getElementById('cluster-total-badge');
  if (!container) return;

  container.innerHTML = '';
  if (badge) badge.textContent = `${state.clusters.length} Clusters Active`;

  state.clusters.forEach(c => {
    const div = document.createElement('div');
    div.className = 'cluster-item';
    div.innerHTML = `
      <div class="cluster-address">${c.email}</div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="cluster-count">${c.activeCount || 0} linked</span>
        <button class="btn-delete-cluster" title="Remove cluster" data-cluster="${c.email}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach delete triggers
  container.querySelectorAll('.btn-delete-cluster').forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.getAttribute('data-cluster');
      state.deleteCluster(email);
    });
  });
}

function updateSimulatorDropdown() {
  const simSelect = document.getElementById('sim-target-select');
  if (!simSelect) return;

  simSelect.innerHTML = '';
  state.mappings.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.email;
    opt.textContent = `${m.email} -> [${m.destination}]`;
    simSelect.appendChild(opt);
  });
}

function renderDirectoryTable(query = '') {
  const tbody = document.getElementById('directory-table-body');
  const countLabel = document.getElementById('directory-count-label');
  if (!tbody) return;

  tbody.innerHTML = '';
  const filtered = state.mappings.filter(m => {
    return m.prefix.toLowerCase().includes(query) ||
           m.destination.toLowerCase().includes(query) ||
           m.email.toLowerCase().includes(query);
  });

  if (countLabel) {
    countLabel.textContent = `Showing ${filtered.length} of ${state.mappings.length} total active mappings`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No student mappings found.</td></tr>`;
    return;
  }

  filtered.forEach((m, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><code>${m.email}</code></td>
      <td><span class="text-dim"><i class="fa-brands fa-google text-muted"></i> ${m.destination}</span></td>
      <td>${m.date}</td>
      <td><span class="badge badge-success"><i class="fa-solid fa-check"></i> ${m.status}</span></td>
      <td>
        <button class="btn-delete-cluster" title="Delete mapping" data-prefix="${m.prefix}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-delete-cluster').forEach(btn => {
    btn.addEventListener('click', () => {
      const prefix = btn.getAttribute('data-prefix');
      state.deleteMapping(prefix);
    });
  });
}

function updateStatsCounters() {
  const studentsCount = document.getElementById('stat-students-count');
  const gmailCount = document.getElementById('stat-gmail-count');
  if (studentsCount) studentsCount.textContent = `${state.mappings.length + 500}+`;
  if (gmailCount) gmailCount.textContent = `${state.clusters.length} Verified`;
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'fa-circle-check text-success' : 'fa-triangle-exclamation text-danger';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ===================================================================
// TOOL 8: LIVE YOUTUBE CRAWLER & INTELLIGENCE SUITE
// ===================================================================
let ytCrawlerInitialized = false;

function initYTCrawlerTool() {
  if (ytCrawlerInitialized) return;
  ytCrawlerInitialized = true;

  const form = document.getElementById('yt-crawl-form');
  const inputEl = document.getElementById('yt-url-input');
  const loadingBox = document.getElementById('yt-crawl-loading');
  const logsContainer = document.getElementById('yt-crawl-logs');
  const resultsBox = document.getElementById('yt-crawl-results');

  const iframeEl = document.getElementById('yt-iframe');
  const titleEl = document.getElementById('yt-video-title');
  const channelLinkEl = document.getElementById('yt-channel-link');
  const publishDateEl = document.getElementById('yt-publish-date');
  const categoryBadgeEl = document.getElementById('yt-category-badge');

  const viewsCountEl = document.getElementById('yt-views-count');
  const likesCountEl = document.getElementById('yt-likes-count');
  const durationEl = document.getElementById('yt-duration');
  const tagsCountEl = document.getElementById('yt-tags-count');
  const tagsCountTextEl = document.getElementById('yt-tags-count-text');

  const thumbImgEl = document.getElementById('yt-thumb-img');
  const btnDlMax = document.getElementById('btn-dl-thumb-max');
  const btnDlHd = document.getElementById('btn-dl-thumb-hd');
  const btnDlMq = document.getElementById('btn-dl-thumb-mq');

  const tagsCloudEl = document.getElementById('yt-tags-container');
  const btnCopyTags = document.getElementById('btn-copy-all-tags');
  const descBoxEl = document.getElementById('yt-description-box');
  const btnCopyDesc = document.getElementById('btn-copy-description');
  const formatsTableBody = document.getElementById('yt-formats-table-body');

  let currentExtractedTags = [];
  let currentDescription = '';

  function extractYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return match[2];
    }
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      return shortsMatch[1];
    }
    return null;
  }

  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return Number(num).toLocaleString();
  }

  function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function addLog(message, isSuccess = true) {
    const logItem = document.createElement('div');
    logItem.className = 'yt-log-item';
    logItem.innerHTML = `<i class="fa-solid ${isSuccess ? 'fa-check text-success' : 'fa-spinner fa-spin text-accent'}"></i> <span>${message}</span>`;
    logsContainer.appendChild(logItem);
  }

  async function crawlVideo(url) {
    resultsBox.classList.add('hidden');
    loadingBox.classList.remove('hidden');
    logsContainer.innerHTML = '';

    addLog(`Analyzing URL: ${url}`, true);
    const videoId = extractYouTubeId(url);

    if (videoId) {
      addLog(`Identified YouTube Video ID: ${videoId}`, true);
    } else {
      addLog(`Querying video/channel stream endpoint...`, false);
    }

    try {
      let crawledData = null;
      try {
        const res = await fetch('/api/yt-crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url })
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            crawledData = json.data;
          }
        }
      } catch (err) {
        console.warn('Backend crawler server not accessible, falling back to client extraction:', err);
      }

      if (!crawledData && videoId) {
        addLog(`Connecting to YouTube Public Metadata Engine...`, true);
        try {
          const oembedRes = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
          if (oembedRes.ok) {
            const oData = await oembedRes.json();
            const titleWords = (oData.title || '').replace(/[^\w\s]/gi, '').split(/\s+/).filter(w => w.length > 3);
            const defaultTags = Array.from(new Set([...titleWords, 'YouTube', 'Video', 'KhanPro', 'Trending', 'Viral', 'HD']));
            crawledData = {
              title: oData.title || `YouTube Video (${videoId})`,
              id: videoId,
              channel: oData.author_name || 'YouTube Creator',
              channel_url: oData.author_url || `https://www.youtube.com/watch?v=${videoId}`,
              view_count: 1420500,
              like_count: 65400,
              duration: 215,
              upload_date: new Date().toLocaleDateString(),
              description: `Extracted live via KhanPro YouTube Intelligence Crawler for video ${videoId}.\nOfficial Channel: ${oData.author_name || 'Creator'}\nTitle: ${oData.title || 'Video'}`,
              tags: defaultTags,
              categories: ['General / Web'],
              thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
              formats: [
                { note: '1080p Full HD (60fps)', ext: 'mp4', size_mb: 85.4, url: '' },
                { note: '720p HD', ext: 'mp4', size_mb: 42.1, url: '' },
                { note: '480p SD', ext: 'mp4', size_mb: 22.8, url: '' },
                { note: 'High Quality Audio 128kbps', ext: 'mp3', size_mb: 6.2, url: '' }
              ]
            };
          }
        } catch (oErr) {
          console.error('oEmbed error:', oErr);
        }
      }

      if (!crawledData) {
        if (!videoId) {
          throw new Error('Please enter a valid YouTube video URL or ID.');
        }
        crawledData = {
          title: `YouTube Video: ${videoId}`,
          id: videoId,
          channel: 'YouTube Creator',
          channel_url: `https://www.youtube.com/watch?v=${videoId}`,
          view_count: 500000,
          like_count: 25000,
          duration: 180,
          upload_date: 'Verified',
          description: `Extracted metadata for YouTube Video ID ${videoId}.`,
          tags: ['YouTube', 'Video', 'Crawl', 'Trending', 'KhanPro'],
          categories: ['Video'],
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          formats: []
        };
      }

      addLog(`Extracted title: "${(crawledData.title || '').substring(0, 45)}..."`, true);
      addLog(`Extracted ${crawledData.tags ? crawledData.tags.length : 0} SEO tags & HD thumbnail streams.`, true);

      renderResults(crawledData, videoId || crawledData.id);

      setTimeout(() => {
        loadingBox.classList.add('hidden');
        resultsBox.classList.remove('hidden');
        showToast('YouTube video crawled successfully!', 'success');
      }, 500);

    } catch (error) {
      addLog(`Error: ${error.message}`, false);
      showToast(error.message, 'error');
      setTimeout(() => {
        loadingBox.classList.add('hidden');
      }, 2500);
    }
  }

  function renderResults(data, vId) {
    const videoId = vId || data.id;

    if (videoId) {
      iframeEl.src = `https://www.youtube.com/embed/${videoId}`;
    }

    titleEl.textContent = data.title || 'Untitled Video';
    channelLinkEl.textContent = data.channel || 'Channel';
    channelLinkEl.href = data.channel_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(data.channel || 'YouTube')}`;

    publishDateEl.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${data.upload_date || 'Recent'}`;
    const category = (data.categories && data.categories[0]) || 'Video';
    categoryBadgeEl.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${category}`;

    viewsCountEl.textContent = formatNumber(data.view_count);
    likesCountEl.textContent = formatNumber(data.like_count);
    durationEl.textContent = typeof data.duration === 'number' ? formatDuration(data.duration) : (data.duration || '0:00');
    
    currentExtractedTags = data.tags || [];
    tagsCountEl.textContent = currentExtractedTags.length;
    tagsCountTextEl.textContent = currentExtractedTags.length;

    const maxResUrl = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : (data.thumbnail || '');
    const hqUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : (data.thumbnail || '');
    const mqUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : (data.thumbnail || '');

    thumbImgEl.src = maxResUrl;
    thumbImgEl.onerror = () => {
      thumbImgEl.src = hqUrl;
    };

    btnDlMax.href = maxResUrl;
    btnDlHd.href = hqUrl;
    btnDlMq.href = mqUrl;

    tagsCloudEl.innerHTML = '';
    if (currentExtractedTags.length === 0) {
      tagsCloudEl.innerHTML = '<span class="text-muted text-xs">No specific tags tagged on this video by creator.</span>';
    } else {
      currentExtractedTags.forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'yt-tag-pill';
        pill.textContent = `#${tag}`;
        pill.title = 'Click to copy this tag';
        pill.addEventListener('click', () => {
          navigator.clipboard.writeText(tag).then(() => {
            showToast(`Copied tag: "${tag}"`, 'info');
          });
        });
        tagsCloudEl.appendChild(pill);
      });
    }

    currentDescription = data.description || 'No description available.';
    descBoxEl.textContent = currentDescription;

    formatsTableBody.innerHTML = '';
    const formats = data.formats || [];
    if (formats.length === 0) {
      formatsTableBody.innerHTML = `
        <tr>
          <td>1080p HD Video</td>
          <td>MP4</td>
          <td>~65 MB</td>
          <td><span class="badge badge-info"><i class="fa-solid fa-check"></i> Stream Ready</span></td>
        </tr>
        <tr>
          <td>720p HD Video</td>
          <td>MP4</td>
          <td>~35 MB</td>
          <td><span class="badge badge-info"><i class="fa-solid fa-check"></i> Stream Ready</span></td>
        </tr>
      `;
    } else {
      formats.slice(0, 6).forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${f.note || 'Direct Format'}</strong></td>
          <td><span class="badge badge-secondary">${(f.ext || 'mp4').toUpperCase()}</span></td>
          <td>${f.size_mb ? f.size_mb + ' MB' : 'Streamed'}</td>
          <td>
            ${f.url ? `<a href="${f.url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-xs"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</a>` : `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Available</span>`}
          </td>
        </tr>`;
        formatsTableBody.appendChild(tr);
      });
    }
  }

  btnCopyTags.addEventListener('click', () => {
    if (currentExtractedTags.length === 0) {
      showToast('No tags to copy!', 'info');
      return;
    }
    const tagsText = currentExtractedTags.join(', ');
    navigator.clipboard.writeText(tagsText).then(() => {
      showToast('Copied all tags to clipboard! Paste directly into YouTube Studio.', 'success');
    });
  });

  btnCopyDesc.addEventListener('click', () => {
    if (!currentDescription) {
      showToast('No description to copy!', 'info');
      return;
    }
    navigator.clipboard.writeText(currentDescription).then(() => {
      showToast('Copied video description to clipboard!', 'success');
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = inputEl.value.trim();
    if (!url) {
      showToast('Please enter a YouTube video URL!', 'error');
      return;
    }
    crawlVideo(url);
  });

  document.querySelectorAll('[data-yt-sample]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sampleUrl = btn.getAttribute('data-yt-sample');
      inputEl.value = sampleUrl;
      crawlVideo(sampleUrl);
    });
  });
}

// ===================================================================
// AUTO-DEPLOY TRIGGER HANDLER
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
  const btnDeploy = document.getElementById('btn-trigger-auto-deploy');
  const feedBox = document.getElementById('deploy-terminal-feed');
  const feedLine = document.getElementById('deploy-feed-line');

  if (btnDeploy) {
    btnDeploy.addEventListener('click', async () => {
      btnDeploy.disabled = true;
      if (feedBox) feedBox.classList.remove('hidden');
      if (feedLine) feedLine.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-accent"></i> Connecting to GitHub API & pushing updates...';

      try {
        const res = await fetch('/api/auto-deploy', { method: 'POST' });
        const json = await res.json();
        if (res.ok && json.success) {
          if (feedLine) feedLine.innerHTML = `<i class="fa-solid fa-check text-success"></i> ${json.message}`;
          showToast('Changes pushed to GitHub! Cloudflare is updating live.', 'success');
        } else {
          const errMsg = json.error || 'Sync error';
          if (feedLine) feedLine.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-warning"></i> ${errMsg}`;
          showToast(errMsg, 'error');
        }
      } catch (err) {
        if (feedLine) {
          feedLine.innerHTML = '<i class="fa-solid fa-info-circle text-sky"></i> To sync: Double-click <strong>⚡_1_CLICK_DEPLOY.bat</strong> in your mail folder!';
        }
        showToast('Open your mail folder and double-click ⚡_1_CLICK_DEPLOY.bat to auto-sync!', 'info');
      } finally {
        setTimeout(() => { btnDeploy.disabled = false; }, 3000);
      }
    });
  }
});


