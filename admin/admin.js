const TOKEN_KEY = "daidai_admin_token";

const TITLES = {
  overview: ["总览", "调用量 · 走势 · 系统"],
  logs: ["请求日志", "最近 API 访问"],
  errors: ["错误日志", "失败与异常"],
  services: ["服务配置", "能力与环境变量"],
  settings: ["运行管控", "维护 · 限流 · 公告"],
  probe: ["连通探测", "自检上游与登录配置"],
  routes: ["接口清单", "当前服务暴露的接口"],
  guide: ["部署清单", "上线检查项"],
};

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {}
  );
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken("");
    showLogin();
    throw new Error(data.error?.message || "未登录");
  }
  if (!res.ok) throw new Error(data.error?.message || data.error || "请求失败");
  return data;
}

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
}
function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}小时 ${m}分`;
}
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  if (name === "logs") loadLogs();
  if (name === "errors") loadErrors();
  if (name === "routes") loadRoutes();
  if (name === "settings") loadSettingsForm();
  if (name === "services" || name === "overview") loadOverview();
}

async function loadOverview() {
  const data = await api("/api/admin/overview");
  const s = data.stats || {};
  const cards = [
    ["对话成功", s.chat ?? 0],
    ["生图成功", s.image ?? 0],
    ["改图成功", s.imageEdit ?? 0],
    ["登录次数", s.login ?? 0],
    ["对话失败", s.chatFail ?? 0],
    ["生图失败", s.imageFail ?? 0],
    ["改图失败", s.imageEditFail ?? 0],
    ["运行时长", fmtUptime(data.uptimeSec)],
  ];
  document.getElementById("statCards").innerHTML = cards
    .map(
      ([k, v]) =>
        `<div class="card"><div class="card-k">${k}</div><div class="card-v">${v}</div></div>`
    )
    .join("");

  const hourly = data.hourly || [];
  const max = Math.max(1, ...hourly.map((h) => h.req || 0));
  document.getElementById("hourlyBars").innerHTML = hourly
    .map((h) => {
      const pct = Math.round(((h.req || 0) / max) * 100);
      return `<div class="bar-col" title="${h.label} 共 ${h.req} 次"><div class="bar" style="height:${pct}%"></div><div class="bar-lab">${h.label.replace(
        ":00",
        ""
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
  const maint = data.settings?.maintenance;
  badge.textContent = maint ? "维护中" : data.ok ? "服务正常" : "异常";
  badge.className = "badge " + (maint ? "warn" : data.ok ? "ok" : "bad");

  const ann = data.settings?.announce || "";
  document.getElementById("announceNote").innerHTML = ann
    ? `<p><b>当前公告：</b>${esc(ann)}</p>`
    : `<p>对外产品名：<b>呆呆 AI</b>。小程序记录在用户本地；本后台看服务端状态与调用。</p>`;

  const rows = [
    ["对话", data.chatConfigured, `模型 ${data.models?.chat || "—"}`],
    ["生图/改图", data.imageConfigured, `模型 ${data.models?.image || "—"}`],
    ["小程序微信登录", data.wechatLoginConfigured, "WECHAT_APPID + SECRET"],
    ["网页站长通行", data.webPasswordConfigured, "WEB/ADMIN_PASSWORD"],
    ["管理后台", data.adminConfigured, "ADMIN_PASSWORD"],
    ["开发假登录", data.allowDevLogin, "ALLOW_DEV_LOGIN=1 时开启"],
  ];
  document.getElementById("svcBody").innerHTML = rows
    .map(([name, ok, tip]) => {
      const pill = ok
        ? '<span class="pill ok">已就绪</span>'
        : '<span class="pill warn">未配置/关闭</span>';
      return `<tr><td>${name}</td><td>${pill}</td><td>${esc(tip)}</td></tr>`;
    })
    .join("");

  try {
    const cfg = await api("/api/admin/config");
    const env = cfg.env || {};
    const masked = cfg.masked || {};
    document.getElementById("envInfo").innerHTML = Object.keys(env)
      .map((k) => {
        const v = env[k];
        let show = typeof v === "boolean" ? (v ? "已配置" : "未配置") : String(v);
        if (masked[k]) show = `${show} · ${masked[k]}`;
        return `<div><span>${esc(k)}</span><span>${esc(show)}</span></div>`;
      })
      .join("");
  } catch (_) {
    /* ignore */
  }
}

async function loadLogs() {
  const data = await api("/api/admin/logs?limit=120");
  const rows = data.logs || [];
  document.getElementById("logsBody").innerHTML = rows.length
    ? rows
        .map((r) => {
          const st =
            r.status >= 500
              ? "bad"
              : r.status >= 400
              ? "warn"
              : "ok";
          return `<tr>
            <td>${fmtTime(r.at)}</td>
            <td>${esc(r.method)}</td>
            <td>${esc(r.path)}</td>
            <td><span class="pill ${st}">${r.status}</span></td>
            <td>${r.ms}ms</td>
            <td>${esc(r.ip)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">暂无请求日志</td></tr>`;
}

async function loadErrors() {
  const data = await api("/api/admin/errors?limit=80");
  const rows = data.errors || [];
  document.getElementById("errorsBody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td>${fmtTime(r.at)}</td>
        <td>${esc(r.source)}</td>
        <td>${r.status || "—"}</td>
        <td title="${esc(r.message)}">${esc(String(r.message || "").slice(0, 120))}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4">暂无错误</td></tr>`;
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
  document.getElementById("setMaintMsg").value = s.maintenanceMessage || "";
  document.getElementById("setBlockChat").checked = !!s.blockChat;
  document.getElementById("setBlockImage").checked = !!s.blockImage;
  document.getElementById("setRate").value = s.rateLimitPerMin || 120;
  document.getElementById("setAnnounce").value = s.announce || "";
  document.getElementById("setNotes").value = s.notes || "";
  document.getElementById("settingsTip").textContent = "";
}

async function saveSettings() {
  const tip = document.getElementById("settingsTip");
  tip.textContent = "保存中…";
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        maintenance: document.getElementById("setMaintenance").checked,
        maintenanceMessage: document.getElementById("setMaintMsg").value,
        blockChat: document.getElementById("setBlockChat").checked,
        blockImage: document.getElementById("setBlockImage").checked,
        rateLimitPerMin: Number(document.getElementById("setRate").value || 120),
        announce: document.getElementById("setAnnounce").value,
        notes: document.getElementById("setNotes").value,
      }),
    });
    tip.textContent = "已保存";
    await loadOverview();
  } catch (e) {
    tip.textContent = e.message || "保存失败";
  }
}

async function runProbe(kind) {
  const map = { chat: "probeChat", image: "probeImage", wechat: "probeWechat" };
  const el = document.getElementById(map[kind]);
  el.textContent = "探测中…";
  try {
    const data = await api("/api/admin/probe", {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
    el.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el.textContent = e.message || "探测失败";
  }
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
});

document.getElementById("reloadLogs").addEventListener("click", () => loadLogs().catch(alert));
document.getElementById("reloadErrors").addEventListener("click", () => loadErrors().catch(alert));
document.getElementById("clearLogs").addEventListener("click", async () => {
  if (!confirm("确认清空请求与错误日志？")) return;
  await api("/api/admin/logs/clear", { method: "POST" });
  await loadLogs();
  await loadErrors();
});
document.getElementById("saveSettings").addEventListener("click", () => saveSettings());
document.querySelectorAll("[data-probe]").forEach((btn) => {
  btn.addEventListener("click", () => runProbe(btn.dataset.probe));
});

document.querySelectorAll(".nav").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
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
