import assert from 'node:assert/strict';

export const scatterHoles=[[0x0800,0x0f00],[0x7a00,0x7ff8],[0x8400,0x87f8],[0x8800,0x9000],[0xfa00,0xfff8],[0x06b0,0x07f8],[0x0f20,0x1000]];
export function scatterReceiver(emitter,program){
  const base=emitter.start,length=program.bytes.length;
  const irqStart=emitter.labels.get('nuflix_irq_dispatch')-base,irqEnd=emitter.labels.get('nuflix_irq_dispatch_end')-base;
  assert.ok(irqEnd-irqStart+3<=32);
  const branches=emitter.relativeFixups.map(fixup=>[Math.min(fixup.next-2,emitter.labels.get(fixup.target))-base,Math.max(fixup.next,emitter.labels.get(fixup.target)+1)-base]);
  const operand=emitter.labels.get('color_destination_page')-base;
  const cuts=[...new Set([...emitter.labels.values()].map(address=>address-base).concat(length))].filter(offset=>offset>0&&offset!==operand&&!branches.some(([start,end])=>offset>start&&offset<end)).sort((left,right)=>right-left);
  const failed=new Set();
  const pinned=['crc_table_high','crc_table_low'].map(name=>emitter.labels.get(name)-base);
  function place(used,offset){
    if(offset===length)return [];
    const key=used+':'+offset;if(failed.has(key))return null;
    if(offset===irqStart){const rest=place(used,irqEnd);if(rest)return [{offset,end:irqEnd,address:0x0f00},...rest];failed.add(key);return null;}
    for(let hole=0;hole<scatterHoles.length;hole++){
      if(used&(1<<hole)||(!used&&hole))continue;
      const [low,high]=scatterHoles[hole];
      for(const end of cuts){
        const start=low+(pinned.some(address=>address>=offset&&address<end)?((base+offset-low)&255):0);
        if(end<=offset||(offset<irqStart&&end>irqStart)||start+end-offset+(end<length?3:0)>high)continue;
        const rest=place(used|(1<<hole),end);
        if(rest)return [{offset,end,address:start},...rest];
      }
    }
    failed.add(key);return null;
  }
  const layout=place(0,0);
  assert.ok(layout,`Receiver ${length} bytes does not fit safe scatter boundaries: ${JSON.stringify(cuts.slice(0,-1).map((end,index)=>({start:cuts[index+1],end,bytes:end-cuts[index+1]})).sort((left,right)=>right.bytes-left.bytes).slice(0,5))}`);
  const mapped=address=>{
    const offset=address-base;
    const chunk=layout.find(chunk=>offset>=chunk.offset&&offset<chunk.end);
    assert.ok(chunk,`Unmapped receiver address ${address.toString(16)}`);
    return chunk.address+offset-chunk.offset;
  };
  const bytes=Buffer.from(program.bytes);
  for(const fixup of emitter.absoluteFixups)bytes.writeUInt16LE(mapped(emitter.labels.get(fixup.target)),fixup.offset);
  for(const fixup of emitter.byteFixups)bytes[fixup.offset]=(mapped(emitter.labels.get(fixup.target))>>>fixup.shift)&255;
  for(const fixup of emitter.relativeFixups){
    const next=mapped(fixup.next-1)+1,target=mapped(emitter.labels.get(fixup.target));
    assert.ok(target-next>=-128&&target-next<=127);
    bytes[fixup.offset]=(target-next)&255;
  }
  const chunks=layout.map((chunk,index)=>{
    const payload=Buffer.from(bytes.subarray(chunk.offset,chunk.end));
    const next=layout[index+1];
    return {address:chunk.address,sourceOffset:chunk.offset,bytes:next?Buffer.concat([payload,Buffer.from([0x4c,next.address&255,next.address>>8])]):payload};
  });
  return {...program,bytes:Buffer.concat(chunks.map(chunk=>chunk.bytes)),chunks,labels:Object.fromEntries(Object.entries(program.labels).map(([name,address])=>[name,mapped(address)])),accesses:program.accesses.map(access=>({...access,instructionAddress:mapped(access.instructionAddress)}))};
}
