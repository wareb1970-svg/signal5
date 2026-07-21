const levelFor=s=>s<30?'Normal':s<50?'Monitor':s<70?'Watch':s<85?'Elevated':'Severe';

async function loadSignal(){
  const response=await fetch('data.json');
  if(!response.ok) throw new Error('Data unavailable');
  const data=await response.json();

  document.getElementById('overall-score').textContent=data.overall.score;
  document.getElementById('overall-level').textContent=data.overall.level||levelFor(data.overall.score);
  document.getElementById('overall-summary').textContent=data.overall.summary;
  document.getElementById('overall-confidence').textContent=`${data.overall.confidence} confidence`;
  document.getElementById('updated').textContent=`Updated ${data.updated}`;

  document.getElementById('category-grid').innerHTML=data.categories.map((item,i)=>`
    <article class="signal-card" tabindex="0" data-index="${i}" aria-expanded="false">
      <div class="signal-top"><div><div class="signal-name">${item.name}</div><div class="signal-level">${item.level||levelFor(item.score)}</div></div><div class="signal-score">${item.score}</div></div>
      <div class="meter"><span style="width:${item.score}%"></span></div>
      <p class="signal-summary">${item.summary}</p>
      <div class="details">
        <strong>WHAT CHANGED</strong><p>${item.changed}</p>
        <strong>WHY IT MATTERS</strong><p>${item.matters}</p>
        <strong>CONFIDENCE</strong><p>${item.confidence}</p>
      </div>
    </article>`).join('');

  document.getElementById('change-list').innerHTML=data.changes.map(item=>`
    <article class="change-item">
      <div class="change-tag">${item.category}</div>
      <div><strong>${item.title}</strong><p>${item.detail}</p></div>
      <div class="change-direction">${item.direction}</div>
    </article>`).join('');

  document.querySelectorAll('.signal-card').forEach(card=>{
    const toggle=()=>{card.classList.toggle('open');card.setAttribute('aria-expanded',card.classList.contains('open'))};
    card.addEventListener('click',toggle);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}});
  });
}

const root=document.documentElement;
const saved=localStorage.getItem('signal5-theme');
if(saved) root.dataset.theme=saved;
document.getElementById('theme-toggle').addEventListener('click',()=>{
  const next=root.dataset.theme==='light'?'dark':'light';
  root.dataset.theme=next;
  localStorage.setItem('signal5-theme',next);
});

loadSignal().catch(err=>{
  document.getElementById('overall-level').textContent='Unable to load data';
  document.getElementById('overall-summary').textContent='Open this site through a local or web server so data.json can load.';
  console.error(err);
});
