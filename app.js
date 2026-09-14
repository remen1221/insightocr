(() => {
  const TARGETS = {
    1: { count: 10, listeners: 500, minutes: 20 * 60 },
    2: { count: 20, listeners: 800, minutes: 30 * 60 },
    3: { count: 35, listeners: 1200, minutes: 100 * 60 },
  };

  const state = { mode: 'solo', stage: 1, A: [], B: [], worker: null, workerPromise: null };
  const $ = (s) => document.querySelector(s);
  const els = {
    modeSelector: $('#modeSelector'), stageSelector: $('#stageSelector'), stageStart: $('#stageStart'), targetBox: $('#targetBox'),
    personBSection: $('#personBSection'), personABadge: $('#personABadge'), filesA: $('#filesA'), filesB: $('#filesB'), rowsA: $('#rowsA'), rowsB: $('#rowsB'),
    warnings: $('#warnings'), totals: $('#totals'), verdict: $('#verdict'), copyBtn: $('#copyBtn'), resetBtn: $('#resetBtn'), template: $('#rowTemplate')
  };

  function targetForCurrent() {
    const base = TARGETS[state.stage];
    if (state.mode === 'solo') return { ...base };
    return {
      count: Math.ceil(base.count * 1.5),
      listeners: Math.ceil(base.listeners * 1.5),
      minutes: Math.ceil(base.minutes * 1.5),
    };
  }

  function fmtMinutes(mins) {
    mins = Math.max(0, Math.round(Number(mins) || 0));
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}時間${m}分` : `${h}時間`;
  }

  function updateTargetBox() {
    const t = targetForCurrent();
    const comboNote = state.mode === 'duo' ? '（ソロ目標の1.5倍・配信回数は端数切り上げ）' : '';
    els.targetBox.innerHTML = `<strong>STAGE ${state.stage} の目標 ${comboNote}</strong><br>配信回数：${t.count}回　／　トータルリスナー：${t.listeners.toLocaleString()}人　／　配信時間：${fmtMinutes(t.minutes)}`;
  }

  els.modeSelector.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    state.mode = b.dataset.mode;
    [...els.modeSelector.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x === b));
    els.personBSection.classList.toggle('hidden', state.mode !== 'duo');
    els.personABadge.textContent = state.mode === 'solo' ? 'ソロ' : 'コンビA';
    els.personABadge.classList.toggle('blue', state.mode === 'duo');
    updateTargetBox(); recalc();
  });

  els.stageSelector.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-stage]'); if (!b) return;
    state.stage = Number(b.dataset.stage);
    [...els.stageSelector.querySelectorAll('button')].forEach(x => x.classList.toggle('active', x === b));
    updateTargetBox(); recalc();
  });

  els.stageStart.addEventListener('change', recalc);
  els.filesA.addEventListener('change', () => addFiles('A', [...els.filesA.files]));
  els.filesB.addEventListener('change', () => addFiles('B', [...els.filesB.files]));
  els.resetBtn.addEventListener('click', resetAll);
  els.copyBtn.addEventListener('click', copyResult);

  function resetAll() {
    state.A = []; state.B = []; els.rowsA.innerHTML = ''; els.rowsB.innerHTML = '';
    els.filesA.value = ''; els.filesB.value = ''; els.stageStart.value = ''; recalc();
  }

  async function getWorker() {
    if (state.worker) return state.worker;
    if (state.workerPromise) return state.workerPromise;
    if (!window.Tesseract) throw new Error('OCRライブラリを読み込めませんでした');
    state.workerPromise = (async () => {
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.',
        preserve_interword_spaces: '1',
      });
      state.worker = worker;
      return worker;
    })();
    return state.workerPromise;
  }

  async function addFiles(person, files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const item = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()), file, person, date: '', count: '', hours: '', minutes: '', listeners: '', status:'queued', excluded:false };
      state[person].push(item);
      createRow(item);
      processItem(item).catch(err => {
        item.status='error'; item.error=err.message || String(err); refreshRow(item); recalc();
      });
    }
    if (person==='A') els.filesA.value=''; else els.filesB.value='';
  }

  function createRow(item) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.querySelector('.filename').textContent = item.file.name;
    node.querySelector('.thumb').src = URL.createObjectURL(item.file);
    node.querySelector('.delete-row').addEventListener('click', () => {
      state[item.person] = state[item.person].filter(x => x.id !== item.id);
      node.remove(); recalc();
    });
    for (const cls of ['date','count','hours','minutes','listeners']) {
      node.querySelector('.'+cls).addEventListener('input', (e) => {
        item[cls] = e.target.value; item.status = 'edited'; refreshRow(item); recalc();
      });
    }
    (item.person==='A' ? els.rowsA : els.rowsB).appendChild(node);
    refreshRow(item);
  }

  function rowNode(item) { return document.querySelector(`.ocr-row[data-id="${CSS.escape(item.id)}"]`); }
  function refreshRow(item) {
    const row = rowNode(item); if (!row) return;
    row.querySelector('.date').value = item.date || '';
    row.querySelector('.count').value = item.count;
    row.querySelector('.hours').value = item.hours;
    row.querySelector('.minutes').value = item.minutes;
    row.querySelector('.listeners').value = item.listeners;
    const st = row.querySelector('.scan-status'); st.className='scan-status';
    if (item.status==='working') { st.textContent='読み取り中…'; st.classList.add('working'); }
    else if (item.status==='done') { st.textContent='自動読取済み'; st.classList.add('done'); }
    else if (item.status==='edited') { st.textContent='確認・修正済み'; st.classList.add('done'); }
    else if (item.status==='error') { st.textContent='要手入力'; st.classList.add('error'); }
    else st.textContent='読み取り待ち';
    row.querySelector('.row-warning').textContent = item.error || '';
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding='async'; img.src=url;
      await img.decode(); return img;
    } finally { setTimeout(()=>URL.revokeObjectURL(url),1000); }
  }

  function cropCanvas(img, rect, scale=3, threshold=true) {
    const sx = Math.round(img.naturalWidth * rect.x), sy = Math.round(img.naturalHeight * rect.y);
    const sw = Math.round(img.naturalWidth * rect.w), sh = Math.round(img.naturalHeight * rect.h);
    const c = document.createElement('canvas'); c.width = Math.max(1, sw*scale); c.height = Math.max(1, sh*scale);
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if (threshold) {
      const id=ctx.getImageData(0,0,c.width,c.height), d=id.data;
      for(let i=0;i<d.length;i+=4){ const g=.299*d[i]+.587*d[i+1]+.114*d[i+2]; const v=g>175?255:0; d[i]=d[i+1]=d[i+2]=v; }
      ctx.putImageData(id,0,0);
    }
    return c;
  }

  function digits(text) { return (text||'').replace(/[^0-9.]/g,' ').replace(/\s+/g,' ').trim(); }
  function firstInt(text) { const m=digits(text).match(/\d+/); return m ? Number(m[0]) : null; }

  function parseDate(text) {
    const s = digits(text).replace(/\s/g,'');
    const m = s.match(/(20\d{2})\.?([01]?\d)\.?([0-3]?\d)/);
    if (!m) return '';
    const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
    if (mo<1||mo>12||d<1||d>31) return '';
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function parseTime(text) {
    const nums = digits(text).match(/\d+/g)?.map(Number) || [];
    if (!nums.length) return {hours:null,minutes:null};
    if (nums.length===1) return {hours: nums[0], minutes:0};
    // Tight crop should contain the main hour/minute only. Keep sensible first pair.
    const plausible=[];
    for(let i=0;i<nums.length-1;i++) if(nums[i]>=0&&nums[i]<=24&&nums[i+1]>=0&&nums[i+1]<=59) plausible.push([nums[i],nums[i+1]]);
    const pair=plausible[0] || [nums[0],nums[1]];
    return {hours:pair[0],minutes:pair[1]};
  }

  async function recognize(canvas, psm='7') {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist:'0123456789.' });
    const { data:{ text } } = await worker.recognize(canvas);
    return text;
  }

  async function processItem(item) {
    item.status='working'; refreshRow(item);
    const img=await loadImage(item.file);
    // Coordinates are normalized for the Spoon daily Insight screenshot format supplied by the team.
    const regions = {
      date:      {x:.045,y:.325,w:.43,h:.055},
      count:     {x:.345,y:.525,w:.14,h:.055},
      time:      {x:.635,y:.525,w:.255,h:.06},
      listeners: {x:.335,y:.905,w:.16,h:.06},
    };
    const [dateText,countText,timeText,listenerText] = await Promise.all([
      recognize(cropCanvas(img,regions.date,3,true),'7'),
      recognize(cropCanvas(img,regions.count,4,true),'7'),
      recognize(cropCanvas(img,regions.time,4,true),'7'),
      recognize(cropCanvas(img,regions.listeners,4,true),'7'),
    ]);
    item.date = parseDate(dateText);
    const c=firstInt(countText), l=firstInt(listenerText), tm=parseTime(timeText);
    item.count = c ?? ''; item.listeners = l ?? ''; item.hours = tm.hours ?? ''; item.minutes = tm.minutes ?? '';
    item.status='done';
    const missing=[]; if(!item.date) missing.push('日付'); if(item.count==='') missing.push('配信回数'); if(item.hours==='') missing.push('配信時間'); if(item.listeners==='') missing.push('リスナー');
    item.error = missing.length ? `自動で読めなかった項目：${missing.join('・')}。手入力してください。` : '';
    refreshRow(item); recalc();
  }

  function validNum(v){ return v!=='' && v!==null && Number.isFinite(Number(v)) && Number(v)>=0; }
  function itemMinutes(item){ if(!validNum(item.hours)||!validNum(item.minutes)) return null; return Number(item.hours)*60 + Number(item.minutes); }

  function duplicateDates(items) {
    const map=new Map();
    for(const x of items){ if(!x.date) continue; map.set(x.date,(map.get(x.date)||0)+1); }
    return [...map.entries()].filter(([,n])=>n>1).map(([d])=>d);
  }

  function activeItems(items) {
    const start=els.stageStart.value;
    return items.map(x => ({...x, excluded: !!(start && x.date && x.date < start)}));
  }

  function summarize(items) {
    let count=0,listeners=0,minutes=0,usable=0;
    for(const x of activeItems(items)){
      if(x.excluded) continue;
      const mins=itemMinutes(x);
      if(validNum(x.count)&&validNum(x.listeners)&&mins!==null){ count+=Number(x.count); listeners+=Number(x.listeners); minutes+=mins; usable++; }
    }
    return {count,listeners,minutes,usable};
  }

  function recalc() {
    const a=summarize(state.A), b=summarize(state.B), t=targetForCurrent();
    const total = state.mode==='duo' ? {count:a.count+b.count,listeners:a.listeners+b.listeners,minutes:a.minutes+b.minutes,usable:a.usable+b.usable} : a;
    const warnings=[];
    const dupA=duplicateDates(state.A), dupB=duplicateDates(state.B);
    if(dupA.length) warnings.push(`A側で同じ日付の画像があります：${dupA.join(', ')}`);
    if(state.mode==='duo'&&dupB.length) warnings.push(`B側で同じ日付の画像があります：${dupB.join(', ')}`);
    const start=els.stageStart.value;
    if(start){
      const oldA=state.A.filter(x=>x.date&&x.date<start).length, oldB=state.B.filter(x=>x.date&&x.date<start).length;
      if(oldA+oldB) warnings.push(`開始日 ${start} より前の画像 ${oldA+oldB}枚は集計から除外しています。`);
    }
    const working=[...state.A,...(state.mode==='duo'?state.B:[])].filter(x=>x.status==='working'||x.status==='queued').length;
    if(working) warnings.push(`現在 ${working}枚を自動読み取り中です。`);
    els.warnings.innerHTML=warnings.map(w=>`<div class="alert warn">⚠️ ${escapeHtml(w)}</div>`).join('');

    const metrics=[
      ['配信回数', total.count, t.count, '回'],
      ['リスナー', total.listeners, t.listeners, '人'],
      ['配信時間', total.minutes, t.minutes, 'min'],
    ];
    els.totals.innerHTML = metrics.map(([name,val,goal,unit]) => {
      const ok=val>=goal; let vText, sub;
      if(unit==='min'){vText=fmtMinutes(val); sub=ok?`目標 ${fmtMinutes(goal)} 達成`:`あと ${fmtMinutes(goal-val)}`}
      else {vText=`${Number(val).toLocaleString()}${unit}`; sub=ok?`目標 ${Number(goal).toLocaleString()}${unit} 達成`:`あと ${Number(goal-val).toLocaleString()}${unit}`}
      return `<div class="metric ${ok?'ok':'miss'}"><div class="name">${name}</div><div class="value">${vText}</div><div class="sub">${sub}</div></div>`;
    }).join('');

    const enough = total.usable>0;
    const clear = enough && total.count>=t.count && total.listeners>=t.listeners && total.minutes>=t.minutes;
    if(!enough){ els.verdict.className='verdict waiting'; els.verdict.textContent='画像を追加し、読み取り結果を確認してください。'; els.copyBtn.disabled=true; }
    else if(clear){ els.verdict.className='verdict clear'; els.verdict.innerHTML=`🎉 STAGE ${state.stage} CLEAR！<br><span style="font-size:12px;font-weight:700">運営陣の最終確認後、次へ進めます。</span>`; els.copyBtn.disabled=false; }
    else { els.verdict.className='verdict notyet'; els.verdict.innerHTML=`あと少し！ STAGE ${state.stage} はまだ未達成です。`; els.copyBtn.disabled=false; }
    state.lastSummary={total,target:t,clear,enough,a,b};
  }

  function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  async function copyResult(){
    const s=state.lastSummary; if(!s||!s.enough) return;
    const t=s.target, x=s.total;
    const line=(name,val,goal,unit)=>{
      const ok=val>=goal; const rem=Math.max(0,goal-val);
      if(unit==='min') return `${name}：${fmtMinutes(val)} / ${fmtMinutes(goal)} ${ok?'✅':`→ あと${fmtMinutes(rem)}`}`;
      return `${name}：${Number(val).toLocaleString()} / ${Number(goal).toLocaleString()}${unit} ${ok?'✅':`→ あと${Number(rem).toLocaleString()}${unit}`}`;
    };
    const text=[
      `【STAGE ${state.stage} 判定｜${state.mode==='duo'?'コンビ':'ソロ'}】`,
      line('配信回数',x.count,t.count,'回'),
      line('トータルリスナー',x.listeners,t.listeners,'人'),
      line('配信時間',x.minutes,t.minutes,'min'),
      '', s.clear?`🎉 STAGE ${state.stage} CLEAR！`:`STAGE ${state.stage} はまだ未達成です。`,
      '※自動判定のため、最終確認は運営陣が行います。'
    ].join('\n');
    try{ await navigator.clipboard.writeText(text); const old=els.copyBtn.textContent; els.copyBtn.textContent='コピーしました！'; setTimeout(()=>els.copyBtn.textContent=old,1600); }
    catch{ prompt('この内容をコピーしてください',text); }
  }

  updateTargetBox(); recalc();
})();
