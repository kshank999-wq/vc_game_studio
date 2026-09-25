(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");

  let best = 0;
  try { best = Number(localStorage.getItem("starDodgeBest")) || 0; } catch {}
  bestEl.textContent = best;

  const keys = new Set();
  let touchX = null;
  let state, ship, meteors, stars, score, spawnTimer, lastTime;

  function reset() {
    ship = { x: W / 2, y: H - 70, r: 16, speed: 320 };
    meteors = [];
    stars = Array.from({ length: 80 }, () => ({
      x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5,
    }));
    score = 0;
    spawnTimer = 0;
    state = "ready";
  }

  function spawnMeteor() {
    const r = 10 + Math.random() * 22;
    const difficulty = 1 + score / 30;
    meteors.push({
      x: r + Math.random() * (W - 2 * r),
      y: -r,
      r,
      vy: (120 + Math.random() * 120) * difficulty,
      vx: (Math.random() - 0.5) * 60,
    });
  }

  function update(dt) {
    for (const s of stars) {
      s.y += s.s * 40 * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }
    if (state !== "playing") return;

    let dir = 0;
    if (keys.has("ArrowLeft") || keys.has("a")) dir -= 1;
    if (keys.has("ArrowRight") || keys.has("d")) dir += 1;
    if (touchX !== null) dir = Math.sign(touchX - ship.x) * Math.min(1, Math.abs(touchX - ship.x) / 20);
    ship.x = Math.max(ship.r, Math.min(W - ship.r, ship.x + dir * ship.speed * dt));

    score += dt;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnMeteor();
      spawnTimer = Math.max(0.18, 0.7 - score / 100);
    }

    for (const m of meteors) {
      m.y += m.vy * dt;
      m.x += m.vx * dt;
      const dx = m.x - ship.x, dy = m.y - ship.y;
      if (dx * dx + dy * dy < (m.r + ship.r * 0.7) ** 2) gameOver();
    }
    meteors = meteors.filter((m) => m.y - m.r < H);
    scoreEl.textContent = Math.floor(score);
  }

  function gameOver() {
    state = "over";
    const final = Math.floor(score);
    if (final > best) {
      best = final;
      bestEl.textContent = best;
      try { localStorage.setItem("starDodgeBest", best); } catch {}
    }
  }

  function draw() {
    ctx.fillStyle = "#05060f";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    for (const s of stars) ctx.fillRect(s.x, s.y, s.s, s.s);

    ctx.fillStyle = "#8b6b4a";
    for (const m of meteors) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.moveTo(0, -ship.r);
    ctx.lineTo(ship.r, ship.r);
    ctx.lineTo(0, ship.r * 0.5);
    ctx.lineTo(-ship.r, ship.r);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (state !== "playing") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e8eaf6";
      ctx.textAlign = "center";
      ctx.font = "bold 36px system-ui, sans-serif";
      ctx.fillText(state === "over" ? "Game Over" : "Star Dodge", W / 2, H / 2 - 20);
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText("Press Space or tap to " + (state === "over" ? "retry" : "start"), W / 2, H / 2 + 20);
    }
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - (lastTime ?? t)) / 1000);
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function start() {
    if (state === "playing") return;
    if (state === "over") reset();
    state = "playing";
  }

  window.addEventListener("keydown", (e) => {
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (e.key === " ") { e.preventDefault(); start(); }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));

  function canvasX(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  }
  canvas.addEventListener("pointerdown", (e) => { start(); touchX = canvasX(e); });
  canvas.addEventListener("pointermove", (e) => { if (touchX !== null) touchX = canvasX(e); });
  window.addEventListener("pointerup", () => { touchX = null; });

  reset();
  requestAnimationFrame(loop);
})();
