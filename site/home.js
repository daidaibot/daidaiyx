(function () {
  const splash = document.getElementById("splash");
  const page = document.getElementById("page");
  const toast = document.getElementById("toast");
  const transit = document.getElementById("transit");
  const year = document.getElementById("year");
  let splashDone = false;
  let opening = false;
  let toastTimer = null;

  year.textContent = String(new Date().getFullYear());

  function enterSite() {
    if (splashDone) return;
    splashDone = true;
    splash.classList.add("is-leaving");
    page.classList.add("ready");
    setTimeout(() => {
      splash.classList.add("is-hidden");
    }, 750);
  }

  splash.addEventListener("click", enterSite);
  setTimeout(enterSite, 3200);

  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
    });
  });

  document.getElementById("goAi").addEventListener("click", () => {
    if (opening) return;
    opening = true;
    transit.classList.add("show");
    setTimeout(() => {
      location.href = "./chat.html";
    }, 520);
  });
})();
