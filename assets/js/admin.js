// پنل نویسنده: آپلود مستقیم روی ریپو با GitHub Contents API
(() => {
  const $ = (id) => document.getElementById(id);
  const API = "https://api.github.com";
  const MAX_BYTES = 20 * 1024 * 1024;
  const EXT_OK = { pdf: "pdf", png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image" };
  const KEY = "ictem_admin_cfg";

  let cfg = { owner: "", repo: "", branch: "main", token: "" };
  let manifest = { items: [] };
  let manifestSha = null;
  let editing = null; // id فایلی که در حال جایگزینی است

  /* ---------- ابزارهای کمکی ---------- */
  const say = (el, text, kind = "") => { el.textContent = text; el.className = "msg " + kind; };
  const faDate = (iso) => {
    try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); }
    catch { return ""; }
  };
  const siteBase = () => {
    // آدرس سایت عمومی (یک پوشه بالاتر از /admin/)
    return new URL("../", location.href).href;
  };
  const linkFor = (id) => siteBase() + "?id=" + encodeURIComponent(id);

  function loadCfg() {
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
    // حدس خودکار از آدرس github.io
    if (!cfg.owner && location.hostname.endsWith(".github.io")) {
      cfg.owner = location.hostname.split(".")[0];
      cfg.repo = location.pathname.split("/").filter(Boolean)[0] || cfg.owner + ".github.io";
    }
    $("c-owner").value = cfg.owner;
    $("c-repo").value = cfg.repo;
    $("c-branch").value = cfg.branch || "main";
    $("c-token").value = cfg.token;
  }

  async function gh(path, { method = "GET", body } = {}) {
    const res = await fetch(API + path, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + cfg.token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const repoPath = (p) => `/repos/${cfg.owner}/${cfg.repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}`;

  async function getMeta(path) {
    try { return await gh(repoPath(path) + "?ref=" + encodeURIComponent(cfg.branch)); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  async function putFile(path, base64, message, sha) {
    return gh(repoPath(path), {
      method: "PUT",
      body: { message, content: base64, branch: cfg.branch, ...(sha ? { sha } : {}) },
    });
  }

  async function deleteFile(path, message) {
    const meta = await getMeta(path);
    if (!meta) return;
    await gh(repoPath(path), { method: "DELETE", body: { message, sha: meta.sha, branch: cfg.branch } });
  }

  const utf8ToB64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  };
  const b64ToUtf8 = (b64) => {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ---------- فهرست (files.json) ---------- */
  async function loadManifest() {
    const meta = await getMeta("files.json");
    if (!meta) { manifest = { items: [] }; manifestSha = null; return; }
    manifestSha = meta.sha;
    try { manifest = JSON.parse(b64ToUtf8(meta.content)); } catch { manifest = { items: [] }; }
    if (!Array.isArray(manifest.items)) manifest.items = [];
  }

  async function saveManifest(message) {
    const body = JSON.stringify(manifest, null, 2) + "\n";
    const out = await putFile("files.json", utf8ToB64(body), message, manifestSha);
    manifestSha = out.content.sha;
  }

  // تغییر فهرست با یک بار تلاش مجدد در صورت تداخل نسخه
  async function mutateManifest(fn, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await loadManifest();
        fn(manifest);
        await saveManifest(message);
        return;
      } catch (e) {
        if (attempt === 1 || (e.status !== 409 && e.status !== 422)) throw e;
      }
    }
  }

  /* ---------- رابط ---------- */
  function renderList() {
    const ul = $("a-list");
    ul.replaceChildren();
    if (!manifest.items.length) {
      const li = document.createElement("li");
      li.className = "admin-row";
      li.textContent = "هنوز فایلی منتشر نشده است.";
      ul.append(li);
      return;
    }
    for (const it of manifest.items) {
      const li = document.createElement("li");
      li.className = "admin-row";
      li.innerHTML = `
        <span class="badge"></span>
        <div class="info"><div class="title" style="font-weight:700;color:var(--green-800)"></div><div class="slug"></div></div>
        <div class="toolbar">
          <a class="btn sm" target="_blank" rel="noopener">باز کردن</a>
          <button class="btn sm" data-a="copy">کپی لینک</button>
          <button class="btn sm yellow" data-a="edit">ویرایش / جایگزینی</button>
          <button class="btn sm danger" data-a="del">حذف</button>
        </div>`;
      li.querySelector(".badge").textContent = it.type === "pdf" ? "PDF" : "IMG";
      li.querySelector(".title").textContent = it.title + (it.listed === false ? " (مخفی)" : "");
      li.querySelector(".slug").textContent = linkFor(it.id) + " · " + faDate(it.updated);
      li.querySelector("a").href = linkFor(it.id);
      li.querySelector('[data-a="copy"]').onclick = async (ev) => {
        try { await navigator.clipboard.writeText(linkFor(it.id)); ev.target.textContent = "کپی شد ✓"; }
        catch { prompt("لینک:", linkFor(it.id)); }
        setTimeout(() => (ev.target.textContent = "کپی لینک"), 1500);
      };
      li.querySelector('[data-a="edit"]').onclick = () => startEdit(it);
      li.querySelector('[data-a="del"]').onclick = () => removeItem(it);
      ul.append(li);
    }
  }

  function resetForm() {
    editing = null;
    $("f-heading").textContent = "افزودن فایل جدید";
    $("f-id").disabled = false;
    $("f-id").value = "";
    $("f-title").value = "";
    $("f-file").value = "";
    $("f-listed").checked = true;
    $("f-cancel").classList.add("hidden");
    $("f-submit").textContent = "انتشار";
    updatePreview();
  }

  function startEdit(it) {
    editing = it.id;
    $("f-heading").textContent = "ویرایش: " + it.title;
    $("f-id").value = it.id;
    $("f-id").disabled = true; // شناسه (لینک) هرگز تغییر نمی‌کند
    $("f-title").value = it.title;
    $("f-file").value = "";
    $("f-listed").checked = it.listed !== false;
    $("f-cancel").classList.remove("hidden");
    $("f-submit").textContent = "ذخیره تغییرات";
    say($("f-msg"), "برای جایگزینی محتوا فایل جدید را انتخاب کنید؛ اگر فقط عنوان را عوض می‌کنید، فایل را خالی بگذارید. لینک تغییر نمی‌کند.");
    updatePreview();
    $("f-title").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updatePreview() {
    $("f-preview").textContent = linkFor($("f-id").value.trim() || "…");
  }

  async function refresh() {
    await loadManifest();
    renderList();
  }

  /* ---------- عملیات ---------- */
  async function login() {
    cfg = {
      owner: $("c-owner").value.trim(),
      repo: $("c-repo").value.trim(),
      branch: $("c-branch").value.trim() || "main",
      token: $("c-token").value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) { say($("c-msg"), "همه فیلدها را پر کنید.", "error"); return; }
    say($("c-msg"), "در حال اتصال…");
    try {
      const repo = await gh(`/repos/${cfg.owner}/${cfg.repo}`);
      if (repo.permissions && !repo.permissions.push) throw new Error("این توکن اجازه نوشتن روی ریپو را ندارد.");
      localStorage.setItem(KEY, JSON.stringify(cfg));
      await refresh();
      $("work").classList.remove("hidden");
      say($("c-msg"), "متصل شدید ✓", "ok");
    } catch (e) {
      $("work").classList.add("hidden");
      const hint = e.status === 401 ? "توکن نامعتبر یا منقضی است." : e.status === 404 ? "ریپو پیدا نشد یا توکن به آن دسترسی ندارد." : e.message;
      const net = e instanceof TypeError ? "ارتباط با api.github.com برقرار نشد (ممکن است نیاز به VPN یا اتصال دیگری باشد)." : hint;
      say($("c-msg"), net, "error");
    }
  }

  function logout() {
    localStorage.removeItem(KEY);
    cfg.token = "";
    $("c-token").value = "";
    $("work").classList.add("hidden");
    say($("c-msg"), "توکن از این مرورگر حذف شد.", "ok");
  }

  async function submit() {
    const msg = $("f-msg");
    const id = $("f-id").value.trim().toLowerCase();
    const title = $("f-title").value.trim();
    const file = $("f-file").files[0];
    const listed = $("f-listed").checked;
    const existing = manifest.items.find((i) => i.id === id);

    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) { say(msg, "شناسه فقط می‌تواند حروف کوچک انگلیسی، عدد و خط تیره باشد.", "error"); return; }
    if (!title) { say(msg, "عنوان را وارد کنید.", "error"); return; }
    if (!editing && existing) { say(msg, "این شناسه قبلاً وجود دارد. از دکمه «ویرایش / جایگزینی» استفاده کنید.", "error"); return; }
    if (!file && !existing) { say(msg, "فایل را انتخاب کنید.", "error"); return; }

    let ext, type;
    if (file) {
      ext = file.name.split(".").pop().toLowerCase();
      type = EXT_OK[ext];
      if (!type) { say(msg, "فرمت فایل پشتیبانی نمی‌شود.", "error"); return; }
      if (file.size > MAX_BYTES) { say(msg, "حجم فایل بیشتر از ۲۰ مگابایت است.", "error"); return; }
    }

    $("f-submit").disabled = true;
    try {
      const now = new Date().toISOString();
      let newPath = existing?.file;
      let size = existing?.size;
      if (file) {
        say(msg, "در حال آپلود فایل…");
        newPath = `files/${id}.${ext}`;
        const meta = await getMeta(newPath);
        await putFile(newPath, await fileToB64(file), `${existing ? "Replace" : "Add"} ${id}`, meta?.sha);
        size = file.size;
      }
      say(msg, "در حال به‌روزرسانی فهرست…");
      const oldPath = existing?.file;
      await mutateManifest((m) => {
        const item = { id, title, file: newPath, type: type || existing.type, listed, updated: file ? now : existing.updated, size };
        const idx = m.items.findIndex((i) => i.id === id);
        if (idx >= 0) m.items[idx] = item; else m.items.unshift(item);
      }, `${existing ? "Update" : "Add"} ${id} in manifest`);

      // اگر فرمت عوض شد (مثلاً pdf → png)، فایل قدیمی پاک شود
      if (file && oldPath && oldPath !== newPath) await deleteFile(oldPath, `Remove old file of ${id}`);

      renderList();
      resetForm();
      say(msg, "منتشر شد ✓ — تا حدود یک تا دو دقیقه طول می‌کشد GitHub Pages سایت را به‌روز کند.", "ok");
    } catch (e) {
      say(msg, "خطا: " + (e instanceof TypeError ? "ارتباط با GitHub قطع شد." : e.message), "error");
    } finally {
      $("f-submit").disabled = false;
    }
  }

  async function removeItem(it) {
    if (!confirm(`«${it.title}» حذف شود؟ لینک آن از کار می‌افتد.`)) return;
    try {
      say($("a-msg"), "در حال حذف…");
      await mutateManifest((m) => { m.items = m.items.filter((i) => i.id !== it.id); }, `Remove ${it.id} from manifest`);
      await deleteFile(it.file, `Delete ${it.id}`);
      renderList();
      say($("a-msg"), "حذف شد.", "ok");
    } catch (e) {
      say($("a-msg"), "خطا: " + e.message, "error");
    }
  }

  /* ---------- شروع ---------- */
  $("c-save").onclick = login;
  $("c-logout").onclick = logout;
  $("f-submit").onclick = submit;
  $("f-cancel").onclick = () => { resetForm(); say($("f-msg"), ""); };
  $("f-id").addEventListener("input", updatePreview);

  loadCfg();
  updatePreview();
  if (cfg.token && cfg.owner && cfg.repo) login(); // ورود خودکار با توکن ذخیره‌شده
})();
