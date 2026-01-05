/* 本地版A：严格“点查询才更新” */
const FIXED_NOTICE = "非应届生：常州/无锡/苏州/镇江报考需要本市户籍，连云港限制本省户籍\n注意：这些地区的监狱岗位不限制户籍，如需报考请联系招生老师确认。";

const REGION_CITIES = ["江苏省属","南京","苏州","无锡","常州","镇江","南通","扬州","泰州","盐城","淮安","连云港","宿迁","徐州"];
const FORBID_NON_JS = ["常州","无锡","苏州","镇江","连云港"];
const FORBID_LYG = ["常州","无锡","苏州","镇江"];

let JOBS = [];
let MAJOR_MAP = {};
let applied = null;
let page = 1;
let lastFilteredAll = [];

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }

function eduLevel(v){
  // user level: 专科1 本科2 研究生3
  if(v==="专科") return 1;
  if(v==="本科") return 2;
  if(v==="研究生") return 3;
  return 0;
}
function jobEduMin(v){
  if(v==="研究生") return 3;
  if(v==="本科") return 2;
  return 0; // 高中(中专)及以上 或空
}

function getUserCats(edu, major){
  major = (major||"").trim();
  const map = MAJOR_MAP[edu] || {};
  return map[major] || [];
}

function parseJobMajorField(s){
  s = String(s||"").trim();
  if(!s) return { unlimited:false, cats:new Set(), majors:new Set() };
  if(s.includes("不限")) return { unlimited:true, cats:new Set(), majors:new Set() };
  // split
  const parts = s.split(/[，、；;\n\r\t]+/).map(x=>x.trim()).filter(Boolean);
  const cats=new Set(), majors=new Set();
  for(const p of parts){
    if(p.endsWith("类")) cats.add(p);
    else majors.add(p);
  }
  return { unlimited:false, cats, majors };
}

function isPrison(job){
  const s = (job["单位名称"]||"") + " " + (job["职位名称"]||"");
  return /监狱|戒毒|看守所/.test(s);
}

function buildDraft(){
  const edu = $("jEdu").value;
  const major = $("jMajor").value.trim();
  const grad = $("grad").value || ""; // 是/否/""
  const hukouProv = $("hukouProv").value || "";
  const hukouCity = $("hukouCity").value || "";
  return {
    edu, major,
    gender: $("gender").value || "",
    party: $("party").value || "", // 是/否/""
    baseService: $("baseService").value || "", // 是/否/""
    grad, hukouProv, hukouCity,
    region: $("region").value || "",
    kw: $("kw").value.trim(),
    examType: $("examType").value || "",
    majorUnlimited: $("majorUnlimited").value || "",
    onlyGradJobs: $("onlyGradJobs").checked,
    pageSize: parseInt($("pageSize").value,10) || 20,
  };
}

function normalizeProfile(d){
  const isGrad = d.grad==="是";
  const isNonGrad = d.grad==="否" || d.grad==="";
  const prov = d.hukouProv;
  const isNonJS = (prov==="非江苏");
  const isJS = (prov==="江苏");
  const city = isJS ? d.hukouCity : "";
  const isLYG = isJS && city==="连云港";
  return { ...d, isGrad, isNonGrad, isNonJS, isJS, city, isLYG };
}

function allowedCities(profile){
  // region dropdown options
  if(profile.isGrad) return REGION_CITIES.slice();
  if(profile.isNonJS) return REGION_CITIES.filter(x=>!FORBID_NON_JS.includes(x));
  if(profile.isLYG) return REGION_CITIES.filter(x=>!FORBID_LYG.includes(x));
  return REGION_CITIES.slice();
}

function shouldAutoExcludeCity(profile, city){
  if(profile.isGrad) return false;
  if(profile.isNonJS) return FORBID_NON_JS.includes(city);
  if(profile.isLYG) return FORBID_LYG.includes(city);
  return false;
}

function refreshRegionOptions(profile){
  const sel = $("region");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部（按规则自动隐藏部分城市）</option>';
  for(const c of allowedCities(profile)){
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(c)}">${esc(c)}</option>`);
  }
  // restore if still allowed
  const allowed = new Set([""].concat(allowedCities(profile)));
  sel.value = allowed.has(cur) ? cur : "";
}

function refreshNotice(profile){
  const box = $("fixedNotice");
  const need = profile.isNonGrad && (profile.isNonJS || profile.isLYG);
  box.style.display = need ? "block" : "none";
  if(need) box.textContent = FIXED_NOTICE;
}

function updateHukouUI(profile){
  // if 江苏 enable city select, else disable
  const citySel = $("hukouCity");
  const enable = profile.hukouProv==="江苏" && !profile.isGrad;
  citySel.disabled = !enable;
  if(!enable) citySel.value = "";
  // if 应届 disable hukou controls (optional)
  if(profile.isGrad){
    $("hukouProv").value = "";
    citySel.value = "";
    citySel.disabled = true;
  }
}

function recomputeCats(){
  const edu=$("jEdu").value;
  const major=$("jMajor").value.trim();
  const cats = getUserCats(edu, major);
  $("jCats").value = cats.join("，");
  return cats;
}

function filterJobs(draft){
  const profile = normalizeProfile(draft);
  const userLvl = eduLevel(profile.edu);
  const cats = getUserCats(profile.edu, profile.major);
  const kw = profile.kw.toLowerCase();

  const region = profile.region;
  const onlyUnlimited = profile.majorUnlimited==="是";
  const examType = profile.examType;

  const res = [];
  let hiddenPrisonCount = 0;

  for(const job of JOBS){
    const city = job["意向城市匹配项"] || "";
    // auto exclude cities per your business rule (including prisons)
    if(shouldAutoExcludeCity(profile, city)){
      if(isPrison(job)) hiddenPrisonCount++;
      continue;
    }

    // region filter
    if(region){
      if(region==="江苏省属"){
        const aff = job["隶属关系"]||"";
        const area = job["地区名称"]||"";
        if(!(aff==="省" || aff==="垂直" || String(area).includes("江苏省"))) continue;
      }else{
        if(city !== region) continue;
      }
    }

    // exam type
    if(examType && (job["考试类别"]||"")!==examType) continue;

    // keyword
    if(kw){
      const blob = ((job["单位名称"]||"") + " " + (job["职位名称"]||"") + " " + (job["职位简介"]||"")).toLowerCase();
      if(!blob.includes(kw)) continue;
    }

    // education
    const min = jobEduMin(job["学历"]);
    if(userLvl < min) continue; // 研究生向下兼容自然满足

    // grad
    const j2026 = (job["是否2026"]||"").trim();
    if(profile.isGrad){
      if(profile.onlyGradJobs && j2026!=="是") continue;
    }else{
      // 非应届（或不确定按非应届）
      if(j2026==="是") continue;
    }

    // gender
    const g = (job["性别匹配项"]||"").trim() || "不限";
    if(g!=="不限"){
      if(!profile.gender) continue;
      if(profile.gender !== g) continue;
    }

    // party
    const p = (job["党员匹配项"]||"").trim() || "否";
    if(p==="是"){
      if(profile.party!=="是") continue; // 不确定也不放行
    }

    // base service
    const bs = (job["基层服务匹配项"]||"").trim() || "否";
    if(bs==="是"){
      if(profile.baseService!=="是") continue; // 不确定/否 不放行
    }

    // hukou
    if(!profile.isGrad){
      const req = (job["户籍匹配项"]||"").trim() || "不限";
      if(req==="江苏"){
        if(profile.hukouProv!=="江苏") continue;
      }else if(req==="常州"||req==="无锡"||req==="苏州"||req==="镇江"){
        if(profile.hukouProv!=="江苏") continue;
        if(profile.city!==req) continue;
      }
    }

    // major
    const parsed = parseJobMajorField(job["专业"]);
    if(!parsed.unlimited){
      const major = profile.major;
      let ok = false;
      if(major && parsed.majors.has(major)) ok = true;
      if(!ok && cats.length){
        for(const c of cats){
          if(parsed.cats.has(c)){ ok = true; break; }
        }
      }
      if(!ok) continue;
    }

    // only major unlimited
    if(onlyUnlimited){
      const parsed2 = parseJobMajorField(job["专业"]);
      if(!parsed2.unlimited) continue;
    }

    res.push(job);
  }

  // sort: 地区 → 招考人数(降序) → 职位代码
  res.sort((a,b)=>{
    const ca=(a["意向城市匹配项"]||"").localeCompare(b["意向城市匹配项"]||"","zh");
    if(ca!==0) return ca;
    const na=Number(a["招考人数"]||0), nb=Number(b["招考人数"]||0);
    if(nb!==na) return nb-na;
    return String(a["职位代码"]||"").localeCompare(String(b["职位代码"]||""));
  });

  return { res, cats, hiddenPrisonCount };
}

function render(){
  if(!applied){
    $("results").innerHTML = "";
    $("pager").style.display="none";
    $("countBadge").textContent="未查询";
    $("btnExport").disabled = true;
    $("hint").textContent="";
    return;
  }
  const pageSize = applied.pageSize;
  const total = lastFilteredAll.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if(page>pages) page=pages;
  const start = (page-1)*pageSize;
  const slice = lastFilteredAll.slice(start, start+pageSize);

  $("countBadge").textContent = `共 ${total} 条（第 ${page}/${pages} 页）`;
  $("btnExport").disabled = total===0;

  let html = `
    <table>
      <thead><tr>
        <th style="width:130px">地区</th>
        <th style="width:220px">单位</th>
        <th>职位</th>
        <th style="width:80px">人数</th>
        <th style="width:140px">考试类别</th>
        <th style="width:180px">匹配说明</th>
      </tr></thead>
      <tbody>
  `;
  for(const j of slice){
    const city = j["意向城市匹配项"]||"";
    const unit = j["单位名称"]||"";
    const pos = j["职位名称"]||"";
    const num = j["招考人数"]||"";
    const exam = j["考试类别"]||"";
    const explain = buildExplain(j, applied);
    html += `
      <tr>
        <td>${esc(city)}${esc(city? "": "")}</td>
        <td>${esc(unit)}</td>
        <td>
          <details>
            <summary><b>${esc(pos)}</b> <span class="small">（点击展开岗位信息）</span></summary>
            ${renderJobDetails(j)}
          </details>
        </td>
        <td>${esc(num)}</td>
        <td>${esc(exam)}</td>
        <td class="small">${explain}</td>
      </tr>
    `;
  }
  html += "</tbody></table>";
  $("results").innerHTML = html;

  // pager
  const pager = $("pager");
  pager.style.display = "flex";
  pager.innerHTML = `
    <button ${page<=1?'disabled':''} id="prev">上一页</button>
    <span class="small">跳转</span>
    <select id="jump">${Array.from({length:pages},(_,i)=>`<option value="${i+1}" ${i+1===page?'selected':''}>${i+1}</option>`).join("")}</select>
    <button ${page>=pages?'disabled':''} id="next">下一页</button>
  `;
  $("prev")?.addEventListener("click", ()=>{ page=Math.max(1,page-1); render(); });
  $("next")?.addEventListener("click", ()=>{ page=Math.min(pages,page+1); render(); });
  $("jump")?.addEventListener("change", (e)=>{ page=parseInt(e.target.value,10); render(); });
}

function buildExplain(job, appliedDraft){
  const profile = normalizeProfile(appliedDraft);
  const cats = getUserCats(profile.edu, profile.major);
  const majorParsed = parseJobMajorField(job["专业"]);
  let mHit="专业不限";
  if(!majorParsed.unlimited){
    if(majorParsed.majors.has(profile.major)) mHit="专业名命中";
    else if(cats.some(c=>majorParsed.cats.has(c))) mHit="专业大类命中";
    else mHit="（未命中）";
  }
  const eduOk = `学历：${profile.edu} ≥ 岗位要求${job["学历"]||"不限"}`;
  const g = (job["性别匹配项"]||"").trim()||"不限";
  const genderOk = g==="不限" ? "性别：不限" : `性别：限${g}（你：${profile.gender||"未填"}）`;
  const partyReq = (job["党员匹配项"]||"").trim()||"否";
  const partyOk = partyReq==="是" ? `党员：要求（你：${profile.party||"未填"}）` : "党员：不要求";
  const gradReq = (job["是否2026"]||"").trim()==="是" ? "应届岗" : "非应届岗";
  const hukouReq = (job["户籍匹配项"]||"").trim()||"不限";
  const hukouOk = profile.isGrad ? "户籍：应届生豁免" : `户籍：${hukouReq}`;
  const bsReq = (job["基层服务匹配项"]||"").trim()||"否";
  const bsOk = bsReq==="是" ? `基层服务：要求（你：${profile.baseService||"未填"}）` : "基层服务：不要求";
  return [mHit, eduOk, gradReq, genderOk, partyOk, bsOk, hukouOk].join("<br/>");
}

function renderJobDetails(j){
  // 只展示到“其它”为止；后续匹配项为内部辅助字段不对学员展示
  const keys = ["隶属关系","地区代码","地区名称","单位代码","单位名称","职位代码","职位名称","职位简介","考试类别","开考比例","招考人数","学历","专业","其它"];
  let rows = "";
  for(const k of keys){
    if(!(k in j)) continue;
    rows += `<tr><th style="width:160px">${esc(k)}</th><td>${esc(j[k])}</td></tr>`;
  }
  return `<div style="margin-top:10px"><table><tbody>${rows}</tbody></table></div>`;
}

function exportExcel(){
  // Export current filtered results as .xls (HTML table). Excel can open.
  const rows = lastFilteredAll;
  if(!rows.length) return;

  const cols = Object.keys(rows[0]);
  let table = "<table><tr>" + cols.map(c=>`<th>${esc(c)}</th>`).join("") + "</tr>";
  for(const r of rows){
    table += "<tr>" + cols.map(c=>`<td>${esc(r[c])}</td>`).join("") + "</tr>";
  }
  table += "</table>";
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  const blob = new Blob([html], {type:"application/vnd.ms-excel;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0,10);
  a.download = `岗位筛选结果_${stamp}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindUI(){
  // tabs with aria support
  $("tabMajor").addEventListener("click", ()=>{
    $("tabMajor").classList.add("active"); 
    $("tabJobs").classList.remove("active");
    $("tabMajor").setAttribute("aria-selected", "true");
    $("tabJobs").setAttribute("aria-selected", "false");
    $("panelMajor").style.display="block"; 
    $("panelJobs").style.display="none";
  });
  $("tabJobs").addEventListener("click", ()=>{
    $("tabJobs").classList.add("active"); 
    $("tabMajor").classList.remove("active");
    $("tabJobs").setAttribute("aria-selected", "true");
    $("tabMajor").setAttribute("aria-selected", "false");
    $("panelJobs").style.display="block"; 
    $("panelMajor").style.display="none";
  });

  // major query with loading state
  $("btnMajor").addEventListener("click", ()=>{
    const btn = $("btnMajor");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> 查询中...';
    
    setTimeout(() => {
      const edu = $("mEdu").value;
      const major = $("mMajor").value.trim();
      const cats = getUserCats(edu, major);
      const output = $("majorOut");
      output.classList.add("fade-in");
      output.innerHTML = cats.length
        ? `<div class="notice">所属大类：${cats.map(c=>`<span class="badge">${esc(c)}</span>`).join(" ")}<\/div>`
        : `<div class="notice">未在专业目录中找到该专业（需精确匹配）。<\/div>`;
      // sync to jobs panel
      $("jEdu").value = edu;
      $("jMajor").value = major;
      $("jCats").value = cats.join("，");
      
      btn.disabled = false;
      btn.textContent = originalText;
    }, 300);
  });

  // hukou/prov/grad changes affect UI only (no auto query)
  const syncUi = ()=>{
    const d = buildDraft();
    const p = normalizeProfile(d);
    updateHukouUI(p);
    refreshNotice(p);
    refreshRegionOptions(p);
    // only-grad toggle enabled only if isGrad
    $("onlyGradJobs").disabled = !p.isGrad;
    if(!p.isGrad) $("onlyGradJobs").checked = false;
  };
  ["grad","hukouProv","hukouCity"].forEach(id=>$(id).addEventListener("change", syncUi));
  syncUi();

  // query with loading state
  $("btnQuery").addEventListener("click", ()=>{
    const btn = $("btnQuery");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> 查询中...';
    
    setTimeout(() => {
      applied = buildDraft();
      // update cats display now
      const cats = getUserCats(applied.edu, applied.major);
      $("jCats").value = cats.join("，");
      const out = filterJobs(applied);
      lastFilteredAll = out.res;
      page = 1;
      // hint for hidden prison counts
      const prof = normalizeProfile(applied);
      let hint = "";
      if(prof.isNonGrad && (prof.isNonJS || prof.isLYG)){
        hint = `已按户籍策略隐藏部分地区岗位。`;
        if(out.hiddenPrisonCount>0){
          hint += `（其中监狱相关岗位被隐藏：${out.hiddenPrisonCount} 条）`;
        }
      }
      $("hint").textContent = hint;
      render();
      
      btn.disabled = false;
      btn.textContent = originalText;
      
      // Scroll to results
      if(lastFilteredAll.length > 0) {
        $("results").scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 400);
  });

  $("btnReset").addEventListener("click", ()=>{
    // reset to defaults
    $("jEdu").value="本科";
    $("jMajor").value="";
    $("jCats").value="";
    $("gender").value="";
    $("party").value="";
    $("baseService").value="";
    $("grad").value="";
    $("hukouProv").value="";
    $("hukouCity").value="";
    $("region").value="";
    $("kw").value="";
    $("examType").value="";
    $("majorUnlimited").value="";
    $("onlyGradJobs").checked=false;
    $("pageSize").value="20";
    applied=null;
    lastFilteredAll=[];
    page=1;
    const d=buildDraft(); const p=normalizeProfile(d);
    updateHukouUI(p); refreshNotice(p); refreshRegionOptions(p);
    render();
  });

  $("btnExport").addEventListener("click", exportExcel);
}

async function init(){
  const jobs = await fetch("./data/jobs.json").then(r=>r.json());
  const mm = await fetch("./data/major_map.json").then(r=>r.json());
  JOBS = jobs;
  MAJOR_MAP = mm;

  // exam types
  const types = Array.from(new Set(JOBS.map(j=>j["考试类别"]).filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b),"zh"));
  const sel = $("examType");
  for(const t of types){
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(t)}">${esc(t)}</option>`);
  }

  // region options initial
  const d = buildDraft(); const p=normalizeProfile(d);
  refreshRegionOptions(p);
  bindUI();
}

init();
