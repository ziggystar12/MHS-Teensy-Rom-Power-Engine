'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {desktopMachine} = require('./desktop-machine');

test('assembled row viewport, proportional dragging and filename identity', async t => desktopMachine(t, async ({s, fresh, stub, textAt}) => {
  const word = (cpu, name, value) => {
    const lo = s[name + 'Lo'], hi = s[name + 'Hi'];
    if (value !== undefined) { cpu.m[lo] = value & 255; cpu.m[hi] = value >> 8; }
    return cpu.m[lo] | cpu.m[hi] << 8;
  };
  function backend(cpu, count, top = 0, selected = 0, iec = false) {
    const io = s.IO1Port;
    cpu.m[s.GeosSurfaceMode] = iec ? s.GeosSurfaceIEC : s.GeosSurfaceBrowser;
    cpu.m[s.GeosOverlayMode] = 0;
    cpu.m[io + s.rRegViewCountLo] = count & 255;
    cpu.m[io + s.rRegViewCountHi] = count >> 8;
    cpu.m[io + s.rwRegViewTopLo] = top & 255;
    cpu.m[io + s.rwRegViewTopHi] = top >> 8;
    cpu.m[io + s.rwRegCursorItemOnPg] = selected;
    cpu.m[io + s.rRegNumItemsOnPage] = Math.min(20, Math.max(0, count-top));
    word(cpu, 'GeosIECTotal', count); word(cpu, 'GeosIECTop', top);
    cpu.m[s.GeosIECCount] = Math.min(20, Math.max(0, count-top));
    cpu.m[s.GeosIECSelection] = selected;
    let redraws = 0, fetches = 0, selectedRaw = top + selected;
    stub(cpu, 'GeosShellRedraw', () => { redraws++; });
    stub(cpu, 'GeosBitmapRefreshBrowserSelection');
    stub(cpu, 'GeosIECReadViewport', () => {
      fetches++;
      cpu.m[s.GeosIECCount] = Math.min(20, count-word(cpu,'GeosIECTop'));
      cpu.m[s.GeosIECSelection] = Math.min(cpu.m[s.GeosIECSelection], Math.max(0,cpu.m[s.GeosIECCount]-1));
    });
    cpu.onWrite = (address, value) => {
      if (address === io + s.rwRegViewTopHi) {
        const start = value*256 + cpu.m[io+s.rwRegViewTopLo];
        const remaining = Math.min(20,count-start);
        cpu.m[io+s.rRegNumItemsOnPage] = remaining;
        cpu.m[io+s.rwRegCursorItemOnPg] = Math.min(cpu.m[io+s.rwRegCursorItemOnPg],Math.max(0,remaining-1));
        selectedRaw = start + cpu.m[io+s.rwRegCursorItemOnPg];
      }
    };
    return {top: () => iec ? word(cpu,'GeosIECTop') : cpu.m[io+s.rwRegViewTopLo] + 256*cpu.m[io+s.rwRegViewTopHi],
      selection: () => cpu.m[iec ? s.GeosIECSelection : io+s.rwRegCursorItemOnPg],
      redraws: () => redraws, fetches: () => fetches, selectedRaw: () => selectedRaw};
  }
  await t.test('thumb geometry covers empty, short, partial and maximum directories', () => {
    for (const count of [0,1,4,15,16,17,20,255,256,3999,4000]) {
      const rows = Math.ceil(count/4), max = Math.max(0,rows-5);
      for (const row of new Set([0,Math.floor(max/2),max])) {
        const cpu = fresh(); backend(cpu,count,row*4); cpu.call(s.GeosBrowserReadState);
        const height = max ? Math.max(11,Math.floor(140*5/rows)) : 140;
        assert.equal(cpu.m[s.BrowserThumbH],height, `count${count}/row${row}`);
        assert.equal(cpu.m[s.BrowserThumbY],48+(max ? Math.floor(row*(140-height)/max) : 0));
        assert.equal(word(cpu,'BrowserMaxRow'),max);
      }
    }
    for (const [value,factor,divisor] of [[32767,140,140],[17,140,32767],[32750,139,140],[3996,140,4000]]) {
      const cpu=fresh(); word(cpu,'BrowserValue',value); word(cpu,'BrowserDivisor',divisor);
      cpu.a=factor; cpu.call(s.BrowserScale);
      assert.equal(word(cpu,'BrowserQuotient'),Math.floor(value*factor/divisor));
    }
  });
  await t.test('arrows scroll one row, track jumps five rows, edges clamp, and click identity follows the highlighted file', () => {
    for (const iec of [false,true]) {
      const cpu=fresh(), bus=backend(cpu,101,0,3,iec);
      cpu.m[s.MouseOpenArmed]=1;
      cpu.call(s.GeosBrowserScrollDown);
      assert.equal(bus.top(),4); assert.equal(bus.selection(),3);
      assert.equal(cpu.m[s.MouseOpenArmed],0);
      if (!iec) assert.equal(bus.selectedRaw(),7,'name/launch/delete all map to visibly highlighted raw7');
      cpu.call(s.GeosBrowserPageDown); assert.equal(bus.top(),24);
      cpu.call(s.GeosBrowserPageUp); assert.equal(bus.top(),4);
      cpu.call(s.GeosBrowserScrollUp); assert.equal(bus.top(),0);
      const before=bus.redraws();cpu.call(s.GeosBrowserScrollUp);assert.equal(bus.redraws(),before);
      for(let i=0;i<30;i++)cpu.call(s.GeosBrowserPageDown);
      assert.equal(bus.top(),84); assert.equal(bus.selection(),3);
    }
  });
  await t.test('dragging changes only the preview until release and reaches exact first/last row', () => {
    for(const iec of [false,true]) {
      const cpu=fresh(),bus=backend(cpu,4000,0,0,iec);
      cpu.call(s.GeosBrowserReadState);cpu.m[s.MouseFrameY]=50;cpu.call(s.GeosBrowserDragStart);
      for(let y=55;y<=180;y+=5){cpu.m[s.MouseFrameY]=y;cpu.call(s.GeosBrowserDragMove);assert.equal(bus.top(),0);assert.equal(bus.fetches(),0);}
      assert.equal(word(cpu,'BrowserRequestedRow'),995);
      cpu.call(s.GeosBrowserDragEnd);assert.equal(bus.top(),3980);assert.equal(bus.redraws(),1);assert.equal(bus.fetches(),+iec);
      cpu.call(s.GeosBrowserReadState);cpu.m[s.MouseFrameY]=cpu.m[s.BrowserThumbY]+2;cpu.call(s.GeosBrowserDragStart);
      cpu.m[s.MouseFrameY]=0;cpu.call(s.GeosBrowserDragMove);cpu.call(s.GeosBrowserDragEnd);assert.equal(bus.top(),0);
    }
  });
  await t.test('keyboard navigation reaches offscreen rows in both sources without wrap or invalid selection', () => {
    for(const iec of [false,true]) {
      const cpu=fresh(),bus=backend(cpu,37,0,12,iec);
      cpu.call(s.GeosBrowserCursorDown);assert.equal(bus.top(),0);assert.equal(bus.selection(),16);
      cpu.call(s.GeosBrowserCursorUp);assert.equal(bus.top(),0);assert.equal(bus.selection(),12);
      for(let i=0;i<12;i++)cpu.call(s.GeosBrowserCursorDown);
      assert.equal(bus.top()+bus.selection(),36);
      for(let i=0;i<12;i++)cpu.call(s.GeosBrowserCursorUp);
      assert.equal(bus.top()+bus.selection(),0);
      cpu.call(s.GeosBrowserCursorLeft);assert.equal(bus.top()+bus.selection(),0);
    }
  });
  await t.test('capture keeps exact ASCII case and punctuation and bounds the last twenty-slot record', () => {
    for(const name of ['Text.txt','Teensy_MPE-V1.0.4.hex','ABC.def.GHI']) {
      const cpu=fresh();let offset=0;const bytes=Buffer.from(name+'\0');
      cpu.hooks.set(s.GeosRichReadFileLabel, current => { current.m[s.IO1Port+s.rwRegSerialString] = bytes[offset++]; });
      cpu.a=19;cpu.call(s.GeosRichLabelStart);cpu.call(s.GeosRichPrintFileLabel);
      assert.equal(textAt(cpu,s.GeosRichFileLabels+19*23),name);assert.equal(offset,bytes.length);
      assert.equal(cpu.m[s.GeosRichFileLabels+20*23],fresh().m[s.GeosRichFileLabels+20*23]);
    }
  });
  await t.test('all twenty icon and two-line label targets fit five visible rows and reject gaps/empty slots', () => {
    for (const iec of [false,true]) {
      const cpu=fresh();backend(cpu,20,0,0,iec);
      for(let i=0;i<20;i++) Buffer.from('AbcDef12345Second.txt\0').copy(cpu.m,s.GeosRichFileLabels+i*23);
      const hit=(x,y)=>{cpu.m[s.MouseFrameX]=x/2;cpu.m[s.MouseFrameY]=y;cpu.call(s.GeosRichHitFile);return cpu.p&1 ? cpu.a : -1;};
      for(let i=0;i<20;i++) {
        const x=8+(i%4)*72,y=36+Math.floor(i/4)*32;
        for(const point of [[x+24,y],[x+46,y+15],[x+4,y+17],[x+64,y+23],[x+4,y+25],[x+28,y+31]])
          assert.equal(hit(...point),i,`${iec}/${i}/${point}`);
        assert.equal(hit(x,y+16),-1,'cell gap is not a file target');
      }
      for(const point of [[304,80],[24,35],[24,196],[24,199],[2,100],[298,100]])assert.equal(hit(...point),-1,`${point}`);
      cpu.m[iec?s.GeosIECCount:s.IO1Port+s.rRegNumItemsOnPage]=17;
      assert.equal(hit(248,164),-1,'empty last-row slot is rejected');
    }
  });
  await t.test('shared close/parent bounds dispatch in both sources without activating a filename', () => {
    for(const iec of [false,true]) for(const [x,y,expected] of [[302,14,'close'],[312,24,'close'],[314,24,'none'],[302,25,'none'],[10,29,'parent'],[34,29,'none'],[10,36,'none']]) {
      const cpu=fresh();backend(cpu,0,0,0,iec);let action='none';
      stub(cpu,'GeosFileDesktop',()=>{action='close';});stub(cpu,'GeosFileParent',()=>{action='parent';});
      cpu.m[s.MouseFrameX]=x/2;cpu.m[s.MouseFrameY]=y;cpu.x=Math.floor(x/8);cpu.y=Math.floor(y/8);
      cpu.call(s.GeosShellMouseClick);assert.equal(action,expected,`${iec}/${x},${y}`);
    }
  });
}, {apps:false}));
