// findBands and digits from src/lotrows.js (ES module text evaluated here)
const fs=require('fs'); let s=fs.readFileSync(__dirname+'/../src/lotrows.js','utf8');
s=s.replace(/^import .*$/m,'').replace(/export async function readLotRows[\s\S]*$/,'').replace(/export /g,'');
const f=new Function(s+';return {findBands,digits,vote,pickRows,assignSizes};')(); let bad=0; const ok=(c,m)=>{if(!c){bad++;console.log('FAIL',m);}};
const prof=[]; for(let i=0;i<220;i++) prof.push(51); for(const [a,z] of [[10,35],[40,65],[70,95],[100,118]]) for(let i=a;i<z;i++) prof[i]=63;
const b=f.findBands(prof,6); ok(b.length===4&&b[0][0]===10&&b[3][1]===118,'bands '+JSON.stringify(b));
ok(f.digits('54 995')===54995,'54 995'); ok(f.digits(' ')===null,'blank'); ok(f.digits('7771\n')===7771,'7771');
ok(f.vote([890,890,3890])===890,'vote'); ok(f.vote([1,2,3])===null,'no majority'); ok(f.vote([null,7771,7771])===7771,'vote null');
// item picture band + 3 lot rows (Aile de Gruche): the picture band is dropped
let pr=f.pickRows([[20,90],[200,232],[240,272],[280,312]],540); ok(pr.length===3&&pr[0][0]===200,'pickRows header '+JSON.stringify(pr));
let as=f.assignSizes([null,null,null]); ok(JSON.stringify(as.sizes)==='[1,10,100]'&&!as.equip,'3 lots unread '+JSON.stringify(as));
as=f.assignSizes([1,1,100]); ok(JSON.stringify(as.sizes)==='[1,10,100]','qty 10 read as 1 '+JSON.stringify(as));
as=f.assignSizes([1,10,null,1000]); ok(JSON.stringify(as.sizes)==='[1,10,100,1000]','4 lots '+JSON.stringify(as));
as=f.assignSizes([1,null,1000]); ok(as.sizes[2]===1000&&as.sizes[1]===10,'1,10,1000 '+JSON.stringify(as));
as=f.assignSizes([1,1,1,1,1,null,10,10,null]); ok(as.equip&&JSON.stringify(as.sizes)==='[1,1,1,1,1,1,10,10,10]','equipment '+JSON.stringify(as));
const lr = fs.readFileSync(__dirname + '/../src/lotrows.js', 'utf8'); const body = lr.slice(lr.indexOf('export async function readLotRows'));
if ((body.match(/getImageData/g) || []).length !== 1 || /for \(let y[^)]*\)[^{]*\{[^}]*getImageData/.test(body)) { bad++; console.log('FAIL readLotRows must read the strip with ONE getImageData (a read per row made popups take 40 s)'); }
if (!/willReadFrequently/.test(fs.readFileSync(__dirname + '/../src/scan.js', 'utf8'))) { bad++; console.log('FAIL scan canvases must use willReadFrequently'); }
console.log(bad?bad+' lotrows failures':'lotrows: ok'); process.exit(bad?1:0);
