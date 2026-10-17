// Run with: node tests/run-tests.js   (no install needed)
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'kama-ledger.html'),'utf8');
const core=html.split('/*CORE*/')[1].split('/*END*/')[0];
const c={};vm.createContext(c);vm.runInContext(core,c);
const exp=JSON.parse(fs.readFileSync(path.join(root,'fixtures/expected.json'),'utf8'));
let fails=0,n=0;const ok=(name,cond,extra='')=>{n++;if(!cond)fails++;console.log((cond?'PASS ':'FAIL ')+name+(extra?'  '+extra:''))};
for(const f of ['runes.txt','rune_astrale.txt','talisman_batch.txt','edge_cases.txt','lots_1000.txt']){
  const r=c.parseLog(fs.readFileSync(path.join(root,'fixtures',f),'utf8'));
  ok('fixture '+f,r.total===exp[f].total&&r.lines===exp[f].lines&&r.flags.length===0,`total ${r.total} lines ${r.lines}`)}
ok('Banque line counted as income',c.parseLog(fs.readFileSync(path.join(root,'fixtures/edge_cases.txt'),'utf8')).income===1839899);
for(const t of exp.tax_rounding)ok('tax '+t.list,c.tax(t.list,'nearest')===t.tax);
ok('tax ceil vs nearest on 100001',c.tax(100001,'ceil')===2001&&c.tax(100001,'nearest')===2000);
ok('shorthand 2m1',c.num('2m1')===2100000);ok('shorthand 50kk',c.num('50kk')===50000000);ok('shorthand 2.3m',c.num('2.3m')===2300000);ok('plain 2 285 800',c.num('2 285 800')===2285800);
const v=JSON.parse(fs.readFileSync(path.join(root,'fixtures/brisage_validation.json'),'utf8'));
v.points.forEach(p=>ok(`brisage ${p.item} ${p.stat}`,Math.abs(c.runesFor(p.jet,p.stat_weight,p.rune_weight,p.level,p.coefficient)-p.observed)<=1));
const odd=c.parseLog('7 x [Y] (50 kamas)\nrandom text');ok('odd quantity and junk are flagged',odd.flags.length===2);
const L=['a 1 x [A] (1 kamas)','b 1 x [B] (2 kamas)','c 1 x [C] (3 kamas)','d 1 x [D] (4 kamas)'];
const s=c.stitch([L.slice(0,3),L.slice(1)]);ok('stitch overlapping captures',s.lines.length===4&&s.warns.length===0);
ok('stitch warns on a gap',c.stitch([L.slice(0,1),L.slice(3)]).warns.length===1);
ok('OCR timestamp junk cleaned',c.normLine('{21:10} 1x [Gil de X] (2 385 kamas)')==='1 x [Gil de X] (2 385 kamas)');
// ---- game data (Datafus format, tiny synthetic sample) ----
{const raw={fr:{'1':'Amulette d\'Oshimo','2':'Pépite','3':'Amulette','4':'#1{~1~2 à }#2 Vitalité','5':'-#1{~1~2 à -}#2 Portée','6':'Dommage{~ps}{~zs} Feu'},
 items:[{id:10,nameId:1,typeId:7,level:196,possibleEffects:[{effectId:125,diceNum:251,diceSide:300}]},{id:11,nameId:2,typeId:9,level:1,possibleEffects:[]}],
 recipes:[{resultId:10,ingredientIds:[11],quantities:[4]}],types:[{id:7,nameId:3}],effects:[{id:125,descriptionId:4},{id:116,descriptionId:5},{id:424,descriptionId:6}]};
 const idx=c.buildIndex(raw),P=c.prepIndex(idx),a=c.pickItem(P,"amulette d'oshimo");
 ok('data: item found, accents and apostrophes ignored',a&&a[0]===10&&a[2]===196&&c.pickItem(P,'PEPITE')[0]===11);
 ok('data: recipe attached',JSON.stringify(a[4])==='[[11,4]]'&&idx.recipes===1);
 ok('data: effect labels cleaned',idx.effs[125]==='Vitalité'&&idx.effs[116]==='Portée'&&idx.effs[424]==='Dommage Feu');
 ok('data: effect range kept',JSON.stringify(a[5])==='[[125,251,300]]'&&idx.types[7]==='Amulette');
 ok('data: suggest typo',c.suggest(P,'Pepit')==='Pépite'&&c.suggest(P,'zzzzzz')===null);
 ok('data: parseLoose accepts NaN',c.parseLoose('{"a":NaN,"b":[1,Infinity,-NaN]}').a===null);
 ok('data: search by prefix',c.searchItems(P,'amu',5).length===1)}
console.log(`\n${n-fails}/${n} passed`);process.exit(fails?1:0);
