import fs from 'node:fs/promises';

const DATA_FILE = new URL('../data.json', import.meta.url);
const HISTORY_FILE = new URL('../history.json', import.meta.url);
const now = new Date();
const DAY = 864e5;

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Math.round(n)));
const levelFor=s=>s<30?'Normal':s<50?'Monitor':s<70?'Watch':s<85?'Elevated':'Severe';
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const stdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};
const scoreFromZ=z=>clamp(50+z*12);
const isoDate=d=>new Date(d).toISOString().slice(0,10);

async function getJson(url,options={}){
  const response=await fetch(url,{...options,headers:{'User-Agent':'Signal5/2.0 public-risk-dashboard contact: repository-owner',Accept:'application/json',...(options.headers||{})},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
function ensureCategory(categories,name,defaults={}){
  if(!categories.has(name))categories.set(name,{name,score:50,delta:0,summary:'Awaiting the first successful source refresh.',changed:'No current observation has been recorded.',matters:'This category remains visible so missing coverage is never hidden.',confidence:'Low — source has not refreshed.',sources:[],status:'baseline',lastObserved:null,sourceDetails:[],...defaults});
  return categories.get(name);
}
function applyCategory(c,{score,status='live',observed,source,summary,changed,matters,confidence}){
  const old=Number(c.score)||50;
  c.score=clamp(score);c.delta=c.score-old;c.status=status;c.lastObserved=observed;
  c.sourceDetails=[source];c.sources=[source.name];c.summary=summary;c.changed=changed;c.matters=matters;c.confidence=confidence;c.level=levelFor(c.score);
}
async function fredSeries(seriesId){
  const key=process.env.FRED_API_KEY;if(!key)throw new Error('FRED_API_KEY not configured');
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.search=new URLSearchParams({series_id:seriesId,api_key:key,file_type:'json',sort_order:'desc',limit:'48'});
  const json=await getJson(url);
  return json.observations.map(x=>({date:x.date,value:Number(x.value)})).filter(x=>Number.isFinite(x.value)).reverse();
}
async function updateNws(categories){
  const url='https://api.weather.gov/alerts/active?status=actual';
  const json=await getJson(url),alerts=json.features||[];
  const severe=alerts.filter(x=>['Severe','Extreme'].includes(x.properties?.severity)).length;
  const total=alerts.length,score=clamp(18+Math.log10(total+1)*14+Math.log10(severe+1)*20);
  const observed=json.updated||now.toISOString();
  applyCategory(ensureCategory(categories,'Weather'),{score,observed,source:{id:'nws-alerts',name:'National Weather Service active alerts',url:'https://api.weather.gov/alerts/active',observed,detail:`${total} active actual alerts; ${severe} severe or extreme.`},summary:'National weather pressure is calculated from active official alerts.',changed:`There are ${total} active actual alerts, including ${severe} severe or extreme alerts.`,matters:'Widespread or severe weather can affect travel, utilities, emergency response, and household safety.',confidence:'Moderate-high — direct NWS feed; alert counts do not measure realized damage.'});
  const infra=ensureCategory(categories,'Infrastructure'),safety=ensureCategory(categories,'Public Safety');
  for(const [c,weight] of [[infra,.55],[safety,.45]]){
    const blended=clamp((Number(c.score)||50)*(1-weight)+score*weight);
    c.score=blended;c.delta=blended-(Number(c.score)||50);c.status=c.status==='live'?'live':'partial';c.lastObserved=observed;
    c.sourceDetails=[...(c.sourceDetails||[]).filter(x=>x.id!=='nws-alerts'),{id:'nws-alerts',name:'National Weather Service active alerts',url:'https://api.weather.gov/alerts/active',observed,detail:`Weather component: ${total} active alerts; ${severe} severe or extreme.`}];
  }
}
async function updateUsgs(categories){
  const url='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';
  const json=await getJson(url),events=json.features||[],maxMag=Math.max(0,...events.map(x=>Number(x.properties?.mag)||0));
  const score=clamp(15+events.length*6+Math.max(0,maxMag-5)*15),observed=new Date(json.metadata?.generated||Date.now()).toISOString();
  applyCategory(ensureCategory(categories,'Earthquakes'),{score,observed,source:{id:'usgs-earthquakes',name:'USGS significant earthquakes, past week',url,observed,detail:`${events.length} significant events; maximum magnitude ${maxMag.toFixed(1)}.`},summary:'Seismic pressure reflects significant earthquakes reported during the past week.',changed:`USGS reports ${events.length} significant earthquakes; the largest magnitude is ${maxMag.toFixed(1)}.`,matters:'Significant earthquakes can create localized life-safety, infrastructure, and supply-chain consequences.',confidence:'High — direct USGS event feed; the national score does not estimate local damage.'});
}
async function updateSpaceWeather(categories){
  const url='https://services.swpc.noaa.gov/products/alerts.json',json=await getJson(url);
  const cutoff=now-DAY*7;
  const recent=(Array.isArray(json)?json:[]).filter(x=>new Date(x.issue_datetime||x.issue_time||0).getTime()>=cutoff);
  const warning=recent.filter(x=>/warning|alert/i.test(`${x.product_id||''} ${x.message||''}`)).length;
  const score=clamp(20+recent.length*2.5+warning*4),observed=recent[0]?.issue_datetime||now.toISOString();
  applyCategory(ensureCategory(categories,'Space Weather'),{score,observed,source:{id:'noaa-swpc-alerts',name:'NOAA Space Weather Prediction Center alerts',url,observed,detail:`${recent.length} products issued in seven days; ${warning} matched alert or warning language.`},summary:'Space-weather pressure uses recent NOAA SWPC alert products.',changed:`NOAA SWPC issued ${recent.length} alert products during the past seven days.`,matters:'Strong geomagnetic and solar activity can affect radio, navigation, satellites, and some power-grid operations.',confidence:'Moderate-high — official NOAA feed; product counts are a proxy for operational severity.'});
}
async function updateCisa(categories){
  const url='https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
  const json=await getJson(url),items=json.vulnerabilities||[],cut7=isoDate(now-DAY*7),cut30=isoDate(now-DAY*30);
  const seven=items.filter(x=>x.dateAdded>=cut7).length,thirty=items.filter(x=>x.dateAdded>=cut30).length;
  const ransomware=items.filter(x=>x.dateAdded>=cut30&&String(x.knownRansomwareCampaignUse).toLowerCase()==='known').length;
  const score=clamp(25+seven*5+Math.min(20,thirty)+ransomware*5),observed=json.dateReleased||now.toISOString();
  applyCategory(ensureCategory(categories,'Cybersecurity'),{score,observed,source:{id:'cisa-kev',name:'CISA Known Exploited Vulnerabilities Catalog',url:'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',observed,detail:`${seven} additions in seven days; ${thirty} in 30 days; ${ransomware} marked known ransomware use.`},summary:'Cyber pressure reflects new vulnerabilities confirmed as exploited in the wild.',changed:`CISA added ${seven} known exploited vulnerabilities in seven days and ${thirty} in 30 days.`,matters:'Newly exploited vulnerabilities increase patching urgency for affected organizations, but do not mean every user is exposed.',confidence:'High for catalog additions — CISA is authoritative; the score is not a measure of all cyber incidents.'});
}
async function updateFred(categories){
  const specs=[
    {name:'Economy',series:['UNRATE','CPIAUCSL','BAMLH0A0HYM2'],label:'labor, inflation, and credit stress'},
    {name:'Supply Chains',series:['MNFCTRIRSA','AMDMNO'],label:'inventories and durable-goods orders'},
    {name:'Energy',series:['DCOILWTICO'],label:'West Texas Intermediate crude oil price'}
  ];
  for(const spec of specs){
    const series=await Promise.all(spec.series.map(fredSeries)),zs=[],details=[];
    for(let i=0;i<series.length;i++){
      const values=series[i],nums=values.map(x=>x.value),latest=nums.at(-1),prior=nums.at(-2),baseline=nums.slice(0,-1);
      const z=(latest-mean(baseline))/(stdev(baseline)||1);zs.push(z);
      details.push(`${spec.series[i]} ${prior}→${latest}`);
    }
    const z=mean(zs),c=ensureCategory(categories,spec.name),observed=series.map(x=>x.at(-1).date).sort().at(0);
    applyCategory(c,{score:scoreFromZ(z),observed,source:{id:`fred-${spec.name.toLowerCase().replaceAll(' ','-')}`,name:`FRED ${spec.label}`,url:'https://fred.stlouisfed.org/',observed,detail:`${details.join('; ')}; composite z-score ${z.toFixed(2)}.`},summary:`The current score combines standardized movement in ${spec.label}.`,changed:`Latest official series: ${details.join('; ')}.`,matters:`These public series provide transparent proxies for the broader ${spec.name.toLowerCase()} category.`,confidence:`Moderate — multiple official series are used, but they cannot represent every part of ${spec.name.toLowerCase()}.`});
  }
}
async function updateGdelt(categories){
  const key=process.env.GDELT_CLOUD_API_KEY;if(!key)throw new Error('GDELT_CLOUD_API_KEY not configured');
  const end=isoDate(now),start=isoDate(now-DAY*7),url=new URL('https://gdeltcloud.com/api/v2/events/summary');
  url.search=new URLSearchParams({event_family:'conflict',date_start:start,date_end:end,group_by:'date'});
  const json=await getJson(url,{headers:{Authorization:`Bearer ${key}`}}),buckets=json.buckets||json.data||[];
  const counts=buckets.map(x=>Number(x.count||x.event_count||0)).filter(Number.isFinite),latest=counts.at(-1)||0,z=counts.length>2?(latest-mean(counts.slice(0,-1)))/(stdev(counts.slice(0,-1))||1):0;
  applyCategory(ensureCategory(categories,'Conflict'),{score:scoreFromZ(z),observed:end,source:{id:'gdelt-conflict',name:'GDELT Cloud conflict-event summary',url:url.toString(),observed:end,detail:`Latest daily count ${latest}; standardized movement ${z.toFixed(2)}.`},summary:'The signal uses structured public-event activity relative to its recent baseline.',changed:`Structured conflict-event activity is ${z>=0?'above':'below'} its seven-day baseline.`,matters:'Conflict activity can transmit through energy, shipping, markets, migration, and public confidence.',confidence:'Moderate — evidence-linked event extraction is affected by reporting and classification.'});
}
function observationAtOrBefore(points,target){
  return [...points].reverse().find(p=>new Date(p.timestamp).getTime()<=target);
}
function analytics(history,current){
  const points=[...(history.points||[]),current],last=points.at(-1),p7=observationAtOrBefore(points,now-DAY*7),p30=observationAtOrBefore(points,now-DAY*30);
  const seven=p7?last.overall-p7.overall:0,thirty=p30?last.overall-p30.overall:0;
  const recent=points.filter(p=>new Date(p.timestamp)>=now-DAY*30).map(p=>p.overall);
  const categoryChanges=Object.entries(last.categories||{}).map(([name,value])=>({name,change:p7&&Number.isFinite(p7.categories?.[name])?value-p7.categories[name]:0}));
  const movers=[...categoryChanges].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
  const improvements=categoryChanges.filter(x=>x.change<0).sort((a,b)=>a.change-b.change);
  return {sevenDayChange:Number(seven.toFixed(1)),thirtyDayChange:Number(thirty.toFixed(1)),volatility:Number(stdev(recent).toFixed(1)),biggestMover:movers[0]||null,biggestImprovement:improvements[0]||null,observationCount:points.length};
}


function confidenceWeight(text=''){
  const value=String(text).toLowerCase();
  if(value.startsWith('high'))return 1;
  if(value.startsWith('moderate-high'))return .9;
  if(value.startsWith('moderate'))return .75;
  if(value.startsWith('low-moderate'))return .5;
  return .35;
}
function movementPhrase(change){
  const magnitude=Math.abs(change);
  if(magnitude<2)return 'was nearly unchanged';
  if(magnitude<5)return change>0?'edged higher':'edged lower';
  if(magnitude<10)return change>0?'moved higher':'moved lower';
  return change>0?'rose sharply':'fell sharply';
}
function buildIntelligence(categories,sourceHealth){
  const candidates=categories
    .filter(c=>c.status!=='baseline'&&(c.sourceDetails||[]).length)
    .map(c=>{
      const change=Number(c.delta||0),source=c.sourceDetails[0]||{};
      return {
        category:c.name,change,score:Number(c.score),weightedImpact:Math.abs(change)*confidenceWeight(c.confidence),
        explanation:`${c.name} ${movementPhrase(change)} to ${c.score}/100. ${c.changed||c.summary}`,
        sourceName:source.name||c.sources?.[0]||'Named public source',
        sourceUrl:source.url||'',observed:source.observed||c.lastObserved||''
      };
    })
    .sort((a,b)=>b.weightedImpact-a.weightedImpact);
  const material=candidates.filter(x=>Math.abs(x.change)>=2).slice(0,5);
  const net=mean(categories.filter(c=>c.status!=='baseline').map(c=>Number(c.delta||0)));
  const direction=net>2?'Higher pressure':net<-2?'Lower pressure':'Broadly stable';
  const lead=material[0];
  const title=lead?`${lead.category} is the leading measurable driver`:'No single category is driving the dashboard';
  const summary=material.length
    ? `${direction}. ${material.length} evidence-backed driver${material.length===1?'':'s'} account for the most meaningful movement in this refresh. The strongest measured change is ${lead.category.toLowerCase()}, which ${movementPhrase(lead.change)}.`
    : `${direction}. Current score changes are too small to support a stronger assessment.`;
  return {
    generatedAt:now.toISOString(),method:'Structured deterministic synthesis v1',
    direction,title,summary,drivers:material,
    audit:{driverCount:material.length,activeCategoryCount:categories.filter(c=>c.status!=='baseline').length,failedSourceGroups:Number(sourceHealth?.failed||0)}
  };
}

const data=JSON.parse(await fs.readFile(DATA_FILE,'utf8'));
const history=JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'));
const categories=new Map((data.categories||[]).map(x=>[x.name,{...x,sourceDetails:x.sourceDetails||[]}]));
for(const name of ['Economy','Supply Chains','Infrastructure','Conflict','Energy','Public Safety','Weather','Earthquakes','Cybersecurity','Space Weather'])ensureCategory(categories,name);
const sources=[
  ['NWS',()=>updateNws(categories)],['USGS',()=>updateUsgs(categories)],['NOAA SWPC',()=>updateSpaceWeather(categories)],
  ['CISA KEV',()=>updateCisa(categories)],['FRED',()=>updateFred(categories)],['GDELT',()=>updateGdelt(categories)]
],failures=[],successful=[];
for(const [name,fn] of sources){try{await fn();successful.push(name)}catch(error){failures.push(`${name}: ${error.message}`)}}
data.categories=[...categories.values()].map(c=>({...c,level:levelFor(c.score)}));
const active=data.categories.filter(x=>['live','partial'].includes(x.status));
data.overall.score=active.length?clamp(mean(active.map(x=>x.score))):data.overall.score;
data.overall.level=levelFor(data.overall.score);
data.overall.summary=`${data.categories.filter(x=>x.status==='live').length} categories are live and ${data.categories.filter(x=>x.status==='partial').length} are partial. ${failures.length?`${failures.length} source group${failures.length===1?' is':'s are'} unavailable.`:'All configured source groups refreshed.'}`;
data.overall.confidence=failures.length>2?'Low-moderate':failures.length?'Moderate':'Moderate-high';
data.updated=now.toLocaleString('en-US',{timeZone:'America/New_York',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
data.generatedAt=now.toISOString();data.mode='live';data.methodVersion='2.1.0';
data.sourceHealth={successful:successful.length,failed:failures.length,successfulSources:successful,failures};
data.sourceGroups=sources.length;
data.intelligence=buildIntelligence(data.categories,data.sourceHealth);
const point={timestamp:now.toISOString(),overall:data.overall.score,categories:Object.fromEntries(data.categories.map(x=>[x.name,x.score]))};
data.analytics=analytics(history,point);
history.methodVersion='2.1.0';history.points.push(point);history.points=history.points.slice(-730);
await fs.writeFile(DATA_FILE,JSON.stringify(data,null,2)+'\n');
await fs.writeFile(HISTORY_FILE,JSON.stringify(history,null,2)+'\n');
console.log(JSON.stringify({updated:data.updated,overall:data.overall,analytics:data.analytics,sourceHealth:data.sourceHealth},null,2));
