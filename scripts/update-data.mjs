import fs from 'node:fs/promises';

const DATA_FILE = new URL('../data.json', import.meta.url);
const HISTORY_FILE = new URL('../history.json', import.meta.url);
const now = new Date();

const clamp = (n, min=0, max=100) => Math.max(min, Math.min(max, Math.round(n)));
const levelFor = s => s < 30 ? 'Normal' : s < 50 ? 'Monitor' : s < 70 ? 'Watch' : s < 85 ? 'Elevated' : 'Severe';
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const stdev = a => {
  if (a.length < 2) return 1;
  const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))) || 1;
};
const scoreFromZ = z => clamp(50 + z * 12);

async function getJson(url, options={}) {
  const response = await fetch(url, {
    ...options,
    headers: {'User-Agent':'Signal5/1.0 public-risk-dashboard contact: repository-owner', ...(options.headers||{})},
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fredSeries(seriesId) {
  const key=process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY not configured');
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.search=new URLSearchParams({
    series_id:seriesId,api_key:key,file_type:'json',sort_order:'desc',limit:'36'
  });
  const json=await getJson(url);
  return json.observations.map(x=>({date:x.date,value:Number(x.value)})).filter(x=>Number.isFinite(x.value)).reverse();
}

async function updateNws(categories) {
  const json=await getJson('https://api.weather.gov/alerts/active?status=actual');
  const alerts=json.features||[];
  const severe=alerts.filter(x=>['Severe','Extreme'].includes(x.properties?.severity)).length;
  const total=alerts.length;
  const score=clamp(25 + Math.log10(total+1)*13 + Math.log10(severe+1)*18);
  const stamp=json.updated || now.toISOString();
  for (const name of ['Infrastructure','Public Safety']) {
    const c=categories.get(name);
    const prior=c.score;
    c.score=clamp(name==='Infrastructure'?score*.86:score);
    c.delta=c.score-prior;
    c.status='live';
    c.lastObserved=stamp;
    c.sourceDetails=(c.sourceDetails||[]).filter(x=>x.id!=='nws-alerts');
    c.sourceDetails.push({id:'nws-alerts',name:'National Weather Service active alerts',url:'https://api.weather.gov/alerts/active',observed:stamp,detail:`${total} active actual alerts; ${severe} severe or extreme.`});
    c.changed=`The active national alert count is ${total}, including ${severe} classified as severe or extreme.`;
    c.matters='Widespread or high-severity weather alerts can strain transportation, utilities, emergency response, and household safety.';
    c.summary=name==='Infrastructure'?'Weather-related operational pressure is derived from current national alerts.':'Current public-safety pressure includes active National Weather Service alerts.';
    c.confidence='Moderate-high — sourced directly from the National Weather Service; alert counts do not measure realized damage.';
  }
}

async function updateUsgs(categories) {
  const url='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';
  const json=await getJson(url);
  const events=json.features||[];
  const maxMag=Math.max(0,...events.map(x=>Number(x.properties?.mag)||0));
  const score=clamp(20 + events.length*5 + Math.max(0,maxMag-5)*12);
  const observed=new Date(json.metadata?.generated||Date.now()).toISOString();
  for (const name of ['Infrastructure','Public Safety']) {
    const c=categories.get(name);
    c.score=clamp((c.score*0.75)+(score*0.25));
    c.status='live';
    c.lastObserved=observed;
    c.sourceDetails=(c.sourceDetails||[]).filter(x=>x.id!=='usgs-earthquakes');
    c.sourceDetails.push({id:'usgs-earthquakes',name:'USGS significant earthquakes, past week',url,observed,detail:`${events.length} significant events; maximum magnitude ${maxMag.toFixed(1)}.`});
  }
}

async function updateFred(categories) {
  const specs=[
    {name:'Economy',series:'UNRATE',label:'U.S. unemployment rate',invert:false},
    {name:'Supply Chains',series:'MNFCTRIRSA',label:'Manufacturers inventories-to-sales ratio',invert:false},
    {name:'Energy',series:'DCOILWTICO',label:'West Texas Intermediate crude oil price',invert:false}
  ];
  for (const spec of specs) {
    const values=await fredSeries(spec.series);
    if(values.length<6) throw new Error(`Insufficient FRED observations for ${spec.series}`);
    const nums=values.map(x=>x.value);
    const latest=nums.at(-1), prior=nums.at(-2);
    const baseline=nums.slice(0,-1);
    let z=(latest-mean(baseline))/stdev(baseline);
    if(spec.invert) z=-z;
    const c=categories.get(spec.name);
    const old=c.score;
    c.score=scoreFromZ(z);
    c.delta=c.score-old;
    c.status='live';
    c.lastObserved=values.at(-1).date;
    c.sourceDetails=[{id:`fred-${spec.series}`,name:spec.label,url:`https://fred.stlouisfed.org/series/${spec.series}`,observed:values.at(-1).date,detail:`Latest ${latest}; prior ${prior}; standardized movement ${z.toFixed(2)}.`}];
    c.changed=`${spec.label} moved from ${prior} to ${latest}.`;
    c.matters=`This public series is used as a transparent proxy within the ${spec.name.toLowerCase()} signal.`;
    c.summary=`The current score reflects standardized movement in ${spec.label.toLowerCase()}.`;
    c.confidence='Moderate — official public series, but one proxy cannot represent the entire category.';
  }
}

async function updateGdelt(categories) {
  const key=process.env.GDELT_CLOUD_API_KEY;
  if(!key) throw new Error('GDELT_CLOUD_API_KEY not configured');
  const end=now.toISOString().slice(0,10);
  const start=new Date(now-7*864e5).toISOString().slice(0,10);
  const url=new URL('https://gdeltcloud.com/api/v2/events/summary');
  url.search=new URLSearchParams({event_family:'conflict',date_start:start,date_end:end,group_by:'date'});
  const json=await getJson(url,{headers:{Authorization:`Bearer ${key}`}});
  const buckets=json.buckets||json.data||[];
  const counts=buckets.map(x=>Number(x.count||x.event_count||0)).filter(Number.isFinite);
  const latest=counts.at(-1)||0;
  const z=counts.length>2?(latest-mean(counts.slice(0,-1)))/stdev(counts.slice(0,-1)):0;
  const c=categories.get('Conflict');
  const old=c.score;
  c.score=scoreFromZ(z);
  c.delta=c.score-old;
  c.status='live';
  c.lastObserved=end;
  c.sourceDetails=[{id:'gdelt-conflict',name:'GDELT Cloud conflict-event summary',url:url.toString(),observed:end,detail:`Latest daily count ${latest}; standardized movement ${z.toFixed(2)}.`}];
  c.changed=`Structured conflict-event activity is ${z>=0?'above':'below'} its seven-day baseline.`;
  c.matters='Conflict activity can transmit through energy, shipping, markets, migration, and public confidence.';
  c.summary='The signal uses structured public-event activity relative to its recent baseline.';
  c.confidence='Moderate — event extraction is evidence-linked, but news availability and classification can change.';
}

const data=JSON.parse(await fs.readFile(DATA_FILE,'utf8'));
const history=JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'));
const categories=new Map(data.categories.map(x=>[x.name,{...x,sourceDetails:x.sourceDetails||[]}]));
const failures=[];

for (const [name,fn] of [['NWS',()=>updateNws(categories)],['USGS',()=>updateUsgs(categories)],['FRED',()=>updateFred(categories)],['GDELT',()=>updateGdelt(categories)]]) {
  try { await fn(); }
  catch(error) { failures.push(`${name}: ${error.message}`); }
}

data.categories=[...categories.values()].map(c=>({...c,level:levelFor(c.score)}));
const live=data.categories.filter(x=>x.status==='live');
data.overall.score=live.length?clamp(mean(live.map(x=>x.score))):data.overall.score;
data.overall.level=levelFor(data.overall.score);
data.overall.summary=failures.length
 ? `${live.length} categories contain refreshed public data. ${failures.length} source group${failures.length===1?' is':'s are'} unavailable and confidence is reduced.`
 : 'All configured source groups refreshed successfully.';
data.overall.confidence=failures.length?'Moderate':'Moderate-high';
data.updated=now.toLocaleString('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
data.generatedAt=now.toISOString();
data.sourceHealth={successful:4-failures.length,failed:failures.length,failures};

history.points.push({
  timestamp:now.toISOString(),
  overall:data.overall.score,
  categories:Object.fromEntries(data.categories.map(x=>[x.name,x.score]))
});
history.points=history.points.slice(-365);

await fs.writeFile(DATA_FILE,JSON.stringify(data,null,2)+'\n');
await fs.writeFile(HISTORY_FILE,JSON.stringify(history,null,2)+'\n');
console.log(JSON.stringify({updated:data.updated,overall:data.overall,sourceHealth:data.sourceHealth},null,2));
