// Enumerate zone offsets around a wall time; Intl is the authoritative IANA database.
// No Date(localString) parsing, which would silently normalize DST gaps.
export function resolveWallTime(date,time,timeZone) {
  const wall=Date.parse(`${date}T${time}:00.000Z`);
  const format=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const parts=ms=>Object.fromEntries(format.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  const offsets=new Set();
  for(let h=-48;h<=48;h+=3) {
    const ms=wall+h*3600000,p=parts(ms);
    const local=Date.parse(`${p.year.padStart(4,'0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`);
    offsets.add(local-ms);
  }
  return [...offsets].map(offset=>({at:wall-offset,offset})).filter(({at})=>{
    const p=parts(at);return `${p.year.padStart(4,'0')}-${p.month}-${p.day}`===date&&`${p.hour}:${p.minute}`===time;
  }).sort((a,b)=>a.at-b.at).map(({at,offset})=>{
    const minutes=Math.abs(offset)/60000;
    const label=`UTC${offset<0?'-':'+'}${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(Math.floor(minutes%60)).padStart(2,'0')}`;
    return {at:new Date(at).toISOString(),label};
  });
}
