const BUILD_ID = "1767331471";
console.log("Protocol Review build", BUILD_ID);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const LS = {
  authed: "proto_authed_v1",
  missed: "proto_missed_v1",
  history: "proto_history_v1",
};

function fixPdfGlue(s) {
  return (s || "")
    // common missing spaces
    .replace(/complexSVT/g, "complex SVT")
    .replace(/Widecomplex/g, "Wide complex")
    .replace(/DoseInhaler/g, "Dose Inhaler")
    .replace(/Metered-DoseInhaler/g, "Metered-Dose Inhaler")
    .replace(/AlbuterolMDI/g, "Albuterol MDI")
    .replace(/Soluti\s+on/g, "Solution")
    // "Mayrepe at" / "mayrepe at" -> "May repeat"
    .replace(/Mayrepe\s*at/gi, "May repeat")
    // tighten stray spaces
    .replace(/\s+/g, " ")
    .trim();
}

function boldDoseTokens(s) {
  // Bold numeric + unit only (keeps nearby phrase intact)
  return (s || "").replace(
    /(\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|mL|ml|cc|units|unit|IU|mEq)(?:\s*\/\s*kg)?)/gi,
    "<b>$1</b>"
  );
}

function formatProtocolHtml(rawHtml) {
  if (!rawHtml) return "";

  // If it's already a <ul class='proto'> we assume it's structured enough
  if (rawHtml.includes("ul") && rawHtml.includes("proto")) return rawHtml;

  // Parse text from incoming HTML (we'll re-bold doses after restructuring)
  const tmp = document.createElement("div");
  tmp.innerHTML = rawHtml;
  let text = fixPdfGlue(tmp.textContent || "");

  // Detect condition header (before first colon)
  let header = "";
  const colonIdx = text.indexOf(":");
  if (colonIdx > 10 && colonIdx < 120) {
    header = text.slice(0, colonIdx).trim();
    text = text.slice(colonIdx + 1).trim();
  }

  // Find medication block start positions.
  // Priority 1: explicit headers like "X - Adult" / "X - Pediatric"
  const reHeader = /([A-Z][A-Za-z0-9/ ]+(?:\s*\([^)]+\))?(?:\s+[A-Z][A-Za-z0-9/ -]+?)*)\s*-\s*(Adult|Pediatric)\b/g;

  // Fallback: repeated “Drug, <dose> …” patterns (ex: Adenosine, 6 mg…)
  const reDrugDose = /\b([A-Z][A-Za-z]{3,}(?:\s*\([^)]+\))?)\s*,\s*(\d)/g;

  const starts = [];
  let m;

  while ((m = reHeader.exec(text)) !== null) {
    starts.push({ i: m.index, name: (m[1] + " - " + m[2]).trim(), kind: "header" });
  }
  if (starts.length === 0) {
    while ((m = reDrugDose.exec(text)) !== null) {
      starts.push({ i: m.index, name: m[1].trim(), kind: "dose" });
    }
  }

  // If still nothing found, just bullet-split sentences
  if (starts.length === 0) {
    const bits = text
      .split(/(?<=\.)\s+|;\s+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(boldDoseTokens);

    const list = bits.map(x => `<li>${x}</li>`).join("");
    return `
      <div class="protoBlock">
        ${header ? `<div class="protoHdr">${escapeHTML(header)}</div>` : ""}
        <ul class="proto">${list}</ul>
      </div>
    `;
  }

  // Build blocks by slicing between starts
  starts.sort((a, b) => a.i - b.i);

  const blocks = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k];
    const b = starts[k + 1];
    const chunk = text.slice(a.i, b ? b.i : text.length).trim();

    // Extract a clean med title + body
    let medTitle = a.name;
    let body = chunk;

    if (a.kind === "header") {
      // chunk begins with "Title - Adult ..." — keep title, remove it from body
      const cut = chunk.indexOf(a.name);
      body = cut === 0 ? chunk.slice(a.name.length).trim() : chunk;
    } else {
      // for dose pattern, medTitle is drug name; remove leading "Drug," from body
      body = chunk.replace(new RegExp("^" + medTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*,\\s*", "i"), "").trim();
    }

    body = fixPdfGlue(body);

    // Sub-bullet splitting: keep logic together
    // - break on "If ..." and "May repeat ..." as nested bullets
    // - break on sentence ends / semicolons
    const parts = body
      .split(/(?<=\.)\s+|;\s+|\s+\band\b\s+(?=[A-Z][a-z]{3,}\s*,\s*\d)/)
      .map(s => s.trim())
      .filter(Boolean);

    // Merge tiny fragments into previous bullet (prevents “one thought split into two”)
    const merged = [];
    for (const p of parts) {
      if (merged.length && (/^[a-z]/.test(p) || p.length < 18)) {
        merged[merged.length - 1] = (merged[merged.length - 1] + " " + p).trim();
      } else {
        merged.push(p);
      }
    }

    const sub = merged
      .map(x => boldDoseTokens(x))
      .map(x => `<li>${x}</li>`)
      .join("");

    blocks.push(`
      <div class="medBlock">
        <div class="medTitle">${escapeHTML(medTitle)}</div>
        <ul class="proto">${sub}</ul>
      </div>
    `);
  }

  return `
    <div class="protoBlock">
      ${header ? `<div class="protoHdr">${escapeHTML(header)}</div>` : ""}
      ${blocks.join("")}
    </div>
  `;
}


function nowISO(){ return new Date().toISOString(); }

function loadJSON(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
  catch{ return fallback; }
}
function saveJSON(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function recordHistory(entry){
  const hist = loadJSON(LS.history, []);
  hist.unshift(entry);
  hist.splice(300); // cap
  saveJSON(LS.history, hist);
}

function addMissed(id){
  const missed = new Set(loadJSON(LS.missed, []));
  missed.add(id);
  saveJSON(LS.missed, Array.from(missed));
}
function removeMissed(id){
  const missed = new Set(loadJSON(LS.missed, []));
  missed.delete(id);
  saveJSON(LS.missed, Array.from(missed));
}

function normalize(s){ return (s||"").toLowerCase().replace(/\s+/g," ").trim(); }

let ALL = [];
let FILTERED = [];
let MODE = "cards";
let CARD_IDX = 0;
let FLIPPED = false;
let searchTerm = "";

function makeId(card){
  return normalize(card.drug)+"__"+normalize(card.population);
}

function applySearch(){
  const q = normalize(searchTerm);
  if(!q){ FILTERED = ALL.slice(); return; }
  FILTERED = ALL.filter(c => normalize(c.drug).includes(q) || normalize(c.population).includes(q) || normalize(c.text).includes(q));
}

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function nextCard(){
  if(FILTERED.length===0) return;
  CARD_IDX = (CARD_IDX+1) % FILTERED.length;
  FLIPPED = false;
  render();
}
function prevCard(){
  if(FILTERED.length===0) return;
  CARD_IDX = (CARD_IDX-1+FILTERED.length) % FILTERED.length;
  FLIPPED = false;
  render();
}

function renderCards(){
  const panel = $("#panel");
  panel.innerHTML = "";
  if(FILTERED.length===0){
    panel.innerHTML = `<div class="card flashcard"><div class="big">No matches.</div><div class="muted">Try a different search.</div></div>`;
    return;
  }
  const c = FILTERED[CARD_IDX];
  const id = makeId(c);
  const missedSet = new Set(loadJSON(LS.missed, []));
  const isMissed = missedSet.has(id);

  const front = `<div class="big">${c.drug}</div><div class="pill">${c.population}</div>`;
  const back = `<div class="bodytext">${c.html ? c.html : escapeHTML(c.text)}</div><div class="muted" style="margin-top:8px">Source page: ${c.page}</div>`;

  const card = document.createElement("div");
  card.className = "card flashcard";
  card.innerHTML = `
    <div class="flash-top">
      <div>${FLIPPED ? back : front}</div>
    </div>
    <div class="hr"></div>
    <div class="controls">
      <button class="btn secondary" id="btnPrev">← Prev</button>
      <button class="btn" id="btnFlip">${FLIPPED ? "Show front" : "Flip"}</button>
      <button class="btn secondary" id="btnNext">Next →</button>
      <span class="kbd">${CARD_IDX+1}/${FILTERED.length}</span>
      <button class="btn ${isMissed ? "danger" : "secondary"}" id="btnMark">${isMissed ? "Unmark missed" : "Mark missed"}</button>
    </div>
    <div class="muted" style="margin-top:8px">Tip: tap the card to flip.</div>
  `;

  card.addEventListener("click", (e)=>{
    if(e.target.closest("button")) return;
    FLIPPED = !FLIPPED;
    render();
  });

  panel.appendChild(card);

  $("#btnPrev").onclick = (e)=>{ e.stopPropagation(); prevCard(); };
  $("#btnNext").onclick = (e)=>{ e.stopPropagation(); nextCard(); };
  $("#btnFlip").onclick = (e)=>{ e.stopPropagation(); FLIPPED = !FLIPPED; render(); };
  $("#btnMark").onclick = (e)=>{
    e.stopPropagation();
    if(isMissed) removeMissed(id); else addMissed(id);
    recordHistory({ts: nowISO(), mode:"flashcards", drug:c.drug, population:c.population, result: isMissed ? "unmarked" : "missed"});
    render();
  };
}

function renderMCQ(){
  const panel = $("#panel");
  panel.innerHTML = "";
  if(FILTERED.length < 4){
    panel.innerHTML = `<div class="card flashcard"><div class="big">Need at least 4 cards for multiple choice.</div></div>`;
    return;
  }

  // Question: which drug matches this dosing text?
  const correct = pickRandom(FILTERED);
  const correctId = makeId(correct);
  const options = new Set([correct.drug]);
  while(options.size < 4){
    options.add(pickRandom(FILTERED).drug);
  }
  const opts = Array.from(options).sort(()=>Math.random()-0.5);

  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.innerHTML = `
    <div class="card flashcard">
      <div class="h1">Which medication matches this protocol?</div>
      <div class="pill">${correct.population}</div>
      <div class="hr"></div>
      <div class="bodytext">${redactDrug((correct.html ? correct.html : escapeHTML(correct.text)), correct.drug)}</div>
      <div class="muted" style="margin-top:8px">Choose one:</div>
      <div id="choices" class="stack" style="margin-top:10px"></div>
    </div>
    <div class="controls">
      <button class="btn secondary" id="btnNewQ">New question</button>
    </div>
  `;
  panel.appendChild(wrap);

  const choices = wrap.querySelector("#choices");
  let locked = false;
  opts.forEach(drug=>{
    const btn = document.createElement("div");
    btn.className = "choice";
    btn.textContent = drug;
    btn.onclick = ()=>{
      if(locked) return;
      locked = true;
      const isCorrect = (drug === correct.drug);
      btn.classList.add(isCorrect ? "correct" : "wrong");
      if(!isCorrect){
        // highlight correct
        Array.from(choices.children).forEach(ch=>{
          if(ch.textContent === correct.drug) ch.classList.add("correct");
        });
        addMissed(correctId);
      }else{
        removeMissed(correctId);
      }
      recordHistory({ts: nowISO(), mode:"mcq", drug:correct.drug, population:correct.population, result: isCorrect ? "correct" : "wrong"});
    };
    choices.appendChild(btn);
  });

  $("#btnNewQ").onclick = ()=>render();
}

function renderTyped(){
  const panel = $("#panel");
  panel.innerHTML = "";
  if(FILTERED.length===0){
    panel.innerHTML = `<div class="card flashcard"><div class="big">No matches.</div></div>`;
    return;
  }
  const c = pickRandom(FILTERED);
  const id = makeId(c);

  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.innerHTML = `
    <div class="card flashcard">
      <div class="h1">Typed recall</div>
      <div class="muted">Type the dosing/route notes for:</div>
      <div class="big" style="margin-top:6px">${c.drug}</div>
      <div class="pill" style="margin-top:6px">${c.population}</div>
      <div class="hr"></div>
      <textarea id="typedAnswer" class="input" rows="6" placeholder="Type what you remember…"></textarea>
      <div class="controls" style="margin-top:10px">
        <button id="btnReveal" class="btn">Reveal answer</button>
        <button id="btnNew" class="btn secondary">New prompt</button>
      </div>
      <div id="reveal" class="hidden" style="margin-top:12px">
        <div class="hr"></div>
        <div class="muted">Protocol text:</div>
        <div class="bodytext" style="margin-top:6px">${c.html ? c.html : escapeHTML(c.text)}</div>
        <div class="controls" style="margin-top:10px">
          <button id="btnIWasRight" class="btn">I was right</button>
          <button id="btnIMissed" class="btn danger">I missed it</button>
        </div>
      </div>
    </div>
  `;
  panel.appendChild(wrap);

  wrap.querySelector("#btnReveal").onclick = ()=>{
    wrap.querySelector("#reveal").classList.remove("hidden");
    recordHistory({ts: nowISO(), mode:"typed", drug:c.drug, population:c.population, result:"revealed"});
  };
  wrap.querySelector("#btnNew").onclick = ()=>render();
  wrap.querySelector("#btnIWasRight").onclick = ()=>{
    removeMissed(id);
    recordHistory({ts: nowISO(), mode:"typed", drug:c.drug, population:c.population, result:"self-correct"});
    render();
  };
  wrap.querySelector("#btnIMissed").onclick = ()=>{
    addMissed(id);
    recordHistory({ts: nowISO(), mode:"typed", drug:c.drug, population:c.population, result:"self-wrong"});
    render();
  };
}

function renderCases(){
  const panel = $("#panel");
  panel.innerHTML = "";
  if(FILTERED.length===0){
    panel.innerHTML = `<div class="card flashcard"><div class="big">No matches.</div></div>`;
    return;
  }
  const c = pickRandom(FILTERED);
  const id = makeId(c);

  // Super-light case prompt: we don't infer patient specifics yet; it still feels like a case.
  const prompts = [
    "You’re on a call and need this medication. What’s the correct dosing and route guidance?",
    "A provider asks for a quick refresher. Give the dosing details for this med.",
    "You’re prepping meds: confirm dose, route, and any max/repeat notes.",
    "Peds vs adult can differ — what does the protocol say here?"
  ];
  const prompt = pickRandom(prompts);

  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.innerHTML = `
    <div class="card flashcard">
      <div class="h1">Case prompt</div>
      <div class="muted">${prompt}</div>
      <div class="big" style="margin-top:10px">${c.drug}</div>
      <div class="pill" style="margin-top:6px">${c.population}</div>
      <div class="hr"></div>
      <div class="controls">
        <button id="btnShow" class="btn">Show protocol</button>
        <button id="btnNew" class="btn secondary">New case</button>
        <button id="btnMarkMiss" class="btn danger">Mark missed</button>
      </div>
      <div id="caseAnswer" class="hidden" style="margin-top:12px">
        <div class="hr"></div>
        <div class="bodytext">${c.html ? c.html : escapeHTML(c.text)}</div>
        <div class="muted" style="margin-top:8px">Source page: ${c.page}</div>
      </div>
    </div>
  `;
  panel.appendChild(wrap);

  wrap.querySelector("#btnShow").onclick = ()=>{
    wrap.querySelector("#caseAnswer").classList.remove("hidden");
    recordHistory({ts: nowISO(), mode:"case", drug:c.drug, population:c.population, result:"revealed"});
  };
  wrap.querySelector("#btnNew").onclick = ()=>render();
  wrap.querySelector("#btnMarkMiss").onclick = ()=>{
    addMissed(id);
    recordHistory({ts: nowISO(), mode:"case", drug:c.drug, population:c.population, result:"missed"});
    render();
  };
}

function render(){
  applySearch();
  if(MODE==="cards") renderCards();
  else if(MODE==="mcq") renderMCQ();
  else if(MODE==="typed") renderTyped();
  else renderCases();
}

function openDrawer(title, html){
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = html;
  $("#drawer").classList.remove("hidden");
}
function closeDrawer(){ $("#drawer").classList.add("hidden"); }

function escapeHTML(s){
  return (s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function escapeRegExp(str){
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function drugVariants(drug){
  if(!drug) return [];
  // Split "Name (Brand)" and also remove trailing descriptors like "Aerosolized Solution"
  const variants = new Set();
  const main = drug.split(" - ")[0].trim(); // defensive
  const parenMatch = main.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if(parenMatch){
    variants.add(parenMatch[1].trim());
    variants.add(parenMatch[2].trim());
  }else{
    variants.add(main);
  }
  // Also include first token before commas or slashes
  Array.from(variants).forEach(v=>{
    v.split("/").forEach(p=>variants.add(p.trim()));
    v.split(",").forEach(p=>variants.add(p.trim()));
  });
  // Remove very short variants and generic suffixes
  const bad = ["solution","mdi","aerosolized","metered-dose","inhaler","adult","pediatric","als","lals","bls"];
  return Array.from(variants)
    .map(v=>v.replace(/\s+/g," ").trim())
    .filter(v=>v.length >= 4)
    .filter(v=>!bad.includes(v.toLowerCase()));
}

function redactDrug(html, drug){
  let out = html || "";
  const vars = drugVariants(drug);
  vars.sort((a,b)=>b.length-a.length); // longest first to avoid partial overlap
  vars.forEach(v=>{
    const rx = new RegExp(`\\b${escapeRegExp(v)}\\b`, "gi");
    out = out.replace(rx, '<span class="redact">_____</span>');
  });
  return out;
}


async function init(){
  // Load data
  const res = await fetch("data/cards.json", {cache:"no-store"});
  ALL = (await res.json()).map(c => ({...c, id: normalize(c.drug)+"__"+normalize(c.population)}));
  FILTERED = ALL.slice();

  // Tabs
  $$(".tab").forEach(t=>{
    t.onclick = ()=>{
      $$(".tab").forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      MODE = t.dataset.mode;
      render();
    };
  });

  // Search
  $("#searchInput").addEventListener("input", (e)=>{
    searchTerm = e.target.value;
    CARD_IDX = 0;
    render();
  });

  // Drawer buttons
  $("#btnCloseDrawer").onclick = closeDrawer;
  $("#drawer").addEventListener("click", (e)=>{ if(e.target.id==="drawer") closeDrawer(); });

  $("#btnMissed").onclick = ()=>{
    const missed = new Set(loadJSON(LS.missed, []));
    const list = ALL.filter(c=>missed.has(makeId(c)));
    if(list.length===0){
      openDrawer("Missed", `<div class="muted">No missed items yet.</div>`);
      return;
    }
    const rows = list.map(c=>`<tr><td>${escapeHTML(c.drug)}</td><td>${escapeHTML(c.population)}</td><td><button class="btn secondary" data-jump="${makeId(c)}">Open</button></td></tr>`).join("");
    openDrawer("Missed", `<table class="table"><thead><tr><th>Drug</th><th>Pop</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
    $("#drawerBody").querySelectorAll("[data-jump]").forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.getAttribute("data-jump");
        const idx = FILTERED.findIndex(x=>makeId(x)===id);
        if(idx>=0){ CARD_IDX = idx; MODE="cards"; $$(".tab").forEach(x=>x.classList.remove("active")); $$('.tab[data-mode="cards"]')[0].classList.add("active"); }
        closeDrawer(); render();
      };
    });
  };

  $("#btnHistory").onclick = ()=>{
    const hist = loadJSON(LS.history, []);
    if(hist.length===0){
      openDrawer("History", `<div class="muted">No history yet.</div>`);
      return;
    }
    const rows = hist.slice(0,150).map(h=>{
      const t = new Date(h.ts).toLocaleString();
      return `<tr><td>${escapeHTML(t)}</td><td>${escapeHTML(h.mode)}</td><td>${escapeHTML(h.drug||"")}</td><td>${escapeHTML(h.population||"")}</td><td>${escapeHTML(h.result||"")}</td></tr>`;
    }).join("");
    openDrawer("History", `<table class="table"><thead><tr><th>Time</th><th>Mode</th><th>Drug</th><th>Pop</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`);
  };

  $("#btnReset").onclick = ()=>{
    if(!confirm("Reset missed + history for this browser?")) return;
    localStorage.removeItem(LS.missed);
    localStorage.removeItem(LS.history);
    render();
  };

  render();
}

init();
