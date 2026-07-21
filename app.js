const levelFor=s=>s<30?'Normal':s<50?'Monitor':s<70?'Watch':s<85?'Elevated':'Severe';
let signalData=null,historyData=null,deferredInstall=null;
let saved=new Set(JSON.parse(localStorage.getItem('signal5-watchlist')||'[]'));
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

const PROFILE_KEY='signal5-profile-v1';
const PRESETS={
  all:[],
  operations:['Economy','Supply Chains','Infrastructure','Energy','Weather','Cybersecurity'],
  household:['Economy','Energy','Public Safety','Weather','Earthquakes'],
  technology:['Infrastructure','Cybersecurity','Space Weather'],
  custom:[]
};
function defaultProfile(){
  return {name:'My dashboard',preset:'all',watchlist:[...saved],defaultThreshold:Number(localStorage.getItem('signal5-threshold')||50),thresholds:{},lastAlerted:{}};
}
function loadProfile(){
  try{return {...defaultProfile(),...JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}')}}
  catch{return defaultProfile()}
}
let profile=loadProfile();
saved=new Set(profile.watchlist||[...saved]);
function saveProfile(message='Preferences saved on this device.'){
  profile.watchlist=[...saved];
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  localStorage.setItem('signal5-watchlist',JSON.stringify([...saved]));
  localStorage.setItem('signal5-threshold',String(profile.defaultThreshold||50));
  if($('workspace-message'))$('workspace-message').textContent=message;
}
function thresholdFor(name){return Number(profile.thresholds?.[name]??profile.defaultThreshold??50)}
function activePresetNames(){
  if(profile.preset==='custom')return [...saved];
  const names=PRESETS[profile.preset]||[];
  return names.length?names:null;
}
function renderThresholds(){
  const names=[...saved].sort();
  $('threshold-list').innerHTML=names.length?names.map(name=>`
    <label><span>${escapeHtml(name)}</span><select data-threshold-name="${escapeHtml(name)}">
      ${[30,50,70,85].map(v=>`<option value="${v}" ${thresholdFor(name)===v?'selected':''}>${levelFor(v)} (${v}+)</option>`).join('')}
    </select></label>`).join(''):'<div class="empty-state">Save signals with the star button to configure individual thresholds.</div>';
  document.querySelectorAll('[data-threshold-name]').forEach(select=>select.addEventListener('change',()=>{
    profile.thresholds[select.dataset.thresholdName]=Number(select.value);saveProfile();renderSignals();renderAlertCenter();
  }));
}
function currentHits(){
  if(!signalData)return[];
  return signalData.categories.filter(x=>saved.has(x.name)&&x.score>=thresholdFor(x.name)).sort((a,b)=>b.score-a.score);
}
function renderAlertCenter(){
  const hits=currentHits();
  $('alert-center').innerHTML=hits.length?hits.map(x=>`<div class="alert-hit"><strong>${escapeHtml(x.name)}</strong><span>${x.score}/100 · ${levelFor(x.score)}</span><small>Threshold ${thresholdFor(x.name)}+</small></div>`).join(''):'<div class="alert-clear"><strong>No saved thresholds crossed.</strong><span>Your current watchlist is below its configured alert levels.</span></div>';
}
function maybeNotify(){
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  const hits=currentHits(),stamp=signalData.generatedAt||signalData.updated;
  const fresh=hits.filter(x=>profile.lastAlerted?.[x.name]!==stamp);
  if(!fresh.length)return;
  const body=fresh.slice(0,3).map(x=>`${x.name}: ${x.score}`).join(' · ')+(fresh.length>3?` · +${fresh.length-3} more`:'');
  new Notification('Signal 5 threshold crossed',{body,icon:'icon.svg'});
  profile.lastAlerted={...(profile.lastAlerted||{}),...Object.fromEntries(fresh.map(x=>[x.name,stamp]))};saveProfile('');
}
function renderWorkspace(){
  $('workspace-name').value=profile.name||'My dashboard';
  $('workspace-preset').value=profile.preset||'all';
  renderThresholds();renderAlertCenter();
}
function downloadProfile(){
  const safe={version:1,exportedAt:new Date().toISOString(),profile:{...profile,watchlist:[...saved],lastAlerted:{}}};
  const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='signal5-preferences.json';a.click();URL.revokeObjectURL(a.href);
}
function restoreProfile(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result),incoming=parsed.profile||parsed;
      profile={...defaultProfile(),...incoming,thresholds:{...(incoming.thresholds||{})},lastAlerted:{}};
      saved=new Set(profile.watchlist||[]);
      saveProfile('Preferences restored successfully.');renderWorkspace();updateStats();renderSignals();
    }catch{$('workspace-message').textContent='That file is not a valid Signal 5 preference backup.'}
  };
  reader.readAsText(file);
}
function printReport(){
  document.body.classList.add('print-report');
  window.print();
  setTimeout(()=>document.body.classList.remove('print-report'),500);
}

function briefText(){return `Signal 5 daily brief — ${signalData.updated}\nOverall: ${signalData.overall.score}/100 (${signalData.overall.level||levelFor(signalData.overall.score)})\n\n${signalData.changes.map(x=>`${x.category}: ${x.title} (${x.direction}) — ${x.detail}`).join('\n')}\n\n${location.href}`;}
function updateStats(){
  $('tracked-count').textContent=signalData.categories.length;
  $('elevated-count').textContent=signalData.categories.filter(x=>x.score>=50).length;
  $('saved-count').textContent=saved.size;
  $('source-count').textContent=signalData.sourceGroups||0;
}
function renderSignals(){
  const query=$('signal-search').value.trim().toLowerCase(),minimum=Number($('level-filter').value),savedOnly=$('saved-filter').checked;
  const presetNames=activePresetNames();
  const items=signalData.categories.filter(item=>{
    const haystack=[item.name,item.summary,item.changed,item.matters,(item.sources||[]).join(' ')].join(' ').toLowerCase();
    return item.score>=minimum&&(!query||haystack.includes(query))&&(!savedOnly||saved.has(item.name))&&(!presetNames||presetNames.includes(item.name));
  });
  $('category-grid').innerHTML=items.map(item=>{
    const delta=Number(item.delta||0),trendClass=delta>0?'trend-up':delta<0?'trend-down':'',trend=delta>0?`↑ ${delta}`:delta<0?`↓ ${Math.abs(delta)}`:'—';
    const sourceState=item.status==='live'?'LIVE':item.status==='partial'?'PARTIAL':'BASELINE';
    const highlighted=saved.has(item.name)&&item.score>=thresholdFor(item.name)?' threshold-hit':'';
    return `<article class="signal-card${highlighted}" data-name="${escapeHtml(item.name)}">
      <div class="signal-main" tabindex="0" role="button" aria-expanded="false">
        <div class="signal-top"><div><div class="signal-name">${escapeHtml(item.name)}</div><div class="signal-level">${levelFor(item.score)} · <span class="data-state">${sourceState}</span></div></div><div class="signal-score">${item.score}</div></div>
        <div class="meter"><span style="width:${clamp(item.score,0,100)}%"></span></div>
        <p class="signal-summary">${escapeHtml(item.summary)}</p>
        <div class="trend-row"><span>7-day movement</span><strong class="${trendClass}">${trend}</strong></div>
        <div class="details"><strong>WHAT CHANGED</strong><p>${escapeHtml(item.changed)}</p><strong>WHY IT MATTERS</strong><p>${escapeHtml(item.matters)}</p><strong>CONFIDENCE</strong><p>${escapeHtml(item.confidence)}</p><strong>SOURCES</strong><p>${(item.sourceDetails||[]).length?item.sourceDetails.map(s=>`<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener"><strong>${escapeHtml(s.name)}</strong></a><br>${escapeHtml(s.detail||'')}<br><small>Observed ${escapeHtml(s.observed||'unknown')}</small>`).join('<br><br>'):escapeHtml((item.sources||[]).join(', '))}</p></div>
      </div><button class="save-button ${saved.has(item.name)?'saved':''}" aria-label="${saved.has(item.name)?'Remove from':'Save to'} watchlist">${saved.has(item.name)?'★':'☆'}</button>
    </article>`;
  }).join('');
  $('result-count').textContent=`Showing ${items.length} of ${signalData.categories.length} signals`;
  $('empty-state').hidden=items.length!==0;
  document.querySelectorAll('.signal-main').forEach(main=>{
    const toggle=()=>{const card=main.closest('.signal-card');card.classList.toggle('open');main.setAttribute('aria-expanded',card.classList.contains('open'))};
    main.addEventListener('click',toggle);main.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
  });
  document.querySelectorAll('.save-button').forEach(button=>button.addEventListener('click',()=>{
    const name=button.closest('.signal-card').dataset.name;saved.has(name)?saved.delete(name):saved.add(name);
    saveProfile();updateStats();renderSignals();renderThresholds();renderAlertCenter();
  }));
}

function renderIntelligence(){
  const intel=signalData.intelligence||{};
  $('brief-direction').textContent=intel.direction||'Stable';
  $('brief-title').textContent=intel.title||'No material movement detected';
  $('brief-summary').textContent=intel.summary||'The current evidence does not show a material change from the prior observation.';
  const drivers=intel.drivers||[];
  $('brief-drivers').innerHTML=drivers.length?drivers.map((d,i)=>`
    <article class="driver-card">
      <span class="driver-rank">${i+1}</span>
      <div><strong>${escapeHtml(d.category)}</strong><p>${escapeHtml(d.explanation)}</p>
      <small>${escapeHtml(d.sourceName||'Source unavailable')} · observed ${escapeHtml(d.observed||'unknown')}</small></div>
      <div class="driver-change ${Number(d.change)>=0?'trend-up':'trend-down'}">${Number(d.change)>=0?'+':''}${Number(d.change).toFixed(1)}</div>
    </article>`).join(''):'<div class="empty-state">No material drivers were identified in this refresh.</div>';
  const audit=intel.audit||{};
  $('assessment-audit').innerHTML=[
    ['Evidence-backed drivers',audit.driverCount??drivers.length],
    ['Live or partial categories',audit.activeCategoryCount??signalData.categories.filter(x=>x.status!=='baseline').length],
    ['Failed source groups',audit.failedSourceGroups??signalData.sourceHealth?.failed??0],
    ['Method',intel.method||'Structured deterministic synthesis']
  ].map(([label,value])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('intelligence-badge').textContent=audit.failedSourceGroups?'REDUCED EVIDENCE':'EVIDENCE LINKED';
  $('intelligence-badge').classList.toggle('warning',Number(audit.failedSourceGroups)>0);
}

function renderChanges(){
  $('change-list').innerHTML=(signalData.changes||[]).map(item=>`<article class="change-item"><div class="change-tag">${escapeHtml(item.category)}</div><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="change-direction">${escapeHtml(item.direction)}</div></article>`).join('')||'<div class="empty-state">No material changes are listed for this refresh.</div>';
}
function renderSources(){
  const categories=signalData.categories||[],live=categories.filter(x=>x.status==='live').length,partial=categories.filter(x=>x.status==='partial').length,baseline=categories.length-live-partial;
  const health=signalData.sourceHealth||{},failed=Number(health.failed||0);
  $('source-health-badge').textContent=failed?'REDUCED':'OPERATIONAL';
  $('source-health-badge').classList.toggle('warning',failed>0);
  $('source-health').innerHTML=[
    ['Live categories',live,'Updated directly from connected public feeds.'],
    ['Partial categories',partial,'Some current evidence is available; confidence is reduced.'],
    ['Baseline categories',baseline,'Using preserved baseline values until named feeds are connected.'],
    ['Failed source groups',failed,'Failures remain visible and do not receive invented replacement values.']
  ].map(([label,value,detail])=>`<article><strong>${value}</strong><span>${label}</span><p>${detail}</p></article>`).join('');
  $('limitations').innerHTML=(signalData.limitations||[]).map(x=>`<p>• ${escapeHtml(x)}</p>`).join('');
}

function renderAnalytics(){
  const a=signalData.analytics||{};
  const cards=[
    ['7-day change',Number(a.sevenDayChange||0),`${Number(a.sevenDayChange||0)>=0?'Up':'Down'} ${Math.abs(Number(a.sevenDayChange||0)).toFixed(1)} points`],
    ['30-day change',Number(a.thirtyDayChange||0),`${Number(a.thirtyDayChange||0)>=0?'Up':'Down'} ${Math.abs(Number(a.thirtyDayChange||0)).toFixed(1)} points`],
    ['Volatility',Number(a.volatility||0),`${Number(a.volatility||0).toFixed(1)} point standard deviation`],
    ['Biggest mover',a.biggestMover?.change||0,`${a.biggestMover?.name||'Insufficient history'} ${a.biggestMover?`${a.biggestMover.change>=0?'↑':'↓'} ${Math.abs(a.biggestMover.change).toFixed(1)}`:''}`],
    ['Biggest improvement',a.biggestImprovement?.change||0,`${a.biggestImprovement?.name||'Insufficient history'} ${a.biggestImprovement?`↓ ${Math.abs(a.biggestImprovement.change).toFixed(1)}`:''}`]
  ];
  $('analytics-grid').innerHTML=cards.map(([label,value,detail])=>`<article><span>${escapeHtml(label)}</span><strong>${typeof value==='number'?(value>0?'+':'')+value.toFixed(1):escapeHtml(value)}</strong><p>${escapeHtml(detail)}</p></article>`).join('');
}

function renderHistory(){
  const select=$('history-series'),points=historyData?.points||[];
  if(!points.length){$('history-chart').innerHTML='<div class="empty-state">History begins after the first completed refresh.</div>';return;}
  if(select.options.length===1)Object.keys(points.at(-1).categories||{}).forEach(name=>select.add(new Option(name,name)));
  const key=select.value,values=points.map(p=>({t:new Date(p.timestamp),v:key==='overall'?p.overall:p.categories?.[key]})).filter(x=>Number.isFinite(x.v));
  if(!values.length){$('history-chart').innerHTML='<div class="empty-state">No history is available for this series.</div>';return;}
  const w=900,h=280,pad=38,min=Math.max(0,Math.min(...values.map(x=>x.v))-8),max=Math.min(100,Math.max(...values.map(x=>x.v))+8),span=max-min||1;
  const xy=values.map((x,i)=>({x:pad+(i*(w-pad*2)/Math.max(1,values.length-1)),y:h-pad-((x.v-min)/span)*(h-pad*2),...x}));
  const path=xy.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots=xy.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4"><title>${p.t.toLocaleString()}: ${p.v}</title></circle>`).join('');
  $('history-chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"/><text x="4" y="${pad+5}">${Math.round(max)}</text><text x="8" y="${h-pad+5}">${Math.round(min)}</text><path class="series" d="${path}"/>${dots}</svg>`;
  const first=values[0].v,last=values.at(-1).v,diff=last-first;
  $('history-summary').innerHTML=`<strong>${escapeHtml(key==='overall'?'Overall':key)}: ${last}/100</strong><span>${diff>0?'Up':diff<0?'Down':'Unchanged'} ${Math.abs(diff).toFixed(0)} point${Math.abs(diff)===1?'':'s'} across ${values.length} observation${values.length===1?'':'s'}.</span>`;
}
function exportCsv(){
  const rows=[['Category','Score','Level','7-day movement','Confidence','Status','Updated'],...signalData.categories.map(x=>[x.name,x.score,levelFor(x.score),x.delta||0,x.confidence,x.status||'baseline',signalData.updated])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='signal5-current.csv';a.click();URL.revokeObjectURL(a.href);
}
async function load(){
  const [dataRes,historyRes]=await Promise.all([fetch('data.json',{cache:'no-store'}),fetch('history.json',{cache:'no-store'}).catch(()=>null)]);
  if(!dataRes.ok)throw new Error(`Data unavailable (${dataRes.status})`);
  signalData=await dataRes.json();historyData=historyRes?.ok?await historyRes.json():{points:[]};
  $('overall-score').textContent=signalData.overall.score;$('overall-level').textContent=signalData.overall.level||levelFor(signalData.overall.score);
  $('overall-summary').textContent=signalData.overall.summary;$('overall-confidence').textContent=`${signalData.overall.confidence} confidence`;
  $('updated').textContent=`Updated ${signalData.updated}`;$('data-mode').textContent=(signalData.mode||'data').toUpperCase();
  $('footer-version').textContent=`Method version ${signalData.methodVersion||'—'}`;
  const failed=Number(signalData.sourceHealth?.failed||0);if(failed)$('overall-summary').textContent+=` ${failed} source group${failed===1?' is':'s are'} currently unavailable.`;
  updateStats();renderSignals();renderIntelligence();renderChanges();renderAnalytics();renderSources();renderHistory();renderWorkspace();maybeNotify();
}
['signal-search','level-filter','saved-filter'].forEach(id=>$(id).addEventListener('input',renderSignals));
$('reset-filters').addEventListener('click',()=>{$('signal-search').value='';$('level-filter').value='0';$('saved-filter').checked=false;renderSignals()});
$('copy-brief').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(briefText());$('copy-brief').textContent='Copied';setTimeout(()=>$('copy-brief').textContent='Copy brief',1500)}catch{alert(briefText())}});
$('share-brief').addEventListener('click',async()=>{if(navigator.share)await navigator.share({title:'Signal 5 daily brief',text:briefText(),url:location.href});else{await navigator.clipboard.writeText(briefText());$('share-brief').textContent='Copied';setTimeout(()=>$('share-brief').textContent='Share daily brief',1500)}});
$('export-csv').addEventListener('click',exportCsv);$('history-series').addEventListener('change',renderHistory);
$('alert-form').addEventListener('submit',e=>{e.preventDefault();profile.defaultThreshold=Number($('alert-threshold').value);saveProfile();$('alert-message').textContent='Default threshold saved on this device.';renderSignals();renderThresholds();renderAlertCenter()});
$('alert-threshold').value=String(profile.defaultThreshold||50);

$('save-workspace').addEventListener('click',()=>{
  profile.name=$('workspace-name').value.trim()||'My dashboard';
  profile.preset=$('workspace-preset').value;
  saveProfile('Workspace saved.');renderSignals();
});
$('workspace-preset').addEventListener('change',()=>{profile.preset=$('workspace-preset').value;saveProfile('View preset applied.');renderSignals()});
$('reset-workspace').addEventListener('click',()=>{
  profile=defaultProfile();profile.watchlist=[];profile.thresholds={};saved=new Set();
  saveProfile('Workspace reset.');renderWorkspace();updateStats();renderSignals();
});
$('download-profile').addEventListener('click',downloadProfile);
$('restore-profile').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)restoreProfile(file);e.target.value=''});
$('print-report').addEventListener('click',printReport);
$('enable-notifications').addEventListener('click',async()=>{
  if(!('Notification'in window)){$('workspace-message').textContent='This browser does not support notifications.';return}
  const permission=await Notification.requestPermission();
  $('workspace-message').textContent=permission==='granted'?'Browser alerts enabled.':'Browser alerts were not enabled.';
  maybeNotify();
});

const root=document.documentElement,savedTheme=localStorage.getItem('signal5-theme');if(savedTheme)root.dataset.theme=savedTheme;
$('theme-toggle').addEventListener('click',()=>{const next=root.dataset.theme==='light'?'dark':'light';root.dataset.theme=next;localStorage.setItem('signal5-theme',next)});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('install-app').hidden=false});
$('install-app').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('install-app').hidden=true});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(console.error));
load().catch(err=>{$('overall-level').textContent='Unable to load data';$('overall-summary').textContent='Signal 5 could not retrieve the current data file. Refresh the page or try again later.';console.error(err)});