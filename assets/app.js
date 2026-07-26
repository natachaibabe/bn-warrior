/* BN Warrior V11 — application, storage, nutrition, progression and PWA logic */
(function(){
"use strict";
const HERO_IMAGE="assets/hero.webp";
const KEY="bn_warrior_v12_mobile_smart";
let memoryStore={};
const STORE={
 get(k){try{return localStorage.getItem(k)}catch(e){return memoryStore[k]||null}},
 set(k,v){try{localStorage.setItem(k,v)}catch(e){memoryStore[k]=v}}
};
const IDB={
 db:null,
 open(){
  return new Promise((resolve,reject)=>{
   if(this.db)return resolve(this.db);
   if(!("indexedDB" in window))return resolve(null);
   const req=indexedDB.open("BNWarriorDB",1);
   req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("state"))db.createObjectStore("state")};
   req.onsuccess=()=>{this.db=req.result;resolve(this.db)};
   req.onerror=()=>reject(req.error);
  });
 },
 async set(key,value){
  try{const db=await this.open();if(!db)return;
   await new Promise((resolve,reject)=>{const tx=db.transaction("state","readwrite");tx.objectStore("state").put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
  }catch(e){console.warn("IndexedDB save failed",e)}
 },
 async get(key){
  try{const db=await this.open();if(!db)return null;
   return await new Promise((resolve,reject)=>{const tx=db.transaction("state","readonly");const r=tx.objectStore("state").get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
  }catch(e){return null}
 }
};
const EMPTY_NUTRITION={calories:0,protein:0,carbs:0,fat:0,waterMl:0,meals:{},foods:[]};
const DEFAULT={
 start:new Date().toISOString().slice(0,10),
 profile:{
  name:"Natachai",
  targetWeight:62.5,
  targetWeightLabel:"62–63 kg",
  targetBf:12.5,
  targetBfLabel:"12–13% BF",
  calorieTarget:2000,
  proteinTarget:140,
  carbTarget:225,
  fatTarget:60,
  waterMlPerKg:35,
  workoutWaterMl:700,
  sleepTarget:7,
  heightCm:167,
  age:30,
  sex:"male",
  activityFactor:1.45,
  calorieDeficitPct:15,
  smartTargets:true,
  smartTargetThresholdKg:1.0,
  lastSmartTargetWeight:null
 },
 done:{},logs:{},checkins:[],scans:[],prs:{},photos:{},
 nutritionByDate:{},
 notes:[],chat:[],settings:{sound:true},selectedDay:null
}
let state=loadState(),calendarDate=new Date(),timer={sec:90,id:null};
const NAV=[["commandPage","Command"],["workoutPage","Workout"],["calendarPage","84 Days"],["nutritionPage","Nutrition"],["progressPage","Progress"],["coachPage","Commander"],["analyticsPage","Analytics"],["libraryPage","Library"],["settingsPage","More"]];
function clone(v){return JSON.parse(JSON.stringify(v))}
function loadState(){
 try{
  const raw=STORE.get(KEY)||STORE.get("bn_warrior_v11_production")||STORE.get("bn_warrior_v10_pwa")||STORE.get("bn_warrior_v9_production")||STORE.get("bn_warrior_v8_final")||STORE.get("bn_warrior_v7_production")||STORE.get("bn_warrior_v6_final")||STORE.get("bn_warrior_v5_final")||STORE.get("bn_warrior_v42_hud")||STORE.get("bn_warrior_v4_hud")||STORE.get("bn_warrior_v3_rc")||STORE.get("bn_warrior_v2_portable");
  if(!raw)return clone(DEFAULT);
  const old=JSON.parse(raw);
  const migrated=Object.assign(clone(DEFAULT),old,{
   profile:Object.assign({},DEFAULT.profile,old.profile||{}),
   settings:Object.assign({},DEFAULT.settings,old.settings||{}),
   nutritionByDate:Object.assign({},old.nutritionByDate||{})
  });
  if(old.nutrition && !Object.keys(migrated.nutritionByDate).length){
   migrated.nutritionByDate[iso(new Date())]=Object.assign(clone(EMPTY_NUTRITION),{
    calories:+old.nutrition.calories||0,
    protein:+old.nutrition.protein||0,
    carbs:+old.nutrition.carbs||0,
    fat:+old.nutrition.fat||0,
    waterMl:old.nutrition.waterMl!=null?+old.nutrition.waterMl:(+old.nutrition.water||0)*250,
    meals:old.nutrition.meals||{},
    foods:old.nutrition.foods||[]
   });
  }
  delete migrated.nutrition;
  return migrated;
 }catch(e){console.warn("State migration failed",e);return clone(DEFAULT)}
}
function save(){const raw=JSON.stringify(state);STORE.set(KEY,raw);IDB.set(KEY,raw);updateStorageStatus()}
const $=id=>document.getElementById(id);
const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const dayIndex=d=>Math.floor((new Date(iso(d))-new Date(state.start))/86400000);
const todayIndex=()=>Math.max(0,Math.min(83,dayIndex(new Date())));
const doneCount=()=>Object.values(state.done).filter(Boolean).length;
function streak(){let s=0;for(let i=todayIndex();i>=0;i--){if(state.done[i+1])s++;else break}return s}

function todayKey(){return iso(new Date())}
function nutritionFor(date=todayKey()){
 if(!state.nutritionByDate[date])state.nutritionByDate[date]=clone(EMPTY_NUTRITION);
 return state.nutritionByDate[date];
}
function nutritionToday(){return nutritionFor(todayKey())}

function recentAverageWeight(days=7){
 const list=(state.checkins||[]).filter(x=>x.weight).slice(-days);
 if(!list.length)return +latest().weight||67.1;
 return list.reduce((a,x)=>a+(+x.weight||0),0)/list.length;
}
function calculateSmartTargets(weight=recentAverageWeight()){
 const p=state.profile;
 const h=+p.heightCm||167,age=+p.age||30;
 const bmr=p.sex==="female"
  ?10*weight+6.25*h-5*age-161
  :10*weight+6.25*h-5*age+5;
 const tdee=bmr*(+p.activityFactor||1.45);
 const calories=Math.round((tdee*(1-(+p.calorieDeficitPct||15)/100))/50)*50;
 const protein=Math.round(weight*2.0/5)*5;
 const fat=Math.round(weight*.8/5)*5;
 const carbs=Math.max(0,Math.round((calories-protein*4-fat*9)/4/5)*5);
 return {calories,protein,carbs,fat,weight:+weight.toFixed(1)};
}
function maybeApplySmartTargets(force=false){
 const p=state.profile;
 if(!p.smartTargets&&!force)return false;
 const avg=recentAverageWeight(),base=p.lastSmartTargetWeight==null?avg:+p.lastSmartTargetWeight;
 if(!force&&Math.abs(avg-base)<(+p.smartTargetThresholdKg||1))return false;
 const t=calculateSmartTargets(avg);
 p.calorieTarget=t.calories;p.proteinTarget=t.protein;p.carbTarget=t.carbs;p.fatTarget=t.fat;p.lastSmartTargetWeight=t.weight;
 save();
 toast("ปรับเป้าสารอาหารตามน้ำหนักเฉลี่ยแล้ว");
 return true;
}
function smartTargetSummary(){
 const t=calculateSmartTargets(recentAverageWeight());
 return `${t.calories} kcal • P ${t.protein}g • C ${t.carbs}g • F ${t.fat}g`;
}
function waterGoalMl(){
 const p=state.profile,l=latest();
 return Math.round(((+l.weight||67.1)*(+p.waterMlPerKg||35)+(state.done[todayIndex()+1]?+p.workoutWaterMl||700:0))/50)*50;
}
function workoutPhase(day){
 const week=Math.floor((day-1)/7)+1;
 if(week<=3)return {name:"Foundation",volume:1,intensity:1,deload:false};
 if(week===4)return {name:"Deload",volume:.7,intensity:.9,deload:true};
 if(week<=7)return {name:"Build & Burn",volume:1.08,intensity:1.03,deload:false};
 if(week===8)return {name:"Deload",volume:.72,intensity:.9,deload:true};
 if(week<=11)return {name:"Athletic Definition",volume:1.12,intensity:1.05,deload:false};
 return {name:"Taper & Test",volume:.8,intensity:1,deload:true};
}
function workoutFor(day){
 const base=clone(WORKOUTS[(day-1)%7]),phase=workoutPhase(day);
 base.phase=phase;
 base.exercises=base.exercises.map(ex=>{
  const copy=Object.assign({},ex);
  if(phase.deload && copy.sets>1)copy.sets=Math.max(1,Math.round(copy.sets*phase.volume));
  else if(phase.volume>1.05 && copy.sets>1 && !/walk|treadmill|mobility|breath/i.test(copy.name))copy.sets=Math.min(copy.sets+1,5);
  return copy;
 });
 return base;
}
function latest(){return state.checkins.at(-1)||state.scans.at(-1)||{weight:67.1,bf:19.9,sleep:0,muscle:null,waist:null}}
function pct(v,max){return Math.max(0,Math.min(100,(+v||0)/max*100))}
function muscleInfo(name){
 const n=name.toLowerCase();
 if(/press|push|dip|fly/.test(n))return {key:"chest",labels:["Chest","Triceps"]};
 if(/row|pull/.test(n))return {key:"back",labels:["Back","Biceps"]};
 if(/squat|lunge|deadlift|calf|carry/.test(n))return {key:"legs",labels:["Legs","Glutes"]};
 if(/shoulder|lateral|rear delt|thruster/.test(n))return {key:"shoulders",labels:["Shoulders"]};
 if(/plank|wheel|core|mountain/.test(n))return {key:"core",labels:["Core"]};
 if(/run|walk|treadmill|zone/.test(n))return {key:"cardio",labels:["Cardio"]};
 if(/mobility|breath/.test(n))return {key:"mobility",labels:["Mobility"]};
 if(/curl/.test(n))return {key:"arms",labels:["Biceps"]};
 if(/extension/.test(n))return {key:"arms",labels:["Triceps"]};
 return {key:"full",labels:["Full Body"]};
}
function icon(name){
 const key=muscleInfo(name).key;
 const paths={
 chest:'<circle cx="12" cy="5" r="2"/><path d="M8 9c1-1 2-2 4-2s3 1 4 2v5c0 3-2 5-4 6-2-1-4-3-4-6z"/><path d="M8 11H5m11 0h3"/>',
 back:'<circle cx="12" cy="5" r="2"/><path d="M8 9c1 2 1 6 0 10m8-10c-1 2-1 6 0 10M8 10l4 3 4-3"/><path d="M5 9h3m8 0h3"/>',
 legs:'<circle cx="12" cy="4" r="2"/><path d="M12 6v6m0 0-4 8m4-8 4 8M8 10h8"/>',
 shoulders:'<circle cx="12" cy="5" r="2"/><path d="M7 10c1-2 3-3 5-3s4 1 5 3M12 7v8m-4-3-3 3m11-3 3 3"/>',
 core:'<circle cx="12" cy="5" r="2"/><path d="M9 8h6v11H9zM9 12h6M12 8v11"/>',
 cardio:'<circle cx="14" cy="4" r="2"/><path d="M10 21l2-6 3 2 2 4M8 11l4-3 3 3 4 1M12 8l-2 5-4 2"/>',
 mobility:'<circle cx="12" cy="5" r="2"/><path d="M12 7v6m0 0-5 6m5-6 5 6M7 10h10"/>',
 arms:'<circle cx="12" cy="5" r="2"/><path d="M12 7v7m-5-3 5-4 5 4M7 11l-2 5m12-5 2 5"/>',
 full:'<circle cx="12" cy="4" r="2"/><path d="M12 6v7m-5-3 5-3 5 3M9 13l-3 7m9-7 3 7"/>'
 };
 return '<svg class="muscle-svg" viewBox="0 0 24 24" aria-hidden="true">'+paths[key]+'</svg>';
}

const RANKS=[{name:"Recruit",xp:0},{name:"Private",xp:700},{name:"Corporal",xp:1800},{name:"Sergeant",xp:3500},{name:"Lieutenant",xp:6000},{name:"Captain",xp:9000},{name:"Major",xp:13000},{name:"Colonel",xp:18000},{name:"General",xp:25000}];
function xpTotal(){const n=nutritionToday(),p=state.profile;return Math.round(doneCount()*120+Object.keys(state.prs).length*75+streak()*10+Math.min(400,(n.protein||0)*2)+Math.min(160,(n.waterMl||0)/Math.max(1,waterGoalMl())*160))}

function rankInfo(){const xp=xpTotal();let idx=0;for(let i=0;i<RANKS.length;i++)if(xp>=RANKS[i].xp)idx=i;const current=RANKS[idx],next=RANKS[Math.min(idx+1,RANKS.length-1)],span=Math.max(1,next.xp-current.xp);return{idx,current,next,xp,progress:idx===RANKS.length-1?100:Math.round((xp-current.xp)/span*100)}}
function rank(){return rankInfo().current.name}
function level(){return Math.max(1,Math.floor(xpTotal()/350)+1)}
function completedSets(){let t=0;Object.values(state.logs||{}).forEach(d=>Object.values(d||{}).forEach(e=>t+=(e.sets||[]).filter(s=>s.done).length));return t}
function totalVolume(){let t=0;Object.values(state.logs||{}).forEach(d=>Object.values(d||{}).forEach(e=>(e.sets||[]).forEach(s=>{if(s.done)t+=(+s.weight||0)*(+s.reps||0)})));return Math.round(t)}
function weeklyMissionCount(){const end=todayIndex()+1,start=Math.max(1,end-6);let c=0;for(let d=start;d<=end;d++)if(state.done[d])c++;return c}
function bodyChange(){const v=state.checkins.filter(x=>x.weight);return v.length<2?0:+(v.at(-1).weight-v[0].weight).toFixed(1)}
function bodyFatChange(){const v=state.checkins.filter(x=>x.bf);return v.length<2?0:+(v.at(-1).bf-v[0].bf).toFixed(1)}
function exerciseVolumes(){const map={};Object.entries(state.logs||{}).forEach(([dk,d])=>{const num=+dk.replace("d",""),w=workoutFor(num);Object.entries(d||{}).forEach(([ei,log])=>{const ex=w.exercises[+ei];if(!ex)return;const m=muscleInfo(ex.name).labels[0];map[m]=(map[m]||0)+(log.sets||[]).reduce((a,s)=>a+(s.done?(+s.weight||1)*(+s.reps||1):0),0)})});return map}
function questData(){const n=nutritionToday(),p=state.profile;return[{title:"Weekly Missions",value:weeklyMissionCount(),target:5,reward:250},{title:"Protein Target",value:n.protein||0,target:p.proteinTarget,reward:80},{title:"Hydration",value:n.waterMl||0,target:waterGoalMl(),reward:50}]}

function nutritionScore(){const n=nutritionToday(),p=state.profile;return Math.round(pct(n.protein,p.proteinTarget)*.4+pct(n.carbs,p.carbTarget)*.15+pct(n.fat,p.fatTarget)*.15+pct(n.waterMl,waterGoalMl())*.2+pct(n.calories,p.calorieTarget)*.1)}

function offlineCommander(q){q=(q||"").toLowerCase();const l=latest(),n=nutritionToday(),p=state.profile;if(/วันนี้|workout|เล่นอะไร|ฝึก/.test(q))return"วันนี้คือ "+workoutFor(todayIndex()+1).name+" • Phase: "+workoutFor(todayIndex()+1).phase.name+" ใช้เวลาประมาณ "+workoutFor(todayIndex()+1).duration+" นาที";if(/โปรตีน|protein|กิน/.test(q))return"โปรตีน "+n.protein+"/"+p.proteinTarget+" กรัม เหลือ "+Math.max(0,p.proteinTarget-n.protein)+" กรัม";if(/คาร์บ|carb/.test(q))return"คาร์บ "+n.carbs+"/"+p.carbTarget+" กรัม เหลือ "+Math.max(0,p.carbTarget-n.carbs)+" กรัม";if(/ไขมัน|fat/.test(q))return"ไขมัน "+n.fat+"/"+p.fatTarget+" กรัม เหลือ "+Math.max(0,p.fatTarget-n.fat)+" กรัม";if(/น้ำ|water/.test(q))return"น้ำ "+(n.waterMl/1000).toFixed(2)+"/"+(waterGoalMl()/1000).toFixed(2)+" ลิตร เหลือ "+(Math.max(0,waterGoalMl()-n.waterMl)/1000).toFixed(2)+" ลิตร";if(/นอน|sleep|พัก|recovery/.test(q))return"นอนล่าสุด "+(l.sleep||0)+" ชั่วโมง "+((l.sleep||0)<6?"ลดความหนักลงประมาณ 10%":"ทำตามโปรแกรมได้");if(/เพิ่มน้ำหนัก|overload|หนัก/.test(q))return workoutFor(todayIndex()+1).phase.deload?"สัปดาห์นี้เป็น Deload ให้ลด Volume และไม่ไล่ PR":"เพิ่มน้ำหนักเมื่อทำครบทุกเซ็ตและถึงช่วงครั้งบนสุด โดยเพิ่มประมาณ 1 กก. ต่อดัมเบล";return commanderText()}

function addChat(role,text){state.chat.push({role,text,date:new Date().toISOString()});if(state.chat.length>60)state.chat=state.chat.slice(-60);save()}
function readiness(){
 const l=latest(),n=nutritionToday(),p=state.profile;
 return Math.round(Math.min(30,(l.sleep||0)/Math.max(1,p.sleepTarget)*30)+Math.min(22,pct(n.protein,p.proteinTarget)*.22)+Math.min(13,pct(n.carbs,p.carbTarget)*.13)+Math.min(10,pct(n.fat,p.fatTarget)*.10)+Math.min(15,pct(n.waterMl,waterGoalMl())*.15)+Math.min(10,streak()/7*10));
}
function discipline(){
 const l=latest(),n=nutritionToday(),p=state.profile;let s=state.done[todayIndex()+1]?35:0;
 s+=Math.min(18,pct(n.protein,p.proteinTarget)*.18)+Math.min(8,pct(n.carbs,p.carbTarget)*.08)+Math.min(7,pct(n.fat,p.fatTarget)*.07)+Math.min(12,pct(n.waterMl,waterGoalMl())*.12)+(l.sleep>=p.sleepTarget?12:l.sleep>=6?6:0)+Math.min(8,streak()/7*8);
 return Math.round(Math.min(100,s));
}
function commanderText(){
 const l=latest(),n=nutritionToday(),p=state.profile,r=readiness(),phase=workoutFor(todayIndex()+1).phase;
 if(phase.deload)return"สัปดาห์ "+phase.name+" ลดจำนวนเซ็ตและไม่ไล่ PR เพื่อให้ร่างกายฟื้นตัว";
 if(l.sleep&&l.sleep<6)return"เมื่อคืนพักน้อย ลดน้ำหนักฝึกประมาณ 10% และตัด Finisher หากฟอร์มเริ่มตก";
 if(n.waterMl<waterGoalMl()*.45)return"น้ำยังต่ำ ควรเติมอีก "+Math.min(500,Math.max(250,waterGoalMl()-n.waterMl))+" ml ก่อนฝึก";
 if(r>=80)return"ความพร้อมดี ทำโปรแกรมเต็ม และเพิ่มน้ำหนักเฉพาะท่าที่ทำครบช่วงครั้งครั้งก่อน";
 if(n.protein<p.proteinTarget*.5)return"โปรตีนยังต่ำ วันนี้ควรเพิ่มอีกประมาณ "+Math.max(0,p.proteinTarget-n.protein)+" กรัมเพื่อช่วยฟื้นตัว";
 return"ทำภารกิจตามแผน รักษาฟอร์ม และหยุดก่อนหมดแรงประมาณ 1–2 ครั้ง";
}
function achievements(){
 const d=doneCount(),s=streak(),p=Object.keys(state.prs).length,n=nutritionToday(),ph=Object.keys(state.photos).length;
 return[["🎖️","First Mission",d>=1],["🔥","7-Day Streak",s>=7],["🏆","First PR",p>=1],["📸","Progress Photo",ph>=1],["🛡️","30 Missions",d>=30],["⭐","84 Days",d>=84],["💧","Hydration",n.waterMl>=waterGoalMl()],["🥩","Protein",n.protein>=state.profile.proteinTarget]];
}
function initNav(){
 const desktopHtml=NAV.map(x=>'<button data-page="'+x[0]+'">'+x[1]+'</button>').join("");
 const mobileItems=[
  ["commandPage","Home"],
  ["workoutPage","Workout"],
  ["nutritionPage","Nutrition"],
  ["progressPage","Progress"],
  ["settingsPage","More"]
 ];
 $("sideNav").innerHTML=desktopHtml;
 $("bottomNav").innerHTML=mobileItems.map(x=>'<button data-page="'+x[0]+'">'+x[1]+'</button>').join("");
 document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
}
function showPage(id){
 document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
 document.querySelectorAll("[data-page]").forEach(b=>b.classList.remove("active"));
 $(id).classList.add("active");document.querySelectorAll('[data-page="'+id+'"]').forEach(b=>b.classList.add("active"));
 renderAll();window.scrollTo(0,0);
}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1700)}
function stat(label,value){return'<div class="stat"><span>'+label+'</span><strong>'+value+'</strong></div>'}
function renderAll(){renderSidebar();renderCommand();renderWorkout();renderCalendar();renderNutrition();renderProgress();renderCoach();renderAnalytics();renderLibrary();renderSettings()}
function renderSidebar(){const r=rankInfo();$("sideRank").textContent=r.current.name;$("sideXp").style.width=r.progress+"%"}
function macroRing(label,value,target,unit,color){
 const percent=Math.round(pct(value,target));
 const display=unit==="L"?(value/1000).toFixed(2):Math.round(value);
 const goal=unit==="L"?(target/1000).toFixed(2):Math.round(target);
 return '<div class="macro-ring" style="--ring-pct:'+percent+';--ring-color:'+color+'"><div><strong>'+percent+'%</strong><span>'+label+'</span><small>'+display+'/'+goal+' '+unit+'</small></div></div>';
}
function renderCommand(){
 const day=todayIndex()+1,w=workoutFor(day),l=latest(),n=nutritionToday(),p=state.profile,completed=doneCount(),campaign=Math.round(completed/84*100);
 const target=+p.targetWeight,current=+l.weight||67.1,start=state.checkins[0]?.weight||state.scans[0]?.weight||67.1;
 const bodyProgress=Math.max(0,Math.min(100,(start-current)/Math.max(.1,start-target)*100));
 const orders=[
  ["Workout",w.name,!!state.done[day]],
  ["Protein",n.protein+"/"+p.proteinTarget+" g",n.protein>=p.proteinTarget],
  ["Carbs",n.carbs+"/"+p.carbTarget+" g",n.carbs>=p.carbTarget],
  ["Fat",n.fat+"/"+p.fatTarget+" g",n.fat>=p.fatTarget],
  ["Water",(n.waterMl/1000).toFixed(2)+"/"+(waterGoalMl()/1000).toFixed(2)+" L",n.waterMl>=waterGoalMl()],
  ["Sleep",(l.sleep||0)+"/"+p.sleepTarget+" h",(l.sleep||0)>=p.sleepTarget]
 ];
 $("commandPage").innerHTML=`
 <div class="hud">
  <div class="card hero">
   <div class="hero-noise"></div>
   <div class="hero-copy"><span class="eyebrow">GOOD MORNING, COMMANDER</span><h1>${p.name}</h1><div class="v7-mission-focus"><span class="eyebrow">MISSION FOCUS</span><strong>Stay Ready.<br>Get Stronger.</strong><div class="v7-quote">“Discipline today creates freedom tomorrow.”</div></div><span class="eyebrow" style="display:block;margin-top:15px">LEVEL</span><div class="level">${level()}</div><strong>${rank()}</strong> <span class="phase-badge">${w.phase.name}</span><div class="bar" style="margin:8px 0"><i style="width:${completed/84*100}%"></i></div><span class="muted">${xpTotal().toLocaleString()} XP</span><br><button class="btn primary" id="startMission" style="margin-top:14px">Start Workout</button></div>
   <div class="hero-person-wrap"><img src="${HERO_IMAGE}" alt="Goal physique"></div><div class="hero-fade"></div>
   <div class="target-panel"><span class="eyebrow">DIGITAL TARGET</span><div class="target-grid"><div><span class="muted">Current</span><strong>${current.toFixed(1)} kg</strong><small>${l.bf||"-"}% BF</small></div><div class="arrow">›</div><div><span class="muted">Target</span><strong>${p.targetWeightLabel}</strong><small>${p.targetBfLabel}</small></div></div><div class="bar" style="margin-top:10px"><i style="width:${bodyProgress}%"></i></div><div class="target-meta"><span>${Math.max(0,current-target).toFixed(1)} kg to go</span><strong>${Math.round(bodyProgress)}%</strong></div></div>
  </div>
  <div class="hud-side">
   <div class="card"><span class="eyebrow">COMBAT READINESS</span><div class="readiness-wrap" style="margin-top:10px"><div class="readiness-ring" style="--score:${readiness()}"><div><strong>${readiness()}</strong><span>/100</span></div></div><div class="score-list"><div class="score-item"><span>Training</span><strong>${state.done[day]?100:70}</strong></div><div class="score-item"><span>Nutrition</span><strong>${nutritionScore()}</strong></div><div class="score-item"><span>Recovery</span><strong>${Math.round(pct(l.sleep,p.sleepTarget))}</strong></div><div class="score-item"><span>Discipline</span><strong>${discipline()}</strong></div></div></div></div>
   <div class="card"><span class="eyebrow">TODAY ORDERS</span><div class="macro-rings" style="margin-top:12px">${macroRing("Calories",n.calories,p.calorieTarget,"kcal","#ff6a00")}${macroRing("Protein",n.protein,p.proteinTarget,"g","#79df4f")}${macroRing("Carbs",n.carbs,p.carbTarget,"g","#4ca8ff")}${macroRing("Fat",n.fat,p.fatTarget,"g","#ffc857")}${macroRing("Water",n.waterMl,waterGoalMl(),"L","#50cfff")}</div><div class="orders" style="margin-top:12px">${orders.map(o=>'<div class="order '+(o[2]?"done":"")+'"><div><strong>'+o[0]+'</strong><div class="muted">'+o[1]+'</div></div><span>'+(o[2]?"✓":"○")+'</span></div>').join("")}</div></div>
  </div>
 </div>
 <div class="stats" style="margin-top:11px">${stat("Day",day+"/84")}${stat("Week",(Math.floor((day-1)/7)+1)+"/12")}${stat("Phase",w.phase.name)}${stat("Weight",current.toFixed(1)+" kg")}${stat("Sets",completedSets())}${stat("XP",xpTotal().toLocaleString())}</div>
 <div class="card" style="margin-top:11px"><div class="space"><div><span class="eyebrow">84-DAY TRANSFORMATION TIMELINE</span><h2>Operation Progress</h2></div><strong>${campaign}% Complete</strong></div><div class="bar"><i style="width:${campaign}%"></i></div><div class="timeline84" style="margin-top:12px">${Array.from({length:84},(_,i)=>'<button class="daycell '+(state.done[i+1]?"done ":"")+(i<todayIndex()&&!state.done[i+1]?"missed ":"")+(i===todayIndex()?"today ":"")+(i>todayIndex()?"future":"")+'" data-timeline-day="'+(i+1)+'">'+(i+1)+'</button>').join("")}</div><div class="legend"><span><i class="dot today"></i>Today</span><span><i class="dot done"></i>Completed</span><span><i class="dot missed"></i>Missed</span><span><i class="dot"></i>Upcoming</span></div><p class="muted" style="margin:9px 0 0">Day ${day} of 84 • Completed ${completed} missions • Remaining ${84-day} days</p></div>
 <div class="card" style="margin-top:11px"><span class="eyebrow">QUICK ACTIONS</span><div class="quick-actions" style="margin-top:10px"><button id="qaWorkout" class="quick-action primary"><span class="icon">▶</span><div><strong>Start Workout</strong><small>Begin today's mission</small></div></button><button id="qaNutrition" class="quick-action"><span class="icon">N</span><div><strong>Fuel Up</strong><small>Log nutrition</small></div></button><button id="qaProgress" class="quick-action"><span class="icon">P</span><div><strong>View Progress</strong><small>Track results</small></div></button><button id="qaCoach" class="quick-action"><span class="icon">AI</span><div><strong>AI Commander</strong><small>Daily guidance</small></div></button><button id="qaCalendar" class="quick-action"><span class="icon">84</span><div><strong>Operation Calendar</strong><small>Plan your day</small></div></button></div></div>
 <div class="card" style="margin-top:11px"><span class="eyebrow">ACHIEVEMENTS</span><div class="achievement-grid" style="margin-top:10px">${achievements().map(a=>'<div class="achievement '+(a[2]?"unlocked":"")+'"><div class="icon">'+a[0]+'</div><strong>'+a[1]+'</strong></div>').join("")}</div></div>`;
 $("startMission").onclick=$("qaWorkout").onclick=()=>{state.selectedDay=day;save();showPage("workoutPage")};
 $("qaNutrition").onclick=()=>showPage("nutritionPage");$("qaProgress").onclick=()=>showPage("progressPage");$("qaCoach").onclick=()=>showPage("coachPage");$("qaCalendar").onclick=()=>showPage("calendarPage");
 document.querySelectorAll("[data-timeline-day]").forEach(b=>b.onclick=()=>{state.selectedDay=+b.dataset.timelineDay;save();showPage("workoutPage")});
}
function previousLog(day,ei){for(let d=day-7;d>=1;d-=7){if(state.logs["d"+d]?.[ei])return state.logs["d"+d][ei]}return null}
function suggestion(day,ei,ex){
 const p=previousLog(day,ei);if(!p)return"เริ่มน้ำหนักที่ยังเหลือแรงประมาณ 2 ครั้ง";
 const sets=(p.sets||[]).filter(s=>s.done),max=Math.max(0,...sets.map(s=>+s.weight||0)),target=parseInt(ex.reps),good=sets.length===ex.sets&&sets.every(s=>(+s.reps||0)>=target);
 return good&&max?"เพิ่มเป็น "+Math.min(32,max+1)+" กก.":"รักษาน้ำหนักเดิมและทำให้ครบช่วงครั้ง";
}
function renderWorkout(){
 const day=state.selectedDay||todayIndex()+1,w=workoutFor(day),key="d"+day;state.logs[key]??={};
 $("workoutPage").innerHTML='<div class="card"><div class="space"><div><span class="eyebrow">MISSION • DAY '+day+'</span><h2>'+w.name+'</h2><p class="muted">'+w.focus+' • '+w.duration+' นาที • <span class="phase-badge">'+w.phase.name+'</span></p></div><select id="daySelect" style="width:auto">'+Array.from({length:84},(_,i)=>'<option value="'+(i+1)+'" '+(i+1===day?"selected":"")+'>Day '+(i+1)+' — '+workoutFor(i+1).name+'</option>').join("")+'</select></div><button id="finishWorkout" class="btn primary">'+(state.done[day]?"Mission Complete ✓":"Complete Mission")+'</button> <button id="restTimer" class="btn ghost">Rest Timer</button></div><div class="card" style="margin-top:11px">'+w.exercises.map((ex,ei)=>exerciseCard(day,key,ex,ei)).join("")+'</div>';
 document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>document.querySelector('[data-ex="'+b.dataset.toggle+'"]').classList.toggle("open"));
 document.querySelectorAll("[data-guide]").forEach(b=>b.onclick=()=>openGuide(w.exercises[+b.dataset.guide]));
 document.querySelectorAll("[data-weight]").forEach(e=>e.onchange=()=>updateSet(day,key,e.dataset.weight,"weight",e.value));
 document.querySelectorAll("[data-reps]").forEach(e=>e.onchange=()=>updateSet(day,key,e.dataset.reps,"reps",e.value));
 document.querySelectorAll("[data-done]").forEach(e=>e.onchange=()=>updateSet(day,key,e.dataset.done,"done",e.checked));
 $("daySelect").onchange=()=>{state.selectedDay=+$("daySelect").value;save();renderWorkout()};
 $("restTimer").onclick=()=>openTimer(90);
 $("finishWorkout").onclick=()=>{state.done[day]=!state.done[day];save();toast(state.done[day]?"MISSION COMPLETE +120 XP":"Mission reopened");renderWorkout()};
}
function exerciseCard(day,key,ex,ei){
 state.logs[key][ei]??={sets:Array.from({length:ex.sets},()=>({weight:"",reps:"",done:false}))};
 const log=state.logs[key][ei],count=log.sets.filter(s=>s.done).length,p=previousLog(day,ei),best=(p?.sets||[]).filter(s=>s.done).sort((a,b)=>(+b.weight||0)-(+a.weight||0))[0];
 return'<div class="compact '+(ei===0||count?"open":"")+'" data-ex="'+ei+'"><div class="compact-head"><button class="demo" data-guide="'+ei+'">'+icon(ex.name)+'</button><div><strong>'+ex.name+'</strong><div class="meta"><span>'+ex.sets+' sets</span><span>'+ex.reps+'</span><span>'+ex.rest+'s rest</span></div><div class="exercise-muscles">'+muscleInfo(ex.name).labels.map(x=>'<span class="muscle-chip">'+x+'</span>').join("")+'</div></div><span class="badge">'+count+'/'+ex.sets+'</span><button class="toggle" data-toggle="'+ei+'">⌄</button></div><div class="compact-body"><div class="last-next"><div><span>LAST</span><strong>'+(best?(best.weight||"-")+" kg × "+(best.reps||"-"):"No data")+'</strong></div><div><span>NEXT</span><strong>'+suggestion(day,ei,ex)+'</strong></div></div><div class="set-table"><div class="set-row head"><span>SET</span><span>KG</span><span>REPS</span><span>✓</span></div>'+log.sets.map((s,si)=>'<div class="set-row '+(s.done?"done":"")+'"><strong>'+(si+1)+'</strong><input data-weight="'+ei+'-'+si+'" value="'+(s.weight||"")+'"><input type="number" data-reps="'+ei+'-'+si+'" value="'+(s.reps||"")+'"><input type="checkbox" data-done="'+ei+'-'+si+'" '+(s.done?"checked":"")+'></div>').join("")+'</div></div></div>';
}
function updateSet(day,key,compound,field,value){
 const[ei,si]=compound.split("-").map(Number),set=state.logs[key][ei].sets[si];set[field]=value;
 if(field==="done"&&value)checkPR(workoutFor(day).exercises[ei].name,set);save();renderWorkout();
}
function checkPR(name,set){
 const w=+set.weight||0,r=+set.reps||0,score=(w||1)*(r||1),old=state.prs[name]?.score||0;
 if(score>old){state.prs[name]={score,weight:set.weight,reps:set.reps,date:iso(new Date())};save();toast("NEW PR: "+name)}
}
function renderCalendar(){
 const y=calendarDate.getFullYear(),m=calendarDate.getMonth(),start=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();
 let cells=["จ","อ","พ","พฤ","ศ","ส","อา"].map(x=>'<div class="dow">'+x+'</div>').join("");for(let i=0;i<start;i++)cells+="<div></div>";
 for(let d=1;d<=days;d++){const dt=new Date(y,m,d),i=dayIndex(dt),valid=i>=0&&i<84,done=valid&&state.done[i+1],miss=valid&&i<todayIndex()&&!done;cells+='<button class="cal '+(iso(dt)===iso(new Date())?"today ":"")+(done?"done ":"")+(miss?"missed ":"")+'" '+(valid?'data-calendar-day="'+(i+1)+'"':"disabled")+'><strong>'+d+'</strong>'+(valid?'<small>Day '+(i+1)+'<br>'+workoutFor(i+1).name+'</small>':'')+(done?'<span class="mark">✓</span>':miss?'<span class="mark">✕</span>':'')+'</button>'}
 $("calendarPage").innerHTML='<div class="card"><div class="space"><div><span class="eyebrow">84-DAY OPERATION</span><h2>'+new Intl.DateTimeFormat("th-TH",{month:"long",year:"numeric"}).format(calendarDate)+'</h2></div><div><button id="calPrev" class="btn ghost">‹</button> <button id="calNext" class="btn ghost">›</button></div></div><div class="calendar-grid">'+cells+'</div></div>';
 document.querySelectorAll("[data-calendar-day]").forEach(b=>b.onclick=()=>{state.selectedDay=+b.dataset.calendarDay;save();showPage("workoutPage")});
 $("calPrev").onclick=()=>{calendarDate=new Date(y,m-1,1);renderCalendar()};$("calNext").onclick=()=>{calendarDate=new Date(y,m+1,1);renderCalendar()};
}
const QUICK=[["ไข่ต้ม 2 ฟอง",140,12,1,10],["อกไก่ 150g",250,45,0,6],["โปรตีนเชค",130,25,4,2],["ข้าว 1 ทัพพี",130,3,28,0],["กล้วย 1 ลูก",105,1,27,0],["กรีกโยเกิร์ต",120,15,8,2]];
function renderNutrition(){
 const date=state.selectedNutritionDate||todayKey(),n=nutritionFor(date),p=state.profile;
 $("nutritionPage").innerHTML=`
 <div class="card"><div class="space"><div><span class="eyebrow">FUEL STATUS</span><h2>โภชนาการรายวัน</h2></div><div class="nutrition-date"><button id="nutritionPrev" class="btn ghost">‹</button><input id="nutritionDate" type="date" value="${date}"><button id="nutritionNext" class="btn ghost">›</button></div></div><div class="macro-rings" style="margin-top:14px">${macroRing("Calories",n.calories,p.calorieTarget,"kcal","#ff6a00")}${macroRing("Protein",n.protein,p.proteinTarget,"g","#79df4f")}${macroRing("Carbs",n.carbs,p.carbTarget,"g","#4ca8ff")}${macroRing("Fat",n.fat,p.fatTarget,"g","#ffc857")}${macroRing("Water",n.waterMl,waterGoalMl(),"L","#50cfff")}</div></div>
 <div class="two grid" style="margin-top:11px">
  <div class="card"><div class="space"><div><span class="eyebrow">MEALS</span><h2>มื้ออาหาร</h2></div><button id="customFood" class="btn ghost">+ เพิ่มอาหาร</button></div>${["Breakfast","Lunch","Dinner","Snack"].map((x,i)=>'<button class="meal '+(n.meals[i]?"done":"")+'" data-meal="'+i+'"><strong>'+x+'</strong><span>'+(n.meals[i]?"✓":"○")+'</span></button>').join("")}<div class="quick">${QUICK.map((x,i)=>'<button data-quick="'+i+'">+ '+x[0]+'</button>').join("")}</div></div>
  <div class="grid">
   <div class="card"><span class="eyebrow">HYDRATION</span><h2>${(n.waterMl/1000).toFixed(2)} / ${(waterGoalMl()/1000).toFixed(2)} L</h2><div class="bar"><i style="width:${pct(n.waterMl,waterGoalMl())}%"></i></div><div class="water-controls" style="margin-top:12px"><button data-water-add="100">+100 ml</button><button data-water-add="250">+250 ml</button><button data-water-add="500">+500 ml</button><button data-water-add="750">+750 ml</button><button data-water-add="1000">+1 L</button><button id="customWater">Custom</button></div><button id="undoWater" class="btn ghost" style="margin-top:10px">-250 ml</button></div>
   <div class="card"><span class="eyebrow">COMMANDER SUGGESTION</span><div class="order"><div><strong>Protein remaining</strong><div class="muted">${Math.max(0,p.proteinTarget-n.protein)} g</div></div></div><div class="order"><div><strong>Carbs remaining</strong><div class="muted">${Math.max(0,p.carbTarget-n.carbs)} g</div></div></div><div class="order"><div><strong>Fat remaining</strong><div class="muted">${Math.max(0,p.fatTarget-n.fat)} g</div></div></div><div class="order"><div><strong>Water remaining</strong><div class="muted">${Math.max(0,waterGoalMl()-n.waterMl)} ml</div></div></div></div>
   <div class="card"><span class="eyebrow">FOOD LOG</span>${n.foods.length?n.foods.slice().reverse().map(f=>'<div class="order"><div><strong>'+f.name+'</strong><div class="muted">'+f.cal+' kcal • P'+f.p+' C'+f.c+' F'+f.f+'</div></div><button class="btn ghost" data-remove-food="'+f.id+'">ลบ</button></div>').join(""):'<p class="muted">ยังไม่มีอาหารที่บันทึกในวันนี้</p>'}</div>
  </div>
 </div>`;
 document.querySelectorAll("[data-meal]").forEach(b=>b.onclick=()=>{n.meals[b.dataset.meal]=!n.meals[b.dataset.meal];save();renderNutrition()});
 document.querySelectorAll("[data-quick]").forEach(b=>b.onclick=()=>addFood(QUICK[+b.dataset.quick],date));
 document.querySelectorAll("[data-water-add]").forEach(b=>b.onclick=()=>{n.waterMl+=+b.dataset.waterAdd;save();renderNutrition()});
 document.querySelectorAll("[data-remove-food]").forEach(b=>b.onclick=()=>removeFood(+b.dataset.removeFood,date));
 $("customFood").onclick=()=>customFood(date);
 $("customWater").onclick=()=>{const ml=+(prompt("ปริมาณน้ำ (ml)",350)||0);if(ml>0){n.waterMl+=ml;save();renderNutrition()}};
 $("undoWater").onclick=()=>{n.waterMl=Math.max(0,n.waterMl-250);save();renderNutrition()};
 $("nutritionDate").onchange=()=>{state.selectedNutritionDate=$("nutritionDate").value;renderNutrition()};
 $("nutritionPrev").onclick=()=>shiftNutritionDate(-1);$("nutritionNext").onclick=()=>shiftNutritionDate(1);
}
function shiftNutritionDate(delta){const d=new Date((state.selectedNutritionDate||todayKey())+"T12:00:00");d.setDate(d.getDate()+delta);state.selectedNutritionDate=iso(d);renderNutrition()}
function addFood(f,date=todayKey()){const n=nutritionFor(date),[name,cal,p,c,fat]=f;n.foods.push({id:Date.now(),name,cal,p,c,f:fat});n.calories+=cal;n.protein+=p;n.carbs+=c;n.fat+=fat;save();renderNutrition()}
function removeFood(id,date=todayKey()){const n=nutritionFor(date),f=n.foods.find(x=>x.id===id);if(!f)return;n.foods=n.foods.filter(x=>x.id!==id);n.calories=Math.max(0,n.calories-f.cal);n.protein=Math.max(0,n.protein-f.p);n.carbs=Math.max(0,n.carbs-f.c);n.fat=Math.max(0,n.fat-f.f);save();renderNutrition()}
function customFood(date=todayKey()){const name=prompt("ชื่ออาหาร");if(!name)return;addFood([name,+(prompt("Calories",0)||0),+(prompt("Protein g",0)||0),+(prompt("Carbs g",0)||0),+(prompt("Fat g",0)||0)],date)}
function renderProgress(){
 const l=latest();
 $("progressPage").innerHTML='<div class="two grid"><div class="card"><span class="eyebrow">WEEKLY CHECK-IN</span><h2>บันทึกผล</h2><input id="checkDate" type="date" value="'+iso(new Date())+'"><input id="checkWeight" type="number" step=".1" placeholder="น้ำหนัก"><input id="checkBf" type="number" step=".1" placeholder="Body Fat %"><input id="checkWaist" type="number" step=".1" placeholder="รอบเอว"><input id="checkSleep" type="number" step=".5" placeholder="นอน ชม."><button id="saveCheck" class="btn primary">บันทึก</button></div><div class="card"><span class="eyebrow">BODY STATUS</span>'+stat("Weight",l.weight+" kg")+stat("Body Fat",(l.bf||"-")+"%")+stat("Waist",(l.waist||"-")+" cm")+stat("Readiness",readiness())+'</div></div><div class="chart-grid" style="margin-top:11px"><div class="card chart"><span class="eyebrow">WEIGHT TREND</span>'+chart(state.checkins.map(x=>({label:x.date,v:x.weight}))," kg")+'</div><div class="card chart"><span class="eyebrow">BODY FAT TREND</span>'+chart(state.checkins.map(x=>({label:x.date,v:x.bf})),"%")+'</div></div><div class="card" style="margin-top:11px"><span class="eyebrow">PROGRESS PHOTOS</span><div class="photo-grid" style="margin-top:10px">'+photoSlots()+'</div></div><div class="card" style="margin-top:11px"><span class="eyebrow">PERSONAL RECORDS</span><div class="pr-grid" style="margin-top:10px">'+(Object.entries(state.prs).length?Object.entries(state.prs).map(([n,p])=>'<div class="pr"><span class="muted">'+n+'</span><strong>'+p.weight+' kg × '+p.reps+'</strong><small>'+p.date+'</small></div>').join(""):'<p class="muted">ยังไม่มี PR</p>')+'</div></div>';
 $("saveCheck").onclick=saveCheck;document.querySelectorAll("[data-photo]").forEach(i=>i.onchange=()=>savePhoto(i.dataset.photo,i.files[0]));
}
function chart(values,suffix){
 const clean=values.filter(x=>x.v!=null&&!isNaN(x.v));if(clean.length<2)return'<p class="muted">บันทึกอย่างน้อย 2 ครั้งเพื่อดูกราฟ</p>';
 const W=600,H=175,P=28,min=Math.min(...clean.map(x=>+x.v)),max=Math.max(...clean.map(x=>+x.v)),range=Math.max(.1,max-min),pts=clean.map((x,i)=>({x:P+i*(W-P*2)/(clean.length-1),y:H-P-(x.v-min)/range*(H-P*2),v:x.v,label:x.label})),path=pts.map((p,i)=>(i?"L":"M")+p.x+","+p.y).join(" ");
 return'<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="#333"/><path d="'+path+'" fill="none" stroke="#ff6500" stroke-width="3"/>'+pts.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="5" fill="#ff9a3d"><title>'+p.label+': '+p.v+suffix+'</title></circle>').join("")+'</svg>';
}
function photoSlots(){const week=Math.floor(todayIndex()/7)+1;return["Front","Side","Back"].map(pos=>{const key="W"+week+"-"+pos,src=state.photos[key];return'<div class="photo">'+(src?'<img src="'+src+'">':'<label style="cursor:pointer;text-align:center">'+pos+'<br><span class="muted">แตะเพื่อเลือกรูป</span><input type="file" accept="image/*" data-photo="'+key+'" hidden></label>')+'</div>'}).join("")}
async function savePhoto(key,file){
 if(!file)return;
 try{
  const data=await compressPhoto(file,480,.72);
  state.photos[key]=data;save();renderProgress();toast("บีบอัดและบันทึกรูปแล้ว");
 }catch(e){alert("ไม่สามารถอ่านรูปนี้ได้")}
}
function compressPhoto(file,maxSide=480,quality=.72){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=reject;
  reader.onload=()=>{
   const img=new Image();
   img.onerror=reject;
   img.onload=()=>{
    const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
    const canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
    canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
    resolve(canvas.toDataURL("image/jpeg",quality));
   };
   img.src=reader.result;
  };
  reader.readAsDataURL(file);
 });
}
function saveCheck(){const date=$("checkDate").value,weight=+$("checkWeight").value;if(!date||!weight)return alert("กรอกวันที่และน้ำหนัก");state.checkins=state.checkins.filter(x=>x.date!==date);state.checkins.push({date,weight,bf:+$("checkBf").value||null,waist:+$("checkWaist").value||null,sleep:+$("checkSleep").value||null});state.checkins.sort((a,b)=>a.date.localeCompare(b.date));save();maybeApplySmartTargets(false);renderProgress();toast("บันทึกแล้ว")}
function renderCoach(){
 if(!state.chat.length)addChat("ai","พร้อมรับคำสั่งครับ Commander ถามเรื่อง Workout, โปรตีน, น้ำ, Recovery หรือเป้าหมายได้");
 $("coachPage").innerHTML=`<div class="two grid"><div class="card chat-shell"><div><span class="eyebrow">OFFLINE AI COMMANDER</span><h2>Coach Console</h2><div class="chat-log">${state.chat.map(m=>'<div class="bubble '+(m.role==="user"?"user":"ai")+'">'+m.text+'</div>').join("")}</div></div><div class="chat-compose"><input id="chatInput" placeholder="ถาม Commander..."><button id="chatSend" class="btn primary">ส่ง</button></div></div><div class="grid"><div class="card"><span class="eyebrow">DAILY BRIEF</span><div class="order"><span class="icon">AI</span><div><strong>Commander analysis</strong><div class="muted">${commanderText()}</div></div></div></div><div class="card"><span class="eyebrow">STATUS</span><div class="score-list"><div class="score-item"><span>Readiness</span><strong>${readiness()}</strong></div><div class="score-item"><span>Discipline</span><strong>${discipline()}</strong></div><div class="score-item"><span>Nutrition</span><strong>${nutritionScore()}</strong></div><div class="score-item"><span>Streak</span><strong>${streak()} days</strong></div></div></div><div class="card"><span class="eyebrow">QUICK QUESTIONS</span><div class="quick"><button data-q="วันนี้เล่นอะไรดี">วันนี้เล่นอะไร</button><button data-q="โปรตีนเหลือเท่าไร">โปรตีน</button><button data-q="ควรเพิ่มน้ำหนักไหม">เพิ่มน้ำหนัก</button><button data-q="Recovery วันนี้เป็นยังไง">Recovery</button></div></div></div></div>`;
 const send=()=>{const q=$("chatInput").value.trim();if(!q)return;addChat("user",q);addChat("ai",offlineCommander(q));renderCoach()};
 $("chatSend").onclick=send;$("chatInput").onkeydown=e=>{if(e.key==="Enter")send()};document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{$("chatInput").value=b.dataset.q;send()});
}
function renderAnalytics(){
 const vols=exerciseVolumes(),maxV=Math.max(1,...Object.values(vols));
 $("analyticsPage").innerHTML=`<div class="card"><span class="eyebrow">PERFORMANCE ANALYTICS</span><h2>Training Intelligence</h2><div class="analytics-grid"><div class="metric-card"><span>Workouts</span><strong>${doneCount()}</strong></div><div class="metric-card"><span>Total Sets</span><strong>${completedSets()}</strong></div><div class="metric-card"><span>Total Volume</span><strong>${totalVolume().toLocaleString()}</strong></div><div class="metric-card"><span>XP</span><strong>${xpTotal().toLocaleString()}</strong></div><div class="metric-card"><span>Weight Change</span><strong>${bodyChange()} kg</strong></div><div class="metric-card"><span>Body Fat Change</span><strong>${bodyFatChange()}%</strong></div><div class="metric-card"><span>Streak</span><strong>${streak()} days</strong></div><div class="metric-card"><span>PRs</span><strong>${Object.keys(state.prs).length}</strong></div></div></div><div class="two grid" style="margin-top:11px"><div class="card"><span class="eyebrow">MUSCLE VOLUME</span><h2>Training Balance</h2><div class="volume-bars">${Object.keys(vols).length?Object.entries(vols).sort((a,b)=>b[1]-a[1]).map(([m,v])=>'<div class="volume-row"><strong>'+m+'</strong><div class="volume-track"><i style="width:'+(v/maxV*100)+'%"></i></div><span>'+Math.round(v).toLocaleString()+'</span></div>').join(""):'<p class="muted">เริ่มบันทึก Workout เพื่อดูข้อมูล</p>'}</div></div><div class="card"><span class="eyebrow">WEIGHT TREND</span>${chart(state.checkins.map(x=>({label:x.date,v:x.weight}))," kg")}</div></div><div class="card" style="margin-top:11px"><span class="eyebrow">WEEKLY REPORT</span><div class="report-grid" style="margin-top:10px"><div class="report-block"><span class="muted">Missions</span><h2>${weeklyMissionCount()}/7</h2></div><div class="report-block"><span class="muted">Nutrition Score</span><h2>${nutritionScore()}</h2></div><div class="report-block"><span class="muted">Commander Grade</span><h2>${discipline()>=90?"A+":discipline()>=80?"A":discipline()>=70?"B":"C"}</h2></div></div></div>`;
}
function renderLibrary(){
 const all=[];WORKOUTS.forEach(w=>w.exercises.forEach(ex=>{if(!all.some(x=>x.name===ex.name))all.push(ex)}));
 $("libraryPage").innerHTML=`<div class="card"><div class="space"><div><span class="eyebrow">EXERCISE LIBRARY</span><h2>${all.length} Exercises</h2></div><input id="librarySearch" placeholder="ค้นหาท่า..." style="max-width:260px;margin:0"></div></div><div id="libraryGrid" class="library-grid" style="margin-top:11px"></div>`;
 const draw=(q="")=>{$("libraryGrid").innerHTML=all.filter(ex=>(ex.name+" "+muscleInfo(ex.name).labels.join(" ")).toLowerCase().includes(q.toLowerCase())).map((ex,i)=>'<div class="library-card"><div class="library-card-head"><div class="demo">'+icon(ex.name)+'</div><div><strong>'+ex.name+'</strong><div class="exercise-muscles">'+muscleInfo(ex.name).labels.map(x=>'<span class="muscle-chip">'+x+'</span>').join("")+'</div></div><button class="toggle" data-open-lib="'+i+'">⌄</button></div><div class="tips"><strong>Sets & Reps</strong><p class="muted">'+ex.sets+' sets • '+ex.reps+' • Rest '+ex.rest+'s</p><button class="btn primary" data-guide-name="'+ex.name.replace(/"/g,"&quot;")+'">เปิดคลิปสาธิต</button></div></div>').join("");document.querySelectorAll("[data-open-lib]").forEach(b=>b.onclick=()=>b.closest(".library-card").classList.toggle("open"));document.querySelectorAll("[data-guide-name]").forEach(b=>b.onclick=()=>{const ex=all.find(x=>x.name===b.dataset.guideName);if(ex)openGuide(ex)})};
 draw();$("librarySearch").oninput=()=>draw($("librarySearch").value);
}
function renderSettings(){
 const p=state.profile;
 $("settingsPage").innerHTML=`<div class="card"><span class="eyebrow">SYSTEM SETTINGS</span><h2>โปรไฟล์ เป้าหมาย และข้อมูล</h2>
 <div class="two grid">
  <div><label>ชื่อ<input id="profileName" value="${p.name}"></label><label>วันเริ่มโปรแกรม<input id="startDate" type="date" value="${state.start}"></label><label>น้ำหนักเป้าหมาย (kg)<input id="targetWeight" type="number" step=".1" value="${p.targetWeight}"></label><label>Body Fat เป้าหมาย (%)<input id="targetBf" type="number" step=".1" value="${p.targetBf}"></label></div>
  <div><label>Calories Target<input id="calorieTarget" type="number" value="${p.calorieTarget}"></label><label>Protein Target (g)<input id="proteinTarget" type="number" value="${p.proteinTarget}"></label><label>Carb Target (g)<input id="carbTarget" type="number" value="${p.carbTarget}"></label><label>Fat Target (g)<input id="fatTarget" type="number" value="${p.fatTarget}"></label><label>น้ำต่อกิโลกรัม (ml/kg)<input id="waterPerKg" type="number" value="${p.waterMlPerKg}"></label><label>น้ำเพิ่มในวันฝึก (ml)<input id="workoutWater" type="number" value="${p.workoutWaterMl}"></label><label>ส่วนสูง (cm)<input id="heightCm" type="number" value="${p.heightCm}"></label><label>อายุ<input id="profileAge" type="number" value="${p.age}"></label><label>ระดับกิจกรรม<select id="activityFactor"><option value="1.3" ${p.activityFactor==1.3?"selected":""}>เบา</option><option value="1.45" ${p.activityFactor==1.45?"selected":""}>ปานกลาง</option><option value="1.6" ${p.activityFactor==1.6?"selected":""}>ค่อนข้างสูง</option></select></label><label>Calorie Deficit (%)<input id="deficitPct" type="number" value="${p.calorieDeficitPct}"></label><label><input id="smartTargets" type="checkbox" ${p.smartTargets?"checked":""} style="width:auto"> ปรับเป้าสารอาหารอัตโนมัติ</label><p class="muted">ค่าที่ระบบแนะนำตอนนี้: ${smartTargetSummary()}</p><button id="applySmartTargets" class="btn ghost">คำนวณและใช้เป้าปัจจุบัน</button></div>
 </div>
 <div class="mobile-more-grid" style="margin-bottom:12px">
  <button class="btn ghost" data-more-page="calendarPage">84 Days</button>
  <button class="btn ghost" data-more-page="coachPage">Commander</button>
  <button class="btn ghost" data-more-page="analyticsPage">Analytics</button>
  <button class="btn ghost" data-more-page="libraryPage">Library</button>
 </div>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="saveSettings" class="btn primary">บันทึก</button><button id="exportData" class="btn ghost">ส่งออก Backup</button><label class="btn ghost">นำเข้า Backup<input id="importData" type="file" hidden accept=".json"></label><button id="resetData" class="btn danger">ล้างข้อมูล</button></div><p class="muted" style="margin-top:14px">ข้อมูลบันทึกอัตโนมัติในเครื่อง และโภชนาการแยกตามวันที่ ควร Export Backup อย่างน้อยสัปดาห์ละครั้ง</p></div>`;
 $("saveSettings").onclick=()=>{
  state.start=$("startDate").value;state.selectedDay=null;
  Object.assign(p,{
   name:$("profileName").value.trim()||"Natachai",
   targetWeight:+$("targetWeight").value||62.5,
   targetWeightLabel:(+$("targetWeight").value||62.5).toFixed(1)+" kg",
   targetBf:+$("targetBf").value||12.5,
   targetBfLabel:(+$("targetBf").value||12.5).toFixed(1)+"% BF",
   calorieTarget:+$("calorieTarget").value||2000,
   proteinTarget:+$("proteinTarget").value||140,
   carbTarget:+$("carbTarget").value||225,
   fatTarget:+$("fatTarget").value||60,
   waterMlPerKg:+$("waterPerKg").value||35,
   workoutWaterMl:+$("workoutWater").value||700,
   heightCm:+$("heightCm").value||167,
   age:+$("profileAge").value||30,
   activityFactor:+$("activityFactor").value||1.45,
   calorieDeficitPct:+$("deficitPct").value||15,
   smartTargets:$("smartTargets").checked
  });
  save();renderAll();toast("บันทึกแล้ว");
 };
 document.querySelectorAll("[data-more-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.morePage));
 $("applySmartTargets").onclick=()=>{maybeApplySmartTargets(true);renderSettings()};
 $("exportData").onclick=exportData;$("importData").onchange=importData;$("resetData").onclick=()=>{if(confirm("ล้างข้อมูลทั้งหมดหรือไม่?")){state=clone(DEFAULT);save();renderAll()}};
}
function openGuide(ex){openModal('<div class="modal-card"><div class="space"><div><span class="eyebrow">EXERCISE GUIDE</span><h2>'+ex.name+'</h2></div><button data-close class="btn ghost">ปิด</button></div><div class="guide-grid"><div class="guide-demo">'+icon(ex.name)+'</div><div><h3>Target muscles</h3>'+ex.muscles.map(x=>'<span class="tag">'+x+'</span>').join("")+'<h3 style="margin-top:14px">Commander cue</h3><p class="muted">ควบคุมทุกครั้ง เกร็งแกนกลาง และหยุดก่อนฟอร์มเสียประมาณ 1–2 ครั้ง</p><a target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query='+encodeURIComponent(ex.video)+'"><button class="btn primary">เปิดคลิปสาธิต</button></a></div></div></div>')}
function openModal(content){$("modalRoot").innerHTML='<div class="modal show">'+content+'</div>';document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal);$("modalRoot").querySelector(".modal").onclick=e=>{if(e.target.classList.contains("modal"))closeModal()}}
function closeModal(){clearInterval(timer.id);$("modalRoot").innerHTML=""}
function openTimer(sec){timer.sec=sec;openModal('<div class="timer-screen"><div><span class="eyebrow">REST TIMER</span><strong id="timerText">01:30</strong><div><button id="timerMinus" class="btn ghost">-15</button> <button id="timerPlus" class="btn ghost">+15</button> <button data-close class="btn danger">ปิด</button></div></div></div>');drawTimer();timer.id=setInterval(()=>{timer.sec--;drawTimer();if(timer.sec<=0){clearInterval(timer.id);navigator.vibrate?.([250,120,250]);toast("พักครบแล้ว")}},1000);$("timerMinus").onclick=()=>{timer.sec=Math.max(0,timer.sec-15);drawTimer()};$("timerPlus").onclick=()=>{timer.sec+=15;drawTimer()}}
function drawTimer(){if($("timerText"))$("timerText").textContent=String(Math.floor(timer.sec/60)).padStart(2,"0")+":"+String(timer.sec%60).padStart(2,"0")}
function exportData(){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}));a.download="BN-Warrior-V11-Backup-"+todayKey()+".json";a.click()}
async function importData(){try{state=JSON.parse(await $("importData").files[0].text());save();renderAll();toast("นำเข้าข้อมูลแล้ว")}catch(e){alert("ไฟล์ไม่ถูกต้อง")}}
$("backupSide").onclick=$("backupTop").onclick=exportData;
window.addEventListener("error",e=>console.error("BN Warrior:",e.error||e.message));

let deferredInstallPrompt=null;
function updateStorageStatus(){
 const el=document.getElementById("storageStatus");
 if(el)el.innerHTML="<i></i> บันทึกอัตโนมัติแล้ว";
}
async function restoreFromIndexedDB(){
 if(STORE.get(KEY))return false;
 const raw=await IDB.get(KEY);
 if(!raw)return false;
 try{state=Object.assign(clone(DEFAULT),JSON.parse(raw));STORE.set(KEY,raw);return true}catch(e){return false}
}
function showInstallHelp(){
 const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
 const msg=ios
  ?"บน iPhone/iPad: เปิดใน Safari → กดปุ่มแชร์ → เลือก “เพิ่มไปยังหน้าจอโฮม”"
  :"หากปุ่มติดตั้งไม่ขึ้น ให้เปิดเมนูเบราว์เซอร์แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”";
 const root=document.createElement("div");root.className="install-help";
 root.innerHTML='<div class="install-help-card"><span class="eyebrow">INSTALL BN WARRIOR</span><h2>ติดตั้งบนมือถือ</h2><p class="muted">'+msg+'</p><p class="muted">ต้องเปิดผ่าน HTTPS หรือ localhost จึงจะติดตั้งแบบ PWA ได้ การเปิดไฟล์ HTML ตรง ๆ จะบันทึกได้ แต่ติดตั้งเป็นแอปเต็มรูปแบบไม่ได้</p><button class="btn primary">เข้าใจแล้ว</button></div>';
 document.body.appendChild(root);root.querySelector("button").onclick=()=>root.remove();
}
window.addEventListener("beforeinstallprompt",e=>{
 e.preventDefault();deferredInstallPrompt=e;
 const b=document.getElementById("installApp");if(b)b.style.display="";
});
window.addEventListener("appinstalled",()=>{toast("ติดตั้ง BN Warrior แล้ว");const b=document.getElementById("installApp");if(b)b.style.display="none"});
if("serviceWorker" in navigator && location.protocol!=="file:"){
 window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
}
(async()=>{
 await restoreFromIndexedDB();
 initNav();showPage("commandPage");
 const install=document.getElementById("installApp");
 install.onclick=async()=>{
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;install.style.display="none"}
  else showInstallHelp();
 };
 const top=document.querySelector(".topbar>div:last-child");
 if(top){const s=document.createElement("span");s.id="storageStatus";s.className="storage-status";s.innerHTML="<i></i> บันทึกอัตโนมัติ";top.prepend(s)}
 updateStorageStatus();
})();

})();
