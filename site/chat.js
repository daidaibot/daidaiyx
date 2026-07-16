(function () {
  const SKILLS = [
    { id: "image", name: "生图", emoji: "🎨", bg: "rgba(168,85,247,0.12)", placeholder: "描述你想生成的图片…" },
    { id: "edit", name: "改图", emoji: "🖌️", bg: "rgba(236,72,153,0.12)", placeholder: "先上传图片，再说怎么改…" },
    { id: "write", name: "帮我写作", emoji: "✍️", bg: "rgba(59,130,246,0.12)", placeholder: "想写什么？或贴上原文让我改…" },
    { id: "translate", name: "翻译", emoji: "🌐", bg: "rgba(16,185,129,0.12)", placeholder: "输入要翻译的内容…" },
    { id: "code", name: "编程", emoji: "💻", bg: "rgba(245,158,11,0.12)", placeholder: "描述编程问题或贴代码…" },
    { id: "summary", name: "总结", emoji: "📝", bg: "rgba(14,165,233,0.12)", placeholder: "粘贴要总结的内容…" },
  ];

  const BUILTIN_MASKS = [
    { id: "coder", name: "程序员", emoji: "👨‍💻", desc: "写代码、排错、讲原理", prompt: "你是呆呆 AI 里的资深编程面具。回答简洁准确，优先给出可运行代码。对外只称呆呆 AI。" },
    { id: "writer", name: "文案高手", emoji: "✍️", desc: "标题、推文、润色", prompt: "你是呆呆 AI 里的文案面具。输出可直接发布的文案。对外只称呆呆 AI。" },
    { id: "teacher", name: "耐心老师", emoji: "📚", desc: "讲题、拆知识点", prompt: "你是呆呆 AI 里的耐心老师面具。用浅显语言讲解。对外只称呆呆 AI。" },
    { id: "en", name: "英语陪练", emoji: "🗣️", desc: "口语、改正、示范", prompt: "You are 呆呆 AI English partner. Reply mainly in English. Call yourself 呆呆 AI only." },
    { id: "xhs", name: "小红书达人", emoji: "📕", desc: "种草笔记语气", prompt: "你是呆呆 AI 小红书文案面具：口语化、短句、适当 emoji。对外只称呆呆 AI。" },
    { id: "pm", name: "产品经理", emoji: "🧭", desc: "需求、方案、PRD", prompt: "你是呆呆 AI 产品经理面具。拆目标与优先级。对外只称呆呆 AI。" },
    { id: "travel", name: "旅行顾问", emoji: "✈️", desc: "行程、预算、避坑", prompt: "你是呆呆 AI 旅行顾问面具。给出可执行行程。对外只称呆呆 AI。" },
    { id: "listener", name: "倾听树洞", emoji: "🌙", desc: "温和陪伴，不说教", prompt: "你是呆呆 AI 倾听面具。温和陪伴，不说教。对外只称呆呆 AI。" },
  ];

  const USER_KEY = "daidai_web_user";
  const MASK_KEY = "daidai_web_masks";
  const HIST_KEY = "daidai_web_hist";
  const SESS_PREFIX = "daidai_web_sess_";

  const $ = (id) => document.getElementById(id);
  const state = {
    messages: [],
    activeSkill: "",
    activeMask: "",
    imageSize: "1024x1024",
    editImage: "",
    busy: false,
    sessionId: uid(),
  };

  function uid() {
    return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setUser(u) {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  }

  function loggedIn() {
    const u = getUser();
    return Boolean(u && u.openid && (u.token || u.openid));
  }

  function customMasks() {
    try {
      return JSON.parse(localStorage.getItem(MASK_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveCustomMasks(list) {
    localStorage.setItem(MASK_KEY, JSON.stringify(list));
  }

  function allMasks() {
    return customMasks().concat(BUILTIN_MASKS);
  }

  function findMask(id) {
    return allMasks().find((m) => m.id === id);
  }

  function skillById(id) {
    return SKILLS.find((s) => s.id === id);
  }

  function requireLogin(action) {
    if (loggedIn()) return true;
    openLogin();
    return false;
  }

  function systemPrompt(skill, mask) {
    const brand =
      "你是「呆呆 AI」，由呆呆网络提供。对外只称呼自己为呆呆 AI，不要提及任何底层模型、厂商或 API 名称。" +
      "不要说自己无法生成图片，也不要推荐其他绘画工具；需要出图时系统会走生图能力。";
    if (mask && mask.prompt) return `${brand}\n当前角色面具要求：\n${mask.prompt}`;
    if (skill === "write") return `${brand}\n你擅长写作、文案与润色。`;
    if (skill === "translate") return `${brand}\n你擅长中英互译，译文自然流畅。`;
    if (skill === "code") return `${brand}\n你擅长编程：给出可运行代码并简要说明。`;
    if (skill === "summary") return `${brand}\n你擅长总结提炼要点。`;
    return `${brand}\n请简洁友好、乐于助人。`;
  }

  function looksLikeImageRequest(text) {
    const s = String(text || "").trim();
    if (!s) return false;
    if (/^🎨/.test(s)) return true;
    return /生图|画一张|画个|帮我画|画张|生成.*(图|海报|封面|插画|壁纸|logo|图标)|做[一张个]?(广告图|海报|封面|插画|壁纸|宣传图|图)|出一张图|文生图|广告图|宣传图|海报设计|封面图/i.test(
      s
    );
  }

  function stripImageCue(text) {
    return String(text || "")
      .replace(/^🎨\s*/, "")
      .trim();
  }

  function friendlyError(msg) {
    const s = String(msg || "");
    if (/api.?key|OPENAI|DeepSeek|deepseek|gpt-?image|openai|unauthorized|401|403|503|未配置|未就绪/i.test(s)) {
      return "呆呆 AI 暂时不可用，请稍后再试";
    }
    if (/timeout|超时|fail|network|ERR_/i.test(s)) return "网络不太稳定，请稍后再试";
    if (!s) return "";
    return s.replace(/DeepSeek|OpenAI|GPT[\s-]?Image|gpt-image-\d+|Claude/gi, "呆呆 AI").slice(0, 120);
  }

  async function reportClientError(payload) {
    try {
      await fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
    } catch {
      /* ignore */
    }
  }

  function demoReply(q, skill, mask) {
    if (mask) return `【${mask.name}】你好，我是呆呆 AI。\n\n收到：${(q || "").slice(0, 60)}\n\n配置服务后会按这个面具和你聊。`;
    if (skill === "translate") return `呆呆 AI 翻译参考：\n\n${q}\n\n（本地预览）`;
    if (skill === "write") return "好的，这是呆呆 AI 帮你起的一版文案草稿（本地预览）。";
    if (skill === "summary") return "呆呆 AI 三点摘要：\n1. 重点已对齐\n2. 风险需确认\n3. 下一步给出方案";
    if (skill === "code") return "好的，这是呆呆 AI 写的示例：\n\nfunction hello() {\n  return '呆呆 AI';\n}";
    return `我是呆呆 AI。收到：${(q || "").slice(0, 80)}\n\n连上云托管服务后即可真实对话。`;
  }

  function updateChrome() {
    const skill = skillById(state.activeSkill);
    const mask = findMask(state.activeMask);
    $("navSub").textContent = mask ? mask.name : skill ? skill.name : "";
    $("guestTip").classList.toggle("hidden", loggedIn());
    $("imgBar").classList.toggle("hidden", !["image", "edit"].includes(state.activeSkill));
    $("composer").classList.toggle("edit-mode", state.activeSkill === "edit");
    $("editExit").classList.toggle("hidden", state.activeSkill !== "edit");

    const plus = $("plusBtn");
    if (state.activeSkill === "edit") {
      plus.className = "plus upload" + (state.editImage ? " has-img" : "");
      plus.innerHTML = state.editImage
        ? `<img class="plus-thumb" src="${state.editImage}" alt="" />`
        : "⬆";
    } else {
      plus.className = "plus";
      plus.textContent = "＋";
    }

    const hasSkill = state.activeSkill && state.activeSkill !== "edit";
    const hasMask = Boolean(state.activeMask);
    $("tagRow").classList.toggle("hidden", !hasSkill && !hasMask && state.activeSkill !== "edit");
    if (hasSkill) {
      $("skillTag").classList.remove("hidden");
      $("skillTag").querySelector("span").textContent = skill.name;
    } else {
      $("skillTag").classList.add("hidden");
    }
    if (hasMask) {
      $("maskTag").classList.remove("hidden");
      $("maskTag").querySelector("span").textContent = `${mask.emoji} ${mask.name}`;
    } else {
      $("maskTag").classList.add("hidden");
    }

    $("input").placeholder = skill ? skill.placeholder : "发消息或输入…";
    $("sendBtn").textContent =
      state.activeSkill === "image" ? "生成" : state.activeSkill === "edit" ? "改图" : "发送";

    const can =
      !state.busy &&
      ($("input").value.trim().length > 0 || (state.activeSkill === "edit" && state.editImage));
    $("sendBtn").classList.toggle("on", can);

    const user = getUser();
    const du = $("drawerUser");
    if (user) {
      du.innerHTML = `<div class="drawer-avatar">${(user.nickName || "呆")[0]}</div><div><div class="drawer-name">${escapeHtml(
        user.nickName || "用户"
      )}</div><div class="drawer-desc">站长已登录</div></div>`;
      $("drawerAuth").textContent = "退出登录";
    } else {
      du.innerHTML =
        '<div class="drawer-avatar">游</div><div><div class="drawer-name">游客</div><div class="drawer-desc">网页仅本人 · 用户请用小程序</div></div>';
      $("drawerAuth").textContent = "站长登录";
    }
    renderHistory();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSkills() {
    $("skillGrid").innerHTML = SKILLS.map(
      (s) =>
        `<button type="button" class="skill-chip ${state.activeSkill === s.id ? "on" : ""}" data-skill="${s.id}">
          <span class="skill-chip-emoji">${s.emoji}</span>
          <span class="skill-chip-name">${s.name}</span>
        </button>`
    ).join("");
  }

  function renderMaskRow() {
    const preview = allMasks().slice(0, 6);
    $("maskRow").innerHTML =
      `<button type="button" class="mask-card create" id="maskCreateCard"><div class="mask-emoji">＋</div><div class="mask-name">创建面具</div></button>` +
      preview
        .map(
          (m) =>
            `<button type="button" class="mask-card ${state.activeMask === m.id ? "on" : ""}" data-mask="${m.id}">
              <div class="mask-emoji">${m.emoji}</div>
              <div class="mask-name">${escapeHtml(m.name)}</div>
              <div class="mask-desc">${escapeHtml(m.desc || "")}</div>
            </button>`
        )
        .join("");
    $("maskCreateCard").onclick = () => {
      if (!requireLogin()) return;
      openCreateMask();
    };
  }

  function renderSheet() {
    $("sheetGrid").innerHTML =
      `<button type="button" class="sheet-item" data-sheet="masks"><div class="sheet-ico" style="background:rgba(236,72,153,0.12)">🎭</div><span class="sheet-name">角色面具</span></button>` +
      `<button type="button" class="sheet-item" data-sheet="edit"><div class="sheet-ico" style="background:rgba(244,63,94,0.12)">📷</div><span class="sheet-name">上传改图</span></button>` +
      SKILLS.map(
        (s) =>
          `<button type="button" class="sheet-item" data-skill="${s.id}"><div class="sheet-ico" style="background:${s.bg}">${s.emoji}</div><span class="sheet-name">${s.name}</span></button>`
      ).join("");
  }

  function renderMaskPanel() {
    const custom = customMasks();
    const body = $("maskPanelBody");
    let html = "";
    if (custom.length) {
      html += '<div class="panel-sec">我的面具</div><div class="panel-grid">';
      html += custom
        .map(
          (m) =>
            `<button type="button" class="mask-card ${state.activeMask === m.id ? "on" : ""}" data-mask="${m.id}">
              <div class="mask-emoji">${m.emoji}</div>
              <div class="mask-name">${escapeHtml(m.name)}</div>
              <div class="mask-desc">${escapeHtml(m.desc || "自定义")}</div>
            </button>`
        )
        .join("");
      html += "</div>";
    }
    html += '<div class="panel-sec">推荐面具</div><div class="panel-grid">';
    html += BUILTIN_MASKS.map(
      (m) =>
        `<button type="button" class="mask-card ${state.activeMask === m.id ? "on" : ""}" data-mask="${m.id}">
          <div class="mask-emoji">${m.emoji}</div>
          <div class="mask-name">${escapeHtml(m.name)}</div>
          <div class="mask-desc">${escapeHtml(m.desc || "")}</div>
        </button>`
    ).join("");
    html += "</div>";
    body.innerHTML = html;
  }

  function imageBlock(src) {
    const u = escapeHtml(src || "");
    if (!u) return "";
    // 水印烙在 JPEG 内，UI 只保留对齐的操作条
    return `<div class="bubble-img-card">
      <img class="bubble-img" src="${u}" alt="" data-img="${u}" />
      <div class="img-actions">
        <button type="button" class="img-act" data-preview-img="${u}">查看</button>
        <button type="button" class="img-act primary" data-download-img="${u}">下载</button>
      </div>
    </div>`;
  }

  async function downloadImageFile(src) {
    const url = String(src || "").trim();
    if (!url) return;
    try {
      const join = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${join}download=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = "daidai-ai.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  }

  function openImageLightbox(src) {
    const url = String(src || "").trim();
    if (!url) return;
    const box = $("imgLightbox");
    const img = $("imgLbImg");
    const open = $("imgLbOpen");
    const dl = $("imgLbDl");
    if (!box || !img) return;
    img.src = url;
    if (open) open.href = url;
    if (dl) {
      dl.href = "#";
      dl.onclick = (ev) => {
        ev.preventDefault();
        downloadImageFile(url);
      };
    }
    box.classList.remove("hidden");
  }

  function closeImageLightbox() {
    const box = $("imgLightbox");
    if (box) box.classList.add("hidden");
  }

  function renderMessages() {
    $("welcome").classList.toggle("hidden", state.messages.length > 0);
    $("msgList").innerHTML = state.messages
      .map((m) => {
        if (m.role === "user") {
          return `<div class="row mine"><div class="bubble-wrap"><div class="bubble user">${escapeHtml(
            m.content || ""
          )}${m.image ? imageBlock(m.image) : ""}</div></div></div>`;
        }
        const emoji = (findMask(state.activeMask) || {}).emoji || "呆";
        return `<div class="row ai"><div class="avatar">${emoji.length <= 2 ? emoji : "呆"}</div><div class="bubble-wrap"><div class="bubble ai">${
          m.loading
            ? '<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>'
            : escapeHtml(m.content || "")
        }${m.image ? imageBlock(m.image) : ""}</div></div></div>`;
      })
      .join("");
    $("bottom").scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function loadHistIndex() {
    try {
      return JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveCurrentSession() {
    if (!state.messages.length) return;
    const title =
      (state.messages.find((m) => m.role === "user" && m.content) || {}).content?.slice(0, 24) ||
      "新对话";
    const body = { id: state.sessionId, title, messages: state.messages, updatedAt: Date.now() };
    localStorage.setItem(SESS_PREFIX + state.sessionId, JSON.stringify(body));
    let idx = loadHistIndex().filter((x) => x.id !== state.sessionId);
    idx.unshift({ id: state.sessionId, title, updatedAt: body.updatedAt });
    idx = idx.slice(0, 30);
    localStorage.setItem(HIST_KEY, JSON.stringify(idx));
  }

  function renderHistory() {
    const idx = loadHistIndex();
    $("histList").innerHTML = idx.length
      ? idx
          .map(
            (h) =>
              `<button type="button" class="hist-item" data-sid="${h.id}"><span>${escapeHtml(
                h.title || "对话"
              )}</span><span class="hist-del" data-del="${h.id}">删</span></button>`
          )
          .join("")
      : '<div class="drawer-desc" style="padding:8px">暂无历史</div>';
  }

  function openSession(id) {
    try {
      const body = JSON.parse(localStorage.getItem(SESS_PREFIX + id) || "null");
      if (!body) return;
      state.sessionId = id;
      state.messages = body.messages || [];
      state.activeSkill = "";
      state.activeMask = "";
      renderMessages();
      updateChrome();
      closeDrawer();
    } catch {
      /* ignore */
    }
  }

  function newChat() {
    saveCurrentSession();
    state.sessionId = uid();
    state.messages = [];
    state.activeSkill = "";
    state.activeMask = "";
    state.editImage = "";
    renderSkills();
    renderMaskRow();
    renderMessages();
    updateChrome();
  }

  function setSkill(id) {
    if (!requireLogin()) return;
    state.activeSkill = id;
    if (id !== "edit") state.editImage = "";
    renderSkills();
    updateChrome();
    closeSheet();
  }

  function setMask(id) {
    if (!requireLogin()) return;
    state.activeMask = id;
    const m = findMask(id);
    if (m) {
      $("welcomeEmoji").textContent = m.emoji || "呆";
      $("welcomeHi").textContent = m.name;
      $("welcomeSub").textContent = m.desc || "角色面具";
    }
    renderMaskRow();
    renderMaskPanel();
    updateChrome();
    closeMaskPanel();
  }

  function openDrawer() {
    $("drawerMask").classList.remove("hidden");
    $("drawer").classList.add("show");
    updateChrome();
  }
  function closeDrawer() {
    $("drawerMask").classList.add("hidden");
    $("drawer").classList.remove("show");
  }
  function openSheet() {
    $("sheetMask").classList.remove("hidden");
    $("sheet").classList.add("show");
  }
  function closeSheet() {
    $("sheetMask").classList.add("hidden");
    $("sheet").classList.remove("show");
  }
  function openMaskPanel() {
    renderMaskPanel();
    $("maskPanelMask").classList.remove("hidden");
    $("maskPanel").classList.add("show");
    closeSheet();
  }
  function closeMaskPanel() {
    $("maskPanelMask").classList.add("hidden");
    $("maskPanel").classList.remove("show");
  }
  function openLogin() {
    $("loginMask").classList.remove("hidden");
  }
  function closeLogin() {
    $("loginMask").classList.add("hidden");
  }
  function openCreateMask() {
    $("createMask").classList.remove("hidden");
  }
  function closeCreateMask() {
    $("createMask").classList.add("hidden");
  }

  async function send() {
    if (state.busy) return;
    if (!requireLogin()) return;
    const text = $("input").value.trim();
    if (state.activeSkill === "image") {
      if (!text) return;
      return sendImage(stripImageCue(text));
    }
    if (state.activeSkill === "edit") {
      if (!state.editImage) {
        $("editFile").click();
        return;
      }
      if (!text) return;
      return sendEdit(text);
    }
    if (!text) return;
    if (looksLikeImageRequest(text)) {
      state.activeSkill = "image";
      updateChrome();
      return sendImage(stripImageCue(text));
    }
    return sendChat(text);
  }

  function pushPair(userMsg, aiMsg) {
    state.messages.push(userMsg, aiMsg);
    $("input").value = "";
    state.busy = true;
    renderMessages();
    updateChrome();
  }

  function updateMsg(id, patch) {
    const m = state.messages.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    renderMessages();
  }

  async function sendChat(text) {
    const skill = state.activeSkill;
    const mask = findMask(state.activeMask);
    const history = state.messages
      .filter((m) => m.content && !m.loading)
      .slice(-12)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
    const userMsg = { id: uid(), role: "user", content: text };
    const aiId = uid();
    pushPair(userMsg, { id: aiId, role: "ai", content: "", loading: true });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: false,
          messages: [
            { role: "system", content: systemPrompt(skill, mask) },
            ...history,
            { role: "user", content: text },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const content =
        data?.choices?.[0]?.message?.content ||
        (data?.error?.message ? friendlyError(data.error.message) : demoReply(text, skill, mask));
      typeOut(aiId, content);
    } catch {
      typeOut(aiId, demoReply(text, skill, mask));
    }
  }

  function typeOut(aiId, full) {
    let i = 0;
    updateMsg(aiId, { loading: false, content: "" });
    const timer = setInterval(() => {
      i += 3;
      const done = i >= full.length;
      updateMsg(aiId, { content: full.slice(0, i), loading: false });
      if (done) {
        clearInterval(timer);
        state.busy = false;
        updateChrome();
        saveCurrentSession();
      }
    }, 16);
  }

  async function pollImageJob(jobId, onTick) {
    const started = Date.now();
    const maxMs = 240000;
    let first = true;
    while (Date.now() - started < maxMs) {
      if (!first) await new Promise((r) => setTimeout(r, 2000));
      first = false;
      const res = await fetch(`/api/image/job/${encodeURIComponent(jobId)}`);
      const data = await res.json().catch(() => ({}));
      const job = data.job || {};
      if (typeof onTick === "function") onTick(job);
      if ((job.status === "done" || job.status === "completed") && job.image) {
        return job;
      }
      if (job.status === "error" || job.status === "failed") {
        const err = new Error(job.error || "生图失败");
        err.job = job;
        throw err;
      }
    }
    throw new Error("生图等待超时，请稍后在后台错误日志确认是否已完成");
  }

  async function sendImage(prompt) {
    const userMsg = { id: uid(), role: "user", content: `🎨 ${prompt}` };
    const aiId = uid();
    pushPair(userMsg, { id: aiId, role: "ai", content: "呆呆 AI 正在生成图片…", loading: true });
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: state.imageSize }),
      });
      const data = await res.json().catch(() => ({}));
      const jobId = data.jobId || data.job_id || data.id;
      if (data.image) {
        updateMsg(aiId, { loading: false, content: "", image: data.image });
      } else if (data.pending || jobId) {
        if (!jobId) {
          throw new Error("生图任务已受理但未返回 jobId，请重新部署后端");
        }
        updateMsg(aiId, { loading: true, content: "呆呆 AI 作图中，请稍候…" });
        const job = await pollImageJob(jobId, () => {
          updateMsg(aiId, { loading: true, content: "呆呆 AI 作图中，请稍候…" });
        });
        updateMsg(aiId, { loading: false, content: "", image: job.image });
      } else {
        const rawMsg = data?.error?.message || "";
        const errId = data?.error?.id || "";
        const shown = [
          friendlyError(rawMsg) ||
            rawMsg ||
            (res.status === 200
              ? "生图接口返回异常（HTTP 200 但无图片）。请强制刷新页面（Ctrl+F5）后再试"
              : `生图失败（HTTP ${res.status || "?"}）`),
          errId ? `错误编号：${errId}` : "",
          "请到管理后台 → 错误日志 查看明细",
        ]
          .filter(Boolean)
          .join("\n");
        reportClientError({
          source: "web-image",
          message: rawMsg || shown,
          status: res.status,
          path: "/api/image",
          detail: `prompt=${prompt.slice(0, 100)};keys=${Object.keys(data || {}).join(",")};id=${errId}`,
        });
        updateMsg(aiId, { loading: false, content: shown });
      }
    } catch (e) {
      const tip = e && e.message ? e.message : "无法连接生图服务";
      reportClientError({
        source: "web-image",
        message: tip,
        status: (e && e.job && "job-error") || "network",
        path: "/api/image",
        detail: `prompt=${prompt.slice(0, 100)}`,
      });
      updateMsg(aiId, { loading: false, content: tip });
    }
    state.busy = false;
    updateChrome();
    saveCurrentSession();
  }

  async function sendEdit(prompt) {
    const userMsg = {
      id: uid(),
      role: "user",
      content: `🖌️ ${prompt}`,
      image: state.editImage,
    };
    const aiId = uid();
    pushPair(userMsg, { id: aiId, role: "ai", content: "呆呆 AI 正在改图…", loading: true });
    try {
      const res = await fetch("/api/image/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_b64: state.editImage,
          size: state.imageSize,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.image) {
        updateMsg(aiId, { loading: false, content: "", image: data.image });
      } else if (data.pending && (data.jobId || data.id)) {
        updateMsg(aiId, { loading: true, content: "呆呆 AI 改图中，请稍候…" });
        const job = await pollImageJob(data.jobId || data.id, () => {
          updateMsg(aiId, { loading: true, content: "呆呆 AI 改图中，请稍候…" });
        });
        updateMsg(aiId, { loading: false, content: "", image: job.image });
      } else {
        const tip = friendlyError(data?.error?.message) || "改图失败，请稍后再试";
        reportClientError({
          source: "web-image-edit",
          message: data?.error?.message || tip,
          status: res.status,
          path: "/api/image/edit",
          detail: `prompt=${prompt.slice(0, 60)}`,
        });
        updateMsg(aiId, { loading: false, content: tip });
      }
    } catch (e) {
      updateMsg(aiId, {
        loading: false,
        content: (e && e.message) || "网络不太稳定，请稍后再试",
      });
    }
    state.busy = false;
    updateChrome();
    saveCurrentSession();
  }

  // events
  $("openDrawer").onclick = openDrawer;
  $("drawerMask").onclick = closeDrawer;
  $("drawerHome").onclick = () => {
    saveCurrentSession();
    location.href = "./";
  };
  $("drawerNew").onclick = () => {
    newChat();
    closeDrawer();
  };
  $("newChat").onclick = () => {
    if (!requireLogin()) return;
    newChat();
  };
  $("drawerAuth").onclick = () => {
    if (loggedIn()) {
      setUser(null);
      updateChrome();
      closeDrawer();
    } else {
      closeDrawer();
      openLogin();
    }
  };

  $("guestTip").onclick = openLogin;
  $("loginCancel").onclick = closeLogin;
  $("loginBtn").onclick = async () => {
    const err = $("loginErr");
    err.textContent = "";
    const password = ($("pwdInput").value || "").trim();
    if (!password) {
      err.textContent = "请输入密码";
      return;
    }
    try {
      const res = await fetch("/api/auth/web-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        err.textContent = data.error?.message || "登录失败";
        return;
      }
      setUser({
        openid: data.openid,
        token: data.token,
        nickName: data.nickName || "站长",
        avatarUrl: data.avatarUrl || "",
      });
      $("pwdInput").value = "";
      closeLogin();
      updateChrome();
    } catch {
      err.textContent = "网络错误，请稍后再试";
    }
  };

  $("plusBtn").onclick = () => {
    if (state.activeSkill === "edit") {
      if (!requireLogin()) return;
      $("editFile").click();
      return;
    }
    if (!requireLogin()) return;
    openSheet();
  };
  $("sheetMask").onclick = closeSheet;
  $("maskPanelMask").onclick = closeMaskPanel;
  $("openMasks").onclick = () => {
    if (!requireLogin()) return;
    openMaskPanel();
  };
  $("createMaskBtn").onclick = () => {
    if (!requireLogin()) return;
    openCreateMask();
  };
  $("editExit").onclick = () => {
    state.activeSkill = "";
    state.editImage = "";
    renderSkills();
    updateChrome();
  };
  $("skillTag").onclick = () => {
    state.activeSkill = "";
    renderSkills();
    updateChrome();
  };
  $("maskTag").onclick = () => {
    state.activeMask = "";
    $("welcomeEmoji").textContent = "呆";
    $("welcomeHi").textContent = "你好，我是呆呆 AI";
    $("welcomeSub").textContent = "聊聊想法，或点下面的能力开始";
    renderMaskRow();
    updateChrome();
  };

  $("editFile").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.editImage = String(reader.result || "");
      state.activeSkill = "edit";
      renderSkills();
      updateChrome();
    };
    reader.readAsDataURL(file);
  };

  $("skillGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-skill]");
    if (!btn) return;
    setSkill(btn.getAttribute("data-skill"));
  });
  $("maskRow").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mask]");
    if (!btn) return;
    setMask(btn.getAttribute("data-mask"));
  });
  $("sheetGrid").addEventListener("click", (e) => {
    const item = e.target.closest(".sheet-item");
    if (!item) return;
    if (item.dataset.sheet === "masks") return openMaskPanel();
    if (item.dataset.sheet === "edit") {
      state.activeSkill = "edit";
      renderSkills();
      updateChrome();
      closeSheet();
      $("editFile").click();
      return;
    }
    if (item.dataset.skill) setSkill(item.dataset.skill);
  });
  $("maskPanelBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mask]");
    if (!btn) return;
    setMask(btn.getAttribute("data-mask"));
  });
  $("histList").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = del.getAttribute("data-del");
      localStorage.removeItem(SESS_PREFIX + id);
      localStorage.setItem(
        HIST_KEY,
        JSON.stringify(loadHistIndex().filter((x) => x.id !== id))
      );
      renderHistory();
      e.stopPropagation();
      return;
    }
    const item = e.target.closest("[data-sid]");
    if (item) openSession(item.getAttribute("data-sid"));
  });

  $("imgBar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.imageSize = btn.getAttribute("data-size");
    $("imgBar").querySelectorAll(".ratio").forEach((el) => {
      el.classList.toggle("on", el === btn);
    });
  });

  $("input").addEventListener("input", updateChrome);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("sendBtn").onclick = send;

  $("msgList").addEventListener("click", (e) => {
    const previewBtn = e.target.closest("[data-preview-img]");
    if (previewBtn) {
      openImageLightbox(previewBtn.getAttribute("data-preview-img"));
      return;
    }
    const dlBtn = e.target.closest("[data-download-img]");
    if (dlBtn) {
      downloadImageFile(dlBtn.getAttribute("data-download-img") || "");
      return;
    }
    const img = e.target.closest("img.bubble-img[data-img]");
    if (img) openImageLightbox(img.getAttribute("data-img"));
  });
  if ($("imgLbClose")) $("imgLbClose").onclick = closeImageLightbox;
  if ($("imgLightbox")) {
    $("imgLightbox").addEventListener("click", (e) => {
      if (e.target === $("imgLightbox")) closeImageLightbox();
    });
  }

  $("cmCancel").onclick = closeCreateMask;
  $("cmSave").onclick = () => {
    const name = ($("cmName").value || "").trim();
    const emoji = ($("cmEmoji").value || "").trim() || "🎭";
    const prompt = ($("cmPrompt").value || "").trim();
    if (!name || !prompt) return;
    const list = customMasks();
    const id = `c_${uid()}`;
    list.unshift({ id, name, emoji, desc: "自定义", prompt });
    saveCustomMasks(list);
    $("cmName").value = "";
    $("cmEmoji").value = "";
    $("cmPrompt").value = "";
    closeCreateMask();
    setMask(id);
  };

  renderSkills();
  renderMaskRow();
  renderSheet();
  renderMessages();
  updateChrome();
})();
