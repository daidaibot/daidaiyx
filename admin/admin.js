const TOKEN_KEY = "daidai_admin_token";

const TITLES = {
  overview: ["总览", "服务状态 · 快捷操作 · 健康检查"],
  users: ["用户总览", "登录用户 · 昵称头像 · 最近活跃"],
  ops: ["运维配置", "开关 · 密钥 · 域名 · 公告"],
  logs: ["访问日志", "筛选 · 排查接口调用"],
  errors: ["错误日志", "失败与异常详情"],
  probe: ["连通探测", "自检上游与登录配置"],
  guide: ["上线检查", "配置清单 + 接口一览"],
};

let overviewCache = null;
let logsCache = [];
let errorsCache = [];
let errMetaTip = "";
let autoTimer = null;
let toastTimer = null;

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
}

async function api(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {}
  );
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let res;
  try {
    res = await fetch(path, Object.assign({}, options, { headers }));
  } catch (_) {
    throw new Error("网络不通，请检查服务是否在线");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken("");
    showLogin();
    throw new Error(data.error?.message || "未登录或已过期，请重新登录");
  }
  if (!res.ok) {
    const msg =
      (data.error && data.error.message) ||
      (typeof data.error === "string" ? data.error : "") ||
      data.message ||
      "";
    throw new Error(msg || `请求异常（HTTP ${res.status}）`);
  }
  return data;
}

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
  stopAutoRefresh();
}
function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}
function fmtUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  return `${h}小时 ${m}分`;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function rate(ok, fail) {
  const a = Number(ok) || 0;
  const b = Number(fail) || 0;
  const t = a + b;
  if (!t) return "暂无数据";
  return `失败率 ${Math.round((b / t) * 100)}%（${b}/${t}）`;
}
function markRefresh() {
  document.getElementById("lastRefresh").textContent = "刷新于 " + fmtTime(Date.now());
}

function buildHealth(data) {
  const s = data.settings || {};
  const items = [
    {
      ok: data.adminConfigured,
      level: data.adminConfigured ? "ok" : "bad",
      title: "管理密码",
      tip: data.adminConfigured ? "已配置 ADMIN_PASSWORD" : "请在云托管环境变量配置 ADMIN_PASSWORD",
    },
    {
      ok: data.chatConfigured,
      level: data.chatConfigured ? "ok" : "bad",
      title: "呆呆 AI 密钥",
      tip: data.chatConfigured
        ? data.secrets?.chatMasked || "已就绪"
        : "到「运维配置」粘贴密钥并保存",
    },
    {
      ok: data.imageConfigured,
      level: data.imageConfigured ? "ok" : "warn",
      title: "呆呆 Image 密钥",
      tip: data.imageConfigured
        ? data.secrets?.imageMasked || "已就绪"
        : "未配置则无法生图，可稍后补",
    },
    {
      ok: data.wechatLoginConfigured,
      level: data.wechatLoginConfigured ? "ok" : "warn",
      title: "小程序登录",
      tip: data.wechatLoginConfigured
        ? "WECHAT_APPID / SECRET 已配置"
        : "缺少环境变量，小程序无法真登录",
    },
    {
      ok: Boolean(
        data.upstream?.imageBase &&
          (/api\.openai\.com$/i.test(data.upstream.imageBase)
            ? data.outboundProxy?.enabled
            : true)
      ),
      level: (() => {
        const base = data.upstream?.imageBase || "";
        if (!base) return "warn";
        if (/api\.openai\.com$/i.test(base)) {
          return data.outboundProxy?.enabled ? "ok" : "warn";
        }
        return "ok";
      })(),
      title: "生图上游",
      tip: (() => {
        const base = data.upstream?.imageBase || "";
        if (!base) return "未读取到上游，请设 DAIDAI_IMAGE_BASE_URL=https://api.openai.com";
        if (/api\.openai\.com$/i.test(base)) {
          return data.outboundProxy?.enabled
            ? `${base} · 代理池 ${data.outboundProxy.count || 0} 条`
            : `${base}（官方 API，请在运维配置粘贴代理池，否则国内常不通）`;
        }
        return `${base}（自定义中转）`;
      })(),
    },
    {
      ok: Boolean(data.publicApiBase || s.publicApiBase),
      level: data.publicApiBase || s.publicApiBase ? "ok" : "warn",
      title: "对接域名",
      tip:
        data.publicApiBase ||
        s.publicApiBase ||
        "云托管环境变量填 DAIDAI_API_BASE",
    },
    {
      ok: !s.maintenance,
      level: s.maintenance ? "warn" : "ok",
      title: "维护模式",
      tip: s.maintenance ? "当前全站维护中，用户无法聊天/生图" : "服务对外开放中",
    },
    {
      ok: !(s.blockChat || s.blockImage),
      level: s.blockChat || s.blockImage ? "warn" : "ok",
      title: "能力开关",
      tip: [
        s.blockChat ? "对话已暂停" : "对话可用",
        s.blockImage ? "生图已暂停" : "生图可用",
      ].join(" · "),
    },
  ];
  return items;
}

function renderHealthList(items, targetId) {
  document.getElementById(targetId).innerHTML = items
    .map((it) => {
      const icon = it.level === "ok" ? "✓" : it.level === "bad" ? "!" : "·";
      return `<div class="check-item ${it.level}">
        <div class="mark">${icon}</div>
        <div class="txt">${esc(it.title)}<small>${esc(it.tip)}</small></div>
      </div>`;
    })
    .join("");
}

function renderHealthBanner(items, data) {
  const bad = items.filter((i) => i.level === "bad");
  const warn = items.filter((i) => i.level === "warn");
  const el = document.getElementById("healthBanner");
  if (bad.length) {
    el.className = "health-banner bad";
    el.textContent =
      "有 " +
      bad.length +
      " 项关键配置未完成：" +
      bad.map((i) => i.title).join("、") +
      "。优先处理后再上线。";
  } else if (data.settings?.maintenance) {
    el.className = "health-banner warn";
    el.textContent = "维护模式开启中。用户端将看到维护提示，后台不受影响。";
  } else if (warn.length) {
    el.className = "health-banner warn";
    el.textContent =
      "可上线，但有 " +
      warn.length +
      " 项建议完善：" +
      warn.map((i) => i.title).join("、");
  } else {
    el.className = "health-banner ok";
    el.textContent = "健康检查全部通过。密钥、登录与对外服务状态正常。";
  }
}

async function loadOverview() {
  const data = await api("/api/admin/overview");
  overviewCache = data;
  const s = data.stats || {};
  const set = data.settings || {};

  const cards = [
    ["对话成功", s.chat ?? 0, rate(s.chat, s.chatFail), Number(s.chatFail) > 0 ? "warn" : ""],
    ["生图成功", s.image ?? 0, rate(s.image, s.imageFail), Number(s.imageFail) > 0 ? "warn" : ""],
    ["改图成功", s.imageEdit ?? 0, rate(s.imageEdit, s.imageEditFail), ""],
    ["登录次数", s.login ?? 0, "运行 " + fmtUptime(data.uptimeSec), ""],
    ["对话失败", s.chatFail ?? 0, "累计失败", Number(s.chatFail) > 0 ? "bad" : ""],
    ["生图失败", s.imageFail ?? 0, "累计失败", Number(s.imageFail) > 0 ? "bad" : ""],
    [
      "限流阈值",
      set.rateLimitPerMin ?? "—",
      "次 / 分钟",
      "",
    ],
    [
      "运行状态",
      set.maintenance ? "维护" : "正常",
      set.blockChat || set.blockImage ? "有能力暂停" : "能力全开",
      set.maintenance ? "warn" : "",
    ],
  ];
  document.getElementById("statCards").innerHTML = cards
    .map(
      ([k, v, sub, cls]) =>
        `<div class="card ${cls || ""}"><div class="card-k">${k}</div><div class="card-v">${esc(
          v
        )}</div><div class="card-sub">${esc(sub)}</div></div>`
    )
    .join("");

  const hourly = data.hourly || [];
  const max = Math.max(1, ...hourly.map((h) => h.req || 0));
  document.getElementById("hourlyBars").innerHTML = hourly
    .map((h) => {
      const pct = Math.round(((h.req || 0) / max) * 100);
      return `<div class="bar-col" title="${esc(h.label)} 共 ${h.req} 次"><div class="bar" style="height:${pct}%"></div><div class="bar-lab">${esc(
        String(h.label || "").replace(":00", "")
      )}</div></div>`;
    })
    .join("");

  const sys = data.system || {};
  const mem = sys.memory || {};
  const lat = sys.latencyMs || {};
  document.getElementById("sysInfo").innerHTML = [
    ["Node", sys.node || "—"],
    ["平台", sys.platform || "—"],
    ["CPU 核数", sys.cpus ?? "—"],
    ["进程内存 RSS", `${mem.rssMb ?? "—"} MB`],
    ["堆使用", `${mem.heapUsedMb ?? "—"} MB`],
    ["系统内存占用", `${mem.systemUsedPct ?? "—"}%`],
    ["对话均耗时", `${lat.chat ?? 0} ms`],
    ["生图均耗时", `${lat.image ?? 0} ms`],
    ["改图均耗时", `${lat.imageEdit ?? 0} ms`],
    ["日志缓存", `请求 ${sys.logCounts?.requests ?? 0} / 错误 ${sys.logCounts?.errors ?? 0}`],
  ]
    .map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`)
    .join("");

  const badge = document.getElementById("aliveBadge");
  const maint = set.maintenance;
  badge.textContent = maint ? "维护中" : data.ok ? "服务正常" : "异常";
  badge.className = "badge " + (maint ? "warn" : data.ok ? "ok" : "bad");

  document.getElementById("announceNote").innerHTML = set.announce
    ? `<strong>当前公告</strong><p>${esc(set.announce)}</p>`
    : "";

  document.getElementById("quickMaintenance").checked = !!set.maintenance;
  document.getElementById("quickBlockChat").checked = !!set.blockChat;
  document.getElementById("quickBlockImage").checked = !!set.blockImage;

  const health = buildHealth(data);
  renderHealthList(health, "healthList");
  renderHealthBanner(health, data);
  renderHealthList(health, "guideList");

  document.getElementById("sideMeta").innerHTML = [
    `运行 ${fmtUptime(data.uptimeSec)}`,
    set.publicApiBase || data.publicApiBase
      ? esc(set.publicApiBase || data.publicApiBase)
      : "域名未填",
  ].join("<br>");

  const rows = [
    ["呆呆 AI", data.chatConfigured, data.upstream?.chatBase || "—"],
    ["呆呆 Image", data.imageConfigured, data.upstream?.imageBase || "—"],
    ["小程序登录", data.wechatLoginConfigured, data.wechatLoginConfigured ? "环境变量已配" : "缺 AppID/Secret"],
    ["网页通行", data.webPasswordConfigured, data.webPasswordConfigured ? "已启用" : "未配置（可用管理密码）"],
    ["管理后台", data.adminConfigured, "—"],
  ];
  document.getElementById("svcBody").innerHTML = rows
    .map(([name, ok, tip]) => {
      const pill = ok
        ? '<span class="pill ok">已就绪</span>'
        : '<span class="pill warn">待配置</span>';
      return `<tr><td>${name}</td><td>${pill}</td><td>${esc(tip)}</td></tr>`;
    })
    .join("");

  try {
    const cfg = await api("/api/admin/config");
    const env = cfg.env || {};
    const masked = cfg.masked || {};
    document.getElementById("envInfo").innerHTML = Object.keys(env)
      .map((k) => {
        let show = String(env[k]);
        if (masked[k]) show = `${show} · ${masked[k]}`;
        return `<div><span>${esc(k)}</span><span>${esc(show)}</span></div>`;
      })
      .join("");
  } catch (_) {}

  try {
    const errData = await api("/api/admin/errors?limit=5");
    const rowsE = errData.errors || [];
    document.getElementById("recentErrors").innerHTML = rowsE.length
      ? rowsE
          .map(
            (r) => `<div class="mini-item"><div class="t">${fmtTime(r.at)} · ${esc(
              r.source
            )} · ${r.status || "—"}</div><div class="m">${esc(r.message)}</div></div>`
          )
          .join("")
      : `<div class="muted">暂无错误，很好。</div>`;
  } catch (_) {
    document.getElementById("recentErrors").innerHTML =
      `<div class="muted">错误列表加载失败</div>`;
  }

  markRefresh();
}

function renderLogs() {
  const q = (document.getElementById("logFilter").value || "").trim().toLowerCase();
  const st = document.getElementById("logStatus").value;
  let rows = logsCache.slice();
  if (st === "2xx") rows = rows.filter((r) => r.status >= 200 && r.status < 300);
  if (st === "4xx") rows = rows.filter((r) => r.status >= 400 && r.status < 500);
  if (st === "5xx") rows = rows.filter((r) => r.status >= 500);
  if (q) {
    rows = rows.filter((r) =>
      `${r.method} ${r.path} ${r.ip} ${r.status}`.toLowerCase().includes(q)
    );
  }
  document.getElementById("logCount").textContent = `显示 ${rows.length} / ${logsCache.length}`;
  document.getElementById("logsBody").innerHTML = rows.length
    ? rows
        .map((r) => {
          const cls = r.status >= 500 ? "bad" : r.status >= 400 ? "warn" : "ok";
          return `<tr>
            <td>${fmtTime(r.at)}</td>
            <td>${esc(r.method)}</td>
            <td title="${esc(r.path)}">${esc(r.path)}</td>
            <td><span class="pill ${cls}">${r.status}</span></td>
            <td>${r.ms}ms</td>
            <td>${esc(r.ip)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">没有匹配的日志</td></tr>`;
}

function renderErrors() {
  const q = (document.getElementById("errFilter").value || "").trim().toLowerCase();
  let rows = errorsCache.slice();
  if (q) {
    rows = rows.filter((r) =>
      `${r.source} ${r.message} ${r.status} ${r.detail} ${r.path}`.toLowerCase().includes(q)
    );
  }
  document.getElementById("errCount").textContent = `显示 ${rows.length} / ${errorsCache.length}${
    errMetaTip ? " · " + errMetaTip : ""
  }`;
  document.getElementById("errorsBody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td>${fmtTime(r.at)}</td>
        <td>${esc(r.source)}${r.path ? `<div class="muted small">${esc(r.path)}</div>` : ""}</td>
        <td>${r.status || "—"}</td>
        <td title="${esc(r.message)}">${esc(String(r.message || "").slice(0, 200))}</td>
        <td title="${esc(r.detail || "")}">${esc(String(r.detail || r.ip || "").slice(0, 160))}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5">暂无错误</td></tr>`;
}

async function loadUsers() {
  const q = (document.getElementById("usersQuery") && document.getElementById("usersQuery").value) || "";
  const data = await api(`/api/admin/users?limit=100&offset=0&q=${encodeURIComponent(q)}`);
  const body = document.getElementById("usersBody");
  const meta = document.getElementById("usersMeta");
  const users = data.users || [];
  meta.textContent = `共 ${data.total || 0} 人 · 存储 ${data.source === "mysql" ? "MySQL" : "本地文件"}${
    data.dbReady ? "" : "（未连库）"
  }`;
  if (!users.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">暂无用户。小程序登录成功后会出现在这里。</td></tr>`;
    return;
  }
  body.innerHTML = users
    .map((u) => {
      const name = esc(u.nickName || "微信用户");
      const avatar = u.avatarUrl
        ? `<img class="user-avatar" src="${esc(u.avatarUrl)}" alt="" />`
        : `<span class="user-avatar ph">呆</span>`;
      return `<tr>
        <td><div class="user-cell">${avatar}<span>${name}</span></div></td>
        <td><code class="mono">${esc(u.openid || "")}</code></td>
        <td>${esc(u.platform || "wechat")}</td>
        <td>${fmtTime(u.createdAt)}</td>
        <td>${fmtTime(u.lastLoginAt)}</td>
      </tr>`;
    })
    .join("");
}

async function loadLogs() {
  const data = await api("/api/admin/logs?limit=200");
  logsCache = data.logs || [];
  renderLogs();
  markRefresh();
}

async function loadErrors() {
  const data = await api("/api/admin/errors?limit=150");
  errorsCache = data.errors || [];
  errMetaTip = data.meta?.tip || "";
  renderErrors();
  markRefresh();
}

async function loadRoutes() {
  const data = await api("/api/admin/routes");
  document.getElementById("routesBody").innerHTML = (data.routes || [])
    .map(
      (r) =>
        `<tr><td><span class="pill ok">${esc(r.method)}</span></td><td><code>${esc(
          r.path
        )}</code></td><td>${esc(r.desc)}</td></tr>`
    )
    .join("");
}

async function loadSettingsForm() {
  const data = await api("/api/admin/settings");
  const s = data.settings || {};
  document.getElementById("setMaintenance").checked = !!s.maintenance;
  document.getElementById("setMaintMsg").value =
    s.maintenanceMessage ||
    "呆呆 AI 正在升级维护，暂时无法使用聊天与生图。完成后会很快恢复，请稍后再来。";
  document.getElementById("setBlockChat").checked = !!s.blockChat;
  document.getElementById("setBlockImage").checked = !!s.blockImage;
  document.getElementById("setRate").value = s.rateLimitPerMin || 120;
  document.getElementById("setApiBase").value = s.publicApiBase || "";
  document.getElementById("setAnnounce").value = s.announce || "";
  document.getElementById("setNotes").value = s.notes || "";
  await loadSecretsForm();
}

async function loadSecretsForm() {
  const sec = await api("/api/admin/secrets");
  document.getElementById("secChat").value = "";
  document.getElementById("secImage").value = "";
  document.getElementById("secChatHint").textContent = sec.chatConfigured
    ? `已配置 · ${sec.chatMasked}${sec.chatFromAdmin ? " · 来自后台" : " · 来自环境变量"}`
    : "未配置";
  document.getElementById("secImageHint").textContent = sec.imageConfigured
    ? `已配置 · ${sec.imageMasked}${sec.imageFromAdmin ? " · 来自后台" : " · 来自环境变量"}`
    : "未配置";
  await loadProxiesForm();
}

async function loadProxiesForm() {
  try {
    const data = await api("/api/admin/proxies");
    document.getElementById("proxyList").value = data.text || "";
    document.getElementById("proxyHint").textContent = data.count
      ? `已加载 ${data.count} 条 · ${data.file || "data/proxies.txt"}`
      : "尚未配置代理（生图将直连上游，国内可能不通）";
  } catch (e) {
    document.getElementById("proxyHint").textContent = e.message || "加载失败";
  }
  await loadEgressIp();
}

async function loadEgressIp() {
  const el = document.getElementById("egressIp");
  if (!el) return;
  el.textContent = "检测中…";
  try {
    const data = await api("/api/admin/egress-ip");
    el.textContent = data.ip || "—";
    el.dataset.ip = data.ip || "";
    const note = document.getElementById("egressIpNote");
    if (note && data.note) note.textContent = data.note;
  } catch (e) {
    el.textContent = e.message || "获取失败";
    el.dataset.ip = "";
  }
}

async function copyEgressIp() {
  const ip = (document.getElementById("egressIp") || {}).dataset?.ip || "";
  if (!ip) {
    toast("还没有可用的出口 IP", "bad");
    return;
  }
  try {
    await navigator.clipboard.writeText(ip);
    toast(`已复制 ${ip}`, "ok");
  } catch {
    toast(ip, "ok");
  }
}

async function saveProxies() {
  try {
    const text = document.getElementById("proxyList").value || "";
    const data = await api("/api/admin/proxies", {
      method: "PUT",
      body: JSON.stringify({ text }),
    });
    toast(`代理池已保存（${data.count || 0} 条）`, "ok");
    await loadProxiesForm();
    await loadOverview();
  } catch (e) {
    toast(e.message || "保存失败", "bad");
  }
}

async function saveSettings(patch, silent) {
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!silent) toast("设置已保存", "ok");
    await loadOverview();
  } catch (e) {
    toast(e.message || "保存失败", "bad");
    throw e;
  }
}

async function saveSettingsForm() {
  await saveSettings({
    maintenance: document.getElementById("setMaintenance").checked,
    maintenanceMessage: document.getElementById("setMaintMsg").value,
    blockChat: document.getElementById("setBlockChat").checked,
    blockImage: document.getElementById("setBlockImage").checked,
    rateLimitPerMin: Number(document.getElementById("setRate").value || 120),
    publicApiBase: document.getElementById("setApiBase").value,
    announce: document.getElementById("setAnnounce").value,
    notes: document.getElementById("setNotes").value,
  });
}

async function quickPatch(field, value) {
  const tip = document.getElementById("quickTip");
  tip.textContent = "保存中…";
  try {
    await saveSettings({ [field]: value }, true);
    tip.textContent = "已生效";
    toast("已更新：" + field, "ok");
    setTimeout(() => {
      if (tip.textContent === "已生效") tip.textContent = "";
    }, 1500);
  } catch (_) {
    tip.textContent = "失败";
  }
}

async function saveSecrets() {
  try {
    const body = {};
    const chatKey = document.getElementById("secChat").value.trim();
    const imageKey = document.getElementById("secImage").value.trim();
    if (chatKey) body.chatKey = chatKey;
    if (imageKey) body.imageKey = imageKey;
    if (!chatKey && !imageKey) {
      toast("请先粘贴要更新的密钥", "bad");
      return;
    }
    await api("/api/admin/secrets", { method: "PUT", body: JSON.stringify(body) });
    toast("密钥已保存", "ok");
    await loadSecretsForm();
    await loadOverview();
  } catch (e) {
    toast(e.message || "保存失败", "bad");
  }
}

function setProbeUi(kind, state, text) {
  const map = {
    chat: ["probeChat", "probePillChat", "probeBoxChat"],
    image: ["probeImage", "probePillImage", "probeBoxImage"],
    wechat: ["probeWechat", "probePillWechat", "probeBoxWechat"],
  };
  const [outId, pillId, boxId] = map[kind];
  const out = document.getElementById(outId);
  const pill = document.getElementById(pillId);
  const box = document.getElementById(boxId);
  out.textContent = text;
  box.classList.remove("ok", "bad", "warn");
  if (state === "ok") {
    pill.className = "pill ok";
    pill.textContent = "通过";
    box.classList.add("ok");
  } else if (state === "bad") {
    pill.className = "pill bad";
    pill.textContent = "失败";
    box.classList.add("bad");
  } else if (state === "run") {
    pill.className = "pill warn";
    pill.textContent = "探测中";
    box.classList.add("warn");
  } else {
    pill.className = "pill";
    pill.textContent = "未测";
  }
}

async function runProbe(kind) {
  setProbeUi(kind, "run", "探测中…");
  try {
    const data = await api("/api/admin/probe", {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
    if (data.ok) {
      setProbeUi(
        kind,
        "ok",
        ["通过", data.preview ? `说明：${data.preview}` : "", data.ms != null ? `耗时：${data.ms}ms` : "", data.status ? `上游状态：${data.status}` : ""]
          .filter(Boolean)
          .join("\n")
      );
    } else {
      setProbeUi(
        kind,
        "bad",
        [
          "未通过",
          data.error || data.preview || "",
          data.ms != null ? `耗时：${data.ms}ms` : "",
          "建议：检查密钥、环境变量、云托管公网出口后重试",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  } catch (e) {
    setProbeUi(
      kind,
      "bad",
      [e.message || "探测失败", "建议：确认已重新登录后台，且服务已部署最新版本"].join("\n")
    );
  }
}

async function probeAll() {
  toast("开始一键探测…");
  await runProbe("chat");
  await runProbe("image");
  await runProbe("wechat");
  toast("探测完成", "ok");
}

function switchTab(name) {
  document.querySelectorAll(".nav").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`tab-${name}`).classList.remove("hidden");
  const t = TITLES[name] || ["后台", ""];
  document.getElementById("pageTitle").textContent = t[0];
  document.getElementById("pageSub").textContent = t[1];

  if (name === "logs") loadLogs().catch((e) => toast(e.message, "bad"));
  if (name === "errors") loadErrors().catch((e) => toast(e.message, "bad"));
  if (name === "users") loadUsers().catch((e) => toast(e.message, "bad"));
  if (name === "ops") {
    loadSettingsForm().catch((e) => toast(e.message, "bad"));
    loadOverview().catch(() => {});
  }
  if (name === "overview") loadOverview().catch((e) => toast(e.message, "bad"));
  if (name === "guide") {
    loadOverview().catch(() => {});
    loadRoutes().catch((e) => toast(e.message, "bad"));
  }
}

function stopAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}
function startAutoRefresh() {
  stopAutoRefresh();
  autoTimer = setInterval(() => {
    const on = document.querySelector(".nav.on");
    const tab = (on && on.dataset.tab) || "overview";
    if (tab === "overview" || tab === "ops") {
      loadOverview().catch(() => {});
    } else if (tab === "logs") {
      loadLogs().catch(() => {});
    } else if (tab === "errors") {
      loadErrors().catch(() => {});
    } else if (tab === "users") {
      loadUsers().catch(() => {});
    }
  }, 15000);
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  const password = document.getElementById("pwd").value || "";
  const err = document.getElementById("loginErr");
  err.textContent = "";
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setToken(data.token);
    showApp();
    await loadOverview();
  } catch (e) {
    err.textContent = e.message || "登录失败";
  }
});

document.getElementById("pwd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } catch (_) {}
  setToken("");
  showLogin();
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  const on = document.querySelector(".nav.on");
  switchTab((on && on.dataset.tab) || "overview");
  toast("已刷新");
});

document.getElementById("autoRefresh").addEventListener("change", (e) => {
  if (e.target.checked) {
    startAutoRefresh();
    toast("已开启 15 秒自动刷新", "ok");
  } else {
    stopAutoRefresh();
    toast("已关闭自动刷新");
  }
});

document.getElementById("reloadLogs").addEventListener("click", () =>
  loadLogs().catch((e) => toast(e.message, "bad"))
);
document.getElementById("reloadErrors").addEventListener("click", () =>
  loadErrors().catch((e) => toast(e.message, "bad"))
);
document.getElementById("logFilter").addEventListener("input", renderLogs);
document.getElementById("logStatus").addEventListener("change", renderLogs);
document.getElementById("errFilter").addEventListener("input", renderErrors);

document.getElementById("clearLogs").addEventListener("click", async () => {
  if (!confirm("确认清空请求与错误日志？")) return;
  try {
    await api("/api/admin/logs/clear", { method: "POST" });
    await loadLogs();
    await loadErrors();
    toast("日志已清空", "ok");
  } catch (e) {
    toast(e.message, "bad");
  }
});

document.getElementById("saveSettings").addEventListener("click", () =>
  saveSettingsForm().catch(() => {})
);
document.getElementById("saveSecrets").addEventListener("click", () => saveSecrets());
document.getElementById("saveProxies").addEventListener("click", () => saveProxies());
document.getElementById("refreshEgressIp").addEventListener("click", () => loadEgressIp());
document.getElementById("copyEgressIp").addEventListener("click", () => copyEgressIp());

document.getElementById("clearChatKey").addEventListener("click", async () => {
  if (!confirm("清除后台保存的呆呆 AI 密钥？")) return;
  try {
    await api("/api/admin/secrets", {
      method: "PUT",
      body: JSON.stringify({ clearChat: true }),
    });
    toast("对话密钥已清除", "ok");
    await loadSecretsForm();
    await loadOverview();
  } catch (e) {
    toast(e.message, "bad");
  }
});
document.getElementById("clearImageKey").addEventListener("click", async () => {
  if (!confirm("清除后台保存的呆呆 Image 密钥？")) return;
  try {
    await api("/api/admin/secrets", {
      method: "PUT",
      body: JSON.stringify({ clearImage: true }),
    });
    toast("生图密钥已清除", "ok");
    await loadSecretsForm();
    await loadOverview();
  } catch (e) {
    toast(e.message, "bad");
  }
});

document.getElementById("copyApiBase").addEventListener("click", async () => {
  const v = document.getElementById("setApiBase").value.trim();
  if (!v) {
    toast("域名是空的", "bad");
    return;
  }
  try {
    await navigator.clipboard.writeText(v);
    toast("已复制对接域名", "ok");
  } catch (_) {
    toast(v);
  }
});

document.getElementById("quickMaintenance").addEventListener("change", (e) =>
  quickPatch("maintenance", e.target.checked)
);
document.getElementById("quickBlockChat").addEventListener("change", (e) =>
  quickPatch("blockChat", e.target.checked)
);
document.getElementById("quickBlockImage").addEventListener("change", (e) =>
  quickPatch("blockImage", e.target.checked)
);

document.getElementById("gotoOps").addEventListener("click", () => switchTab("ops"));
document.getElementById("gotoProbe").addEventListener("click", () => switchTab("probe"));
document.getElementById("gotoErrors").addEventListener("click", () => switchTab("errors"));
document.getElementById("probeAllBtn").addEventListener("click", () => {
  switchTab("probe");
  probeAll();
});
document.getElementById("probeAllBtn2").addEventListener("click", () => probeAll());

document.querySelectorAll("[data-probe]").forEach((btn) => {
  btn.addEventListener("click", () => runProbe(btn.dataset.probe));
});

document.querySelectorAll(".nav").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

const usersSearchBtn = document.getElementById("usersSearchBtn");
const usersRefreshBtn = document.getElementById("usersRefreshBtn");
const usersQuery = document.getElementById("usersQuery");
if (usersSearchBtn) usersSearchBtn.addEventListener("click", () => loadUsers().catch((e) => toast(e.message, "bad")));
if (usersRefreshBtn) usersRefreshBtn.addEventListener("click", () => loadUsers().catch((e) => toast(e.message, "bad")));
if (usersQuery) {
  usersQuery.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadUsers().catch((err) => toast(err.message, "bad"));
  });
}

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
