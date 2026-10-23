// صفحه عمومی: نمایش فهرست یا یک فایل با لینک ثابت ?id=slug
const $ = (id) => document.getElementById(id);
const root = new URL("../../", import.meta.url); // ریشه سایت
const faDate = (iso) => {
  try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); }
  catch { return ""; }
};

function showState(text, error = false) {
  const s = $("state");
  s.className = "status" + (error ? " error" : "");
  s.innerHTML = error ? "" : '<div class="spinner"></div>';
  s.append(text);
  s.classList.remove("hidden");
}
const hideState = () => $("state").classList.add("hidden");

async function loadManifest() {
  // no-store: همیشه آخرین نسخه فهرست گرفته شود
  const r = await fetch(new URL("files.json", root) + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("manifest");
  const data = await r.json();
  return Array.isArray(data.items) ? data.items : [];
}

const fileUrl = (item) => new URL(item.file, root).href + "?v=" + encodeURIComponent(item.updated || "");

function renderList(items) {
  const ul = $("list");
  const shown = items.filter((i) => i.listed !== false);
  if (!shown.length) { showState("هنوز فایلی منتشر نشده است."); return; }
  for (const it of shown) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "row";
    a.href = "?id=" + encodeURIComponent(it.id);
    a.innerHTML = '<span class="badge"></span><span class="title"></span><span class="when"></span>';
    a.querySelector(".badge").textContent = it.type === "pdf" ? "PDF" : "IMG";
    a.querySelector(".title").textContent = it.title;
    a.querySelector(".when").textContent = faDate(it.updated);
    li.append(a);
    ul.append(li);
  }
  $("home").classList.remove("hidden");
  hideState();
}

async function renderImage(item, box) {
  const img = new Image();
  img.alt = item.title;
  img.src = fileUrl(item);
  img.addEventListener("click", () => {
    img.classList.toggle("zoomed");
    box.classList.toggle("scroll-x", img.classList.contains("zoomed"));
  });
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  box.replaceChildren(img);
}

async function renderPdf(item, box) {
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
  const v = (p) => new URL("../vendor/" + p, import.meta.url).href;
  const doc = await pdfjs.getDocument({
    url: fileUrl(item),
    cMapUrl: v("cmaps/"), cMapPacked: true,
    standardFontDataUrl: v("standard_fonts/"),
    wasmUrl: v("wasm/"), iccUrl: v("iccs/"),
    // حروف به‌صورت مسیر برداری کشیده می‌شوند؛ از خراب شدن فونت‌های فارسی/لاتین جلوگیری می‌کند
    disableFontFace: true,
  }).promise;

  const wrap = document.createElement("div");
  wrap.className = "pdf-pages";
  box.replaceChildren(wrap);

  let scale = 1; // ضریب بزرگ‌نمایی نسبت به عرض کانتینر
  const pages = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const holder = document.createElement("div");
    holder.className = "pdf-page";
    const canvas = document.createElement("canvas");
    holder.append(canvas);
    wrap.append(holder);
    pages.push({ page, base, holder, canvas, rendered: 0 });
  }

  const cssWidth = () => Math.max(260, (box.clientWidth - 28) * scale);

  function layout() {
    const w = cssWidth();
    for (const p of pages) {
      p.holder.style.width = w + "px";
      p.holder.style.aspectRatio = p.base.width + " / " + p.base.height;
      p.rendered = 0; // نیاز به رندر دوباره
    }
    observe();
  }

  async function draw(p) {
    const w = cssWidth();
    if (p.rendered === w) return;
    p.rendered = w;
    const vp = p.page.getViewport({ scale: (w / p.base.width) * dpr });
    p.canvas.width = vp.width;
    p.canvas.height = vp.height;
    await p.page.render({ canvasContext: p.canvas.getContext("2d"), viewport: vp }).promise;
  }

  let io;
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) draw(pages.find((p) => p.holder === e.target));
    }, { rootMargin: "600px 0px" });
    pages.forEach((p) => io.observe(p.holder));
  }

  layout();

  // کنترل بزرگ‌نمایی
  const zv = $("z-val");
  $("zoom-ui").classList.remove("hidden");
  const setScale = (s) => {
    scale = Math.min(3, Math.max(0.5, s));
    zv.textContent = Math.round(scale * 100) + "%";
    box.classList.toggle("scroll-x", scale > 1);
    layout();
  };
  $("z-in").onclick = () => setScale(scale + 0.25);
  $("z-out").onclick = () => setScale(scale - 0.25);

  let lastW = box.clientWidth;
  window.addEventListener("resize", () => {
    if (box.clientWidth !== lastW) { lastW = box.clientWidth; layout(); }
  });
}

async function renderOne(items, id) {
  const item = items.find((i) => i.id === id);
  if (!item) { showState("فایلی با این لینک پیدا نشد.", true); return; }

  document.title = item.title + " · ICTEM";
  $("v-title").textContent = item.title;
  $("v-meta").textContent = item.updated ? "آخرین به‌روزرسانی: " + faDate(item.updated) : "";
  const url = fileUrl(item);
  $("b-open").href = url;
  $("b-dl").href = url;
  $("b-dl").setAttribute("download", item.id + "." + item.file.split(".").pop());
  $("b-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); $("b-copy").textContent = "کپی شد ✓"; }
    catch { prompt("لینک:", location.href); }
    setTimeout(() => ($("b-copy").textContent = "کپی لینک"), 1800);
  };
  $("view").classList.remove("hidden");
  showState("در حال بارگذاری فایل…");

  const box = $("viewer");

  // نمایشگر داخلی مرورگر (دسکتاپ) دقیق‌ترین نمایش PDF را دارد؛ pdf.js برای موبایل و بقیه
  const nativePdf = () => {
    box.classList.remove("scroll-x");
    $("zoom-ui").classList.add("hidden");
    const f = document.createElement("iframe");
    f.src = fileUrl(item);
    f.title = item.title;
    f.style.cssText = "width:100%;height:82vh;border:0;border-radius:8px;background:#fff";
    box.replaceChildren(f);
  };
  const toggle = $("b-mode");

  try {
    if (item.type === "pdf") {
      const canNative = navigator.pdfViewerEnabled === true;
      const useNative = canNative && localStorage.getItem("pdfMode") !== "js";
      if (canNative) {
        toggle.classList.remove("hidden");
        toggle.textContent = useNative ? "نمایش جایگزین" : "نمایش با مرورگر";
        toggle.onclick = () => {
          try { localStorage.setItem("pdfMode", useNative ? "js" : "native"); } catch {}
          location.reload();
        };
      }
      if (useNative) nativePdf(); else await renderPdf(item, box);
    } else await renderImage(item, box);
    hideState();
  } catch (e) {
    console.error(e);
    box.replaceChildren();
    showState("نمایش فایل در این مرورگر ممکن نشد. از دکمه «باز کردن در تب جدید» یا «دانلود» استفاده کنید.", true);
  }
}

(async function main() {
  try {
    const items = await loadManifest();
    const id = new URLSearchParams(location.search).get("id");
    if (id) await renderOne(items, id);
    else renderList(items);
  } catch (e) {
    console.error(e);
    showState("بارگذاری اطلاعات ناموفق بود. اتصال اینترنت را بررسی کنید و صفحه را دوباره باز کنید.", true);
  }
})();
