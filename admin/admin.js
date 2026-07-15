const TOKEN_KEY = 'daidai_admin_token';

function token() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {}
  );
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken('');
    showLogin();
    throw new Error(data.error?.message || '未登录');
  }
  if (!res.ok) throw new Error(data.error?.message || '请求失败');
  return data;
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('appView').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
}

function switchTab(name) {
  document.querySelectorAll('.nav').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  const titles = { overview: '总览', services: '服务状态', guide: '部署说明' };
  document.getElementById('pageTitle').textContent = titles[name] || '后台';
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  const s = data.stats || {};
  document.getElementById('statChat').textContent = s.chat ?? 0;
  document.getElementById('statImage').textContent = s.image ?? 0;
  document.getElementById('statEdit').textContent = s.imageEdit ?? 0;
  document.getElementById('statLogin').textContent = s.login ?? 0;

  const badge = document.getElementById('aliveBadge');
  badge.textContent = data.ok ? '服务正常' : '异常';
  badge.className = 'badge ' + (data.ok ? 'ok' : 'bad');

  const rows = [
    ['对话（文字 / 写作 / 编程）', data.chatConfigured, '需 DEEPSEEK_API_KEY'],
    ['生图 / 改图', data.imageConfigured, '需 OPENAI_API_KEY'],
    ['小程序微信登录', data.wechatLoginConfigured, '需 WECHAT_APPID + WECHAT_SECRET'],
    ['网页微信登录', data.webWechatLoginConfigured, '需 WECHAT_OPEN_APPID + WECHAT_OPEN_SECRET（跳转授权，非扫码）'],
    ['后台密码', data.adminConfigured, '需 ADMIN_PASSWORD'],
  ];
  document.getElementById('svcBody').innerHTML = rows
    .map(([name, ok, tip]) => {
      const pill = ok
        ? '<span class="pill ok">已就绪</span>'
        : '<span class="pill warn">未配置</span>';
      return `<tr><td>${name}</td><td>${pill}</td><td>${tip}</td></tr>`;
    })
    .join('');
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = document.getElementById('pwd').value || '';
  const err = document.getElementById('loginErr');
  err.textContent = '';
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setToken(data.token);
    showApp();
    await loadOverview();
  } catch (e) {
    err.textContent = e.message || '登录失败';
  }
});

document.getElementById('pwd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (_) {}
  setToken('');
  showLogin();
});

document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

(async function boot() {
  if (!token()) {
    showLogin();
    return;
  }
  try {
    showApp();
    await loadOverview();
  } catch (_) {
    showLogin();
  }
})();
