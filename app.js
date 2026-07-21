const levelFor=s=>s<30?'Normal':s<50?'Monitor':s<70?'Watch':s<85?'Elevated':'Severe';
let signalData=null;
let saved=new Set(JSON.parse(localStorage.getItem('signal5-watchlist')||'[]'));

const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function updateStats(){
  document.getElementById('tracked-count').textContent=signalData.categories.length;
  document.getElementById('elevated-count').textContent=signalData.categories.filter(x=>x.score>=50).length;
  document.getElementById('saved-count').textContent=saved.size;
  document.getElementById('source-count').textContent=signalData.sourceGroups||0;
}

function renderSignals(){
  const query=document.getElementById('signal-search').value.trim().toLowerCase();
  const minimum=Number(document.getElementById('level-filter').value);
  const savedOnly=document.getElementById('saved-filter').checked;
  const items=signalData.categories.filter(item=>{
    const haystack=[item.name,item.summary,item.changed,item.matters].join(' ').toLowerCase();
    return item.score>=minimum&&(!query||haystack.includes(query))&&(!savedOnly||saved.has(item.name));
  });
  const grid=document.getElementById('category-grid');
  grid.innerHTML=items.map(item=>{
    const delta=item.delta||0;
    const trendClass=delta>0?'trend-up':delta<0?'trend-down':'';
    const trend=delta>0?`↑ ${delta}`:delta<0?`↓ ${Math.abs(delta)}`:'—';
    return `<article class="signal-card" data-name="${escapeHtml(item.name)}">
      <div class="signal-main" tabindex="0" role="button" aria-expanded="false">
        <div class="signal-top"><div><div class="signal-name">${escapeHtml(item.name)}</div><div class="signal-level">${levelFor(item.score)}</div></div><div class="signal-score">${item.score}</div></div>
        <div class="meter"><span style="width:${item.score}%"></span></div>
        <p class="signal-summary">${escapeHtml(item.summary)}</p>
        <div class="trend-row"><span>7-day movement</span><strong class="${trendClass}">${trend}</strong></div>
        <div class="details"><strong>WHAT CHANGED</strong><p>${escapeHtml(item.changed)}</p><strong>WHY IT MATTERS</strong><p>${escapeHtml(item.matters)}</p><strong>CONFIDENCE</strong><p>${escapeHtml(item.confidence)}</p><strong>SOURCE GROUPS</strong><p>${escapeHtml((item.sources||[]).join(', '))}</p></div>
      </div>
      <button class="save-button ${saved.has(item.name)?'saved':''}" aria-label="${saved.has(item.name)?'Remove from':'Save to'} watchlist">${saved.has(item.name)?'★':'☆'}</button>
    </article>`;
  }).join('');
  document.getElementById('result-count').textContent=`Showing ${items.length} of ${signalData.categories.length} signals`;
  document.getElementById('empty-state').hidden=items.length!==0;

  grid.querySelectorAll('.signal-main').forEach(main=>{
    const toggle=()=>{const card=main.closest('.signal-card');card.classList.toggle('open');main.setAttribute('aria-expanded',card.classList.contains('open'))};
    main.addEventListener('click',toggle);
    main.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
  });
  grid.querySelectorAll('.save-button').forEach(button=>button.addEventListener('click',()=>{
    const name=button.closest('.signal-card').dataset.name;
    saved.has(name)?saved.delete(name):saved.add(name);
    localStorage.setItem('signal5-watchlist',JSON.stringify([...saved]));
    updateStats();renderSignals();
  }));
}

async function loadSignal(){
  const response=await fetch('data.json');
  if(!response.ok)throw new Error('Data unavailable');
  signalData=await response.json();
  document.getElementById('overall-score').textContent=signalData.overall.score;
  document.getElementById('overall-level').textContent=signalData.overall.level||levelFor(signalData.overall.score);
  document.getElementById('overall-summary').textContent=signalData.overall.summary;
  document.getElementById('overall-confidence').textContent=`${signalData.overall.confidence} confidence`;
  document.getElementById('updated').textContent=`Updated ${signalData.updated}`;
  document.getElementById('change-list').innerHTML=signalData.changes.map(item=>`<article class="change-item"><div class="change-tag">${escapeHtml(item.category)}</div><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="change-direction">${escapeHtml(item.direction)}</div></article>`).join('');
  updateStats();renderSignals();
}

['signal-search','level-filter','saved-filter'].forEach(id=>document.getElementById(id).addEventListener('input',renderSignals));
document.getElementById('reset-filters').addEventListener('click',()=>{document.getElementById('signal-search').value='';document.getElementById('level-filter').value='0';document.getElementById('saved-filter').checked=false;renderSignals()});

document.getElementById('copy-brief').addEventListener('click',async()=>{
  const text=`Signal 5 daily brief — ${signalData.updated}\nOverall: ${signalData.overall.score}/100 (${signalData.overall.level})\n\n${signalData.changes.map(x=>`${x.category}: ${x.title} (${x.direction}) — ${x.detail}`).join('\n')}`;
  try{await navigator.clipboard.writeText(text);document.getElementById('copy-brief').textContent='Copied';setTimeout(()=>document.getElementById('copy-brief').textContent='Copy daily brief',1600)}catch{alert(text)}
});

document.getElementById('alert-form').addEventListener('submit',e=>{
  e.preventDefault();
  const preference={email:document.getElementById('alert-email').value,threshold:document.getElementById('alert-threshold').value};
  localStorage.setItem('signal5-alert-preference',JSON.stringify(preference));
  document.getElementById('alert-message').textContent='Preference saved on this device. Email sending is not active yet.';
});

const priorAlert=JSON.parse(localStorage.getItem('signal5-alert-preference')||'null');
if(priorAlert){document.getElementById('alert-email').value=priorAlert.email||'';document.getElementById('alert-threshold').value=priorAlert.threshold||'Watch and above'}

const root=document.documentElement;
const savedTheme=localStorage.getItem('signal5-theme');
if(savedTheme)root.dataset.theme=savedTheme;
document.getElementById('theme-toggle').addEventListener('click',()=>{const next=root.dataset.theme==='light'?'dark':'light';root.dataset.theme=next;localStorage.setItem('signal5-theme',next)});

loadSignal().catch(err=>{document.getElementById('overall-level').textContent='Unable to load data';document.getElementById('overall-summary').textContent='Run the site through a local or web server so data.json can load.';console.error(err)});
