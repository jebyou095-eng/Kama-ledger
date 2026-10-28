// findBands and digits from src/lotrows.js (ES module text evaluated here)
const fs=require('fs'); let s=fs.readFileSync(__dirname+'/../src/lotrows.js','utf8');
s=s.replace(/^import .*$/m,'').replace(/export async function readLotRows[\s\S]*$/,'').replace(/export /g,'');
const f=new Function(s+';return {findBands,digits};')(); let bad=0; const ok=(c,m)=>{if(!c){bad++;console.log('FAIL',m);}};
const prof=[]; for(let i=0;i<220;i++) prof.push(51); for(const [a,z] of [[10,35],[40,65],[70,95],[100,118]]) for(let i=a;i<z;i++) prof[i]=63;
const b=f.findBands(prof,6); ok(b.length===4&&b[0][0]===10&&b[3][1]===118,'bands '+JSON.stringify(b));
ok(f.digits('54 995')===54995,'54 995'); ok(f.digits(' ')===null,'blank'); ok(f.digits('7771\n')===7771,'7771');
console.log(bad?bad+' lotrows failures':'lotrows: ok'); process.exit(bad?1:0);
