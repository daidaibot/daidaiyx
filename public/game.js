(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const livesEl = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('desc');
  const startBtn = document.getElementById('startBtn');

  const W = canvas.width;
  const H = canvas.height;
  const BEST_KEY = 'daidaiyx_best';

  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = String(best);

  const state = {
    running: false,
    score: 0,
    lives: 3,
    player: { x: W / 2, y: H - 56, r: 18, vx: 0 },
    items: [],
    spawnTimer: 0,
    last: 0,
  };

  const keys = new Set();
  let touchX = null;

  function resetGame() {
    state.score = 0;
    state.lives = 3;
    state.items = [];
    state.spawnTimer = 0;
    state.player.x = W / 2;
    state.player.vx = 0;
    scoreEl.textContent = '0';
    livesEl.textContent = '3';
  }

  function startGame() {
    resetGame();
    state.running = true;
    overlay.classList.add('hidden');
    state.last = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame() {
    state.running = false;
    if (state.score > best) {
      best = state.score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = String(best);
    }
    titleEl.textContent = '游戏结束';
    descEl.textContent = `本局得分 ${state.score}，最高 ${best}。再来一局？`;
    startBtn.textContent = '再玩一次';
    overlay.classList.remove('hidden');
  }

  function spawn() {
    const isStar = Math.random() < 0.72;
    state.items.push({
      x: 24 + Math.random() * (W - 48),
      y: -20,
      r: isStar ? 10 : 12,
      vy: 140 + Math.random() * 120 + state.score * 1.2,
      type: isStar ? 'star' : 'rock',
    });
  }

  function hit(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy < (a.r + b.r) * (a.r + b.r);
  }

  function update(dt) {
    const p = state.player;
    let dir = 0;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) dir -= 1;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) dir += 1;
    if (touchX != null) {
      const target = touchX;
      if (Math.abs(target - p.x) > 6) dir = target > p.x ? 1 : -1;
      else dir = 0;
    }
    p.vx = dir * 280;
    p.x += p.vx * dt;
    p.x = Math.max(p.r + 4, Math.min(W - p.r - 4, p.x));

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawn();
      state.spawnTimer = Math.max(0.28, 0.85 - state.score * 0.008);
    }

    for (const it of state.items) it.y += it.vy * dt;
    state.items = state.items.filter((it) => {
      if (hit(p, it)) {
        if (it.type === 'star') {
          state.score += 1;
          scoreEl.textContent = String(state.score);
        } else {
          state.lives -= 1;
          livesEl.textContent = String(state.lives);
          if (state.lives <= 0) endGame();
        }
        return false;
      }
      return it.y < H + 30;
    });
  }

  function drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16344a');
    g.addColorStop(1, '#0b1620');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W;
      const y = (i * 53 + state.score * 3) % H;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function drawPlayer() {
    const p = state.player;
    ctx.beginPath();
    ctx.fillStyle = '#f0c75e';
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1408';
    ctx.beginPath();
    ctx.arc(p.x - 6, p.y - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(p.x + 6, p.y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1408';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y + 3, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  function drawItems() {
    for (const it of state.items) {
      ctx.beginPath();
      if (it.type === 'star') {
        ctx.fillStyle = '#ffe28a';
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0c75e';
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8b1e1e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.033, (now - state.last) / 1000);
    state.last = now;
    update(dt);
    drawBg();
    drawItems();
    drawPlayer();
    if (state.running) requestAnimationFrame(loop);
  }

  startBtn.addEventListener('click', startGame);

  window.addEventListener('keydown', (e) => {
    keys.add(e.key);
    if (e.code === 'Space' && !state.running) startGame();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      touchX = ((t.clientX - rect.left) / rect.width) * W;
      if (!state.running) startGame();
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      touchX = ((t.clientX - rect.left) / rect.width) * W;
    },
    { passive: false }
  );
  canvas.addEventListener('touchend', () => {
    touchX = null;
  });
})();
