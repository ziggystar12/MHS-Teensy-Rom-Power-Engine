'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { desktopMachine } = require('./desktop-machine');

test('opening the highlighted HEX uses manual confirmation through the real browser launch and WAIT path', t => desktopMachine(t,
    async ({ s, fresh, stub }) => {
        const version=fs.readFileSync(path.resolve(__dirname,'../../../Teensy/DesktopFirmwareVersion.h'),'utf8')
            .match(/^#define MPE_FIRMWARE_VERSION "([^"]+)"/m)?.[1];
        assert.ok(version);
        const candidate=`MPE_Firmware-V${version}.hex`;
        for(const source of [s.rmtSD,s.rmtUSBDrive]) for(const outcome of ['confirm','cancel','changed'])
            await t.test(`${source===s.rmtSD?'SD':'USB'} selected installed-version HEX: ${outcome}`,()=> {
                const cpu=fresh(),commands=[],selections=[],glyphs=[];
                let waiting=false,statusReads=0,targetState=0,serial=0,answered=false,runSelected=0;
                cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceBrowser;
                cpu.m[s.GeosOverlayMode]=s.GeosOverlayNone;
                cpu.m[s.IO1Port+s.rWRegCurrMenuWAIT]=source;
                cpu.m[s.IO1Port+s.rwRegCursorItemOnPg]=3;
                cpu.m[s.IO1Port+s.rwRegSelItemOnPage]=0;
                cpu.m[s.IO1Port+s.rRegItemTypePlusIOH]=s.rtFilePrg;
                const step=cpu.step.bind(cpu);
                cpu.step=()=> {
                    const opcode=cpu.m[cpu.pc],address=cpu.m[cpu.pc+1]|cpu.m[cpu.pc+2]<<8;
                    if([0xad,0xcd].includes(opcode)&&address===s.IO1Port+s.rwRegStatus&&waiting&&++statusReads>=32) {
                        waiting=false;
                        cpu.m[address]=s.rsReady;
                        cpu.m[s.IO1Port+s.rRegFirmwareTargetState]=targetState;
                    }
                    if(opcode===0xad&&address===s.IO1Port+s.rwRegSerialString)
                        cpu.m[address]=candidate.charCodeAt(serial++)||0;
                    step();
                };
                cpu.onWrite=(address,value)=> {
                    assert.notEqual(address,s.IO1Port+s.rWRegCurrMenuWAIT,'manual open must retain the chosen filesystem');
                    if(address===s.IO1Port+s.rwRegSelItemOnPage) {
                        selections.push(value);
                        cpu.m[s.IO1Port+s.rRegItemTypePlusIOH]=value===3?s.rtFileHex:s.rtFilePrg;
                    }
                    if(address===s.IO1Port+s.rwRegSerialString) {
                        assert.equal(value,s.rsstFirmwareName);serial=0;
                    }
                    if(address!==s.IO1Port+s.wRegControl)return;
                    commands.push(value);
                    assert.notEqual(value,s.rCtlFirmwareDiscoverWAIT,'selected same-version firmware is never subject to newer-only discovery');
                    if(value===s.rCtlFirmwareCancel)return;
                    assert.ok([s.rCtlFirmwarePrepareWAIT,s.rCtlFirmwareCheckWAIT,s.rCtlStartSelItemWAIT].includes(value));
                    targetState=value===s.rCtlFirmwareCheckWAIT&&outcome==='changed'?2:1;
                    waiting=true;statusReads=0;cpu.m[s.IO1Port+s.rwRegStatus]=0x22;
                };
                cpu.hooks.set(s.RunSelected,()=>++runSelected);
                cpu.hooks.set(s.GeosDialogGlyph,c=>{if(c.m[s.RichY]<120)glyphs.push(c.a);});
                // Rendering the selected browser row and hardware IRQ teardown
                // are covered independently; execute the actual launch command.
                stub(cpu,'InverseRow');stub(cpu,'IRQDisable');stub(cpu,'AnyKeyErrMsgWait');stub(cpu,'ListAndDone');
                stub(cpu,'GetIn',c=> {
                    let key=0;
                    if(c.m[s.GeosDialogMode]===1&&!answered) {
                        assert.ok(Buffer.from(glyphs).toString('ascii').includes(candidate),'exact selected filename is displayed before confirmation');
                        answered=true;key=outcome==='cancel'?s.ChrReturn:0x59;
                    } else if(c.m[s.GeosDialogMode]===0&&outcome==='changed')key=s.ChrReturn;
                    c.a=c.nz(key);
                });
                cpu.call(s.SelectItem);
                assert.equal(runSelected,1);
                assert.deepEqual(selections,[3]);
                assert.deepEqual(commands,[s.rCtlFirmwarePrepareWAIT,
                    ...(outcome==='cancel'?[]:[s.rCtlFirmwareCheckWAIT]),
                    ...(outcome==='confirm'?[s.rCtlStartSelItemWAIT]:[]),s.rCtlFirmwareCancel]);
                assert.equal(cpu.m[s.UiWaitCancelable],0);
                if(outcome==='changed')assert.ok(Buffer.from(glyphs).toString('ascii').includes('Firmware selection changed. Choose the file again.'));
            });
    }));

test('firmware confirmation executes the real bitmap WAIT and resident polling lifecycle', t => desktopMachine(t,
    async ({ s, fresh, stub }) => {
        for (const entry of ['GeosFirmwareStartup', 'GeosFirmwareConfirm']) await t.test(entry, () => {
            const cpu = fresh(), commands = [], calls = [];
            let waiting = false, statusReads = 0, serial = 0, answered = false;
            const candidate = 'MPE_Firmware-V1.0.21.hex';
            const step = cpu.step.bind(cpu);
            cpu.step = () => {
                const opcode = cpu.m[cpu.pc], address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
                if ([0xad, 0xcd].includes(opcode) && address === s.IO1Port + s.rwRegStatus && waiting) {
                    if (++statusReads >= 32) {
                        waiting = false;
                        cpu.m[s.IO1Port + s.rRegFirmwareTargetState] = 1;
                        cpu.m[address] = s.rsReady;
                    }
                }
                if (opcode === 0xad && address === s.IO1Port + s.rwRegSerialString)
                    cpu.m[address] = candidate.charCodeAt(serial++) || 0;
                step();
            };
            cpu.onWrite = (address, value) => {
                if (address === s.IO1Port + s.rwRegSerialString) { assert.equal(value, s.rsstFirmwareName); serial = 0; }
                if (address !== s.IO1Port + s.wRegControl) return;
                commands.push(value);
                if (value !== s.rCtlFirmwareCancel) {
                    waiting = true; statusReads = 0;
                    cpu.m[s.IO1Port + s.rwRegStatus] = 0x22; // rsFirmwareTarget
                }
            };
            stub(cpu, 'GetIn', c => {
                const answer = c.m[s.GeosDialogMode] === 1 && !answered;
                if (answer) answered = true;
                c.a = c.nz(answer ? 0x59 : 0);
            });
            for (const label of ['IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', 'ListAndDone'])
                stub(cpu, label, () => calls.push(label));
            cpu.call(s[entry]);
            assert.deepEqual(commands, [entry === 'GeosFirmwareStartup' ? s.rCtlFirmwareDiscoverWAIT : s.rCtlFirmwarePrepareWAIT,
                s.rCtlFirmwareCheckWAIT, s.rCtlFirmwareCancel]);
            assert.deepEqual(calls, ['IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', 'ListAndDone']);
            assert.equal(cpu.m[s.UiWaitCancelable], 0, 'both completed WAIT operations disarm resident cancellation');
        });
    }));

test('startup firmware discovery uses the shared guarded confirmation without changing the browser', t => desktopMachine(t, async ({ s, fresh, stub, menuDir }) => {
    const fixture = ({ ready = 1, changed = false, active = 1, answers = [13] } = {}) => {
        const cpu = fresh(), calls = [], glyphs = [], events = [...answers];
        const candidate = 'MPE_Firmware-V1.0.21.hex';
        let serial = 0;
        cpu.m[s.GeosBitmapActive] = active;
        cpu.m[s.GeosSurfaceMode] = s.GeosSurfaceHome;
        cpu.m[s.IO1Port + s.rWRegCurrMenuWAIT] = s.rmtTeensy;
        cpu.m[s.IO1Port + s.rwRegCursorItemOnPg] = 7;
        cpu.m[s.IO1Port + s.rwRegSelItemOnPage] = 4;
        cpu.onWrite = (address, value) => {
            if (address === s.IO1Port + s.wRegControl) calls.push(value);
            if (address === s.IO1Port + s.rwRegSerialString) {
                assert.equal(value, s.rsstFirmwareName); serial = 0;
            }
            assert.notEqual(address, s.IO1Port + s.rWRegCurrMenuWAIT, 'discovery does not navigate');
            assert.notEqual(address, s.IO1Port + s.rwRegSelItemOnPage, 'discovery does not select another browser item');
        };
        const step = cpu.step.bind(cpu);
        cpu.step = () => {
            const address = cpu.m[cpu.pc + 1] | cpu.m[cpu.pc + 2] << 8;
            if (cpu.m[cpu.pc] === 0xad && address === s.IO1Port + s.rwRegSerialString)
                cpu.m[address] = candidate.charCodeAt(serial++) || 0;
            step();
        };
        stub(cpu, 'WaitForTRWaitMsg', c => {
            c.m[s.IO1Port + s.rRegFirmwareTargetState] = changed && calls.at(-1) === s.rCtlFirmwareCheckWAIT ? 2 : ready;
        });
        stub(cpu, 'GetIn', c => {
            assert.ok(events.length, 'confirmation must not consume an unplanned key');
            c.a = c.nz(events.shift());
        });
        for (const label of ['IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', 'ListAndDone'])
            stub(cpu, label, () => calls.push(label));
        cpu.hooks.set(s.GeosDialogGlyph, c => { if (c.m[s.RichY] < 120) glyphs.push(c.a); });
        cpu.call(s.GeosFirmwareStartup);
        assert.equal(cpu.m[s.GeosSurfaceMode], s.GeosSurfaceHome);
        assert.equal(cpu.m[s.IO1Port + s.rWRegCurrMenuWAIT], s.rmtTeensy);
        assert.equal(cpu.m[s.IO1Port + s.rwRegCursorItemOnPg], 7);
        assert.equal(cpu.m[s.IO1Port + s.rwRegSelItemOnPage], 4);
        return { calls, glyphs: Buffer.from(glyphs).toString('ascii'), candidate };
    };
    await t.test('no candidate dismisses loading without prompting; recovery text mode is untouched', () => {
        for (const ready of [0, 2, 3])
            assert.deepEqual(fixture({ ready, answers: [] }).calls, [s.rCtlFirmwareDiscoverWAIT, s.rCtlFirmwareCancel, 'ListAndDone']);
        assert.deepEqual(fixture({ active: 0, answers: [] }).calls, []);
    });
    await t.test('Cancel is the default and never disables interrupts or starts an update', () => {
        for (const answer of [s.ChrReturn, s.ChrStop, 0x4e, 0xce]) {
            const result = fixture({ answers: [answer] });
            assert.deepEqual(result.calls, [s.rCtlFirmwareDiscoverWAIT, s.rCtlFirmwareCancel, 'ListAndDone']);
            assert.equal(result.glyphs, result.candidate, 'full exact candidate displayed');
        }
    });
    await t.test('only an affirmative after display can check and begin the captured update', () => {
        for (const answers of [[0x59], [s.ChrCRSRRight, s.ChrReturn]]) {
            const result = fixture({ answers });
            assert.equal(result.glyphs, result.candidate);
            assert.deepEqual(result.calls, [s.rCtlFirmwareDiscoverWAIT, s.rCtlFirmwareCheckWAIT,
                'IRQDisable', 'StartSelItem_WaitForTRDots', 'AnyKeyErrMsgWait', s.rCtlFirmwareCancel, 'ListAndDone']);
        }
    });
    await t.test('a changed candidate after confirmation cannot reach the flasher', () => {
        const result = fixture({ changed: true, answers: [0x59, s.ChrReturn] });
        assert.deepEqual(result.calls, [s.rCtlFirmwareDiscoverWAIT, s.rCtlFirmwareCheckWAIT, s.rCtlFirmwareCancel, 'ListAndDone']);
        assert.ok(result.glyphs.includes('Firmware selection changed. Choose the file again.'));
    });
    await t.test('discovery has one startup call after desktop drawing, outside the input loop', () => {
        const source = fs.readFileSync(path.join(menuDir, 'source/MainMenu.asm'), 'utf8');
        assert.equal((source.match(/jsr GeosFirmwareStartup/g) || []).length, 1);
        assert.match(source, /jsr ListMenuItems\s+!ifdef DesktopShell \{\s+jsr GeosFirmwareStartup[\s\S]*?lda rwRegDesktopAppID\+IO1Port[\s\S]*?jsr GeosShellOpenApp[\s\S]*?HighlightCurrent:/);
    });
}));

test('explicit SD opens retry discovery before one final redraw without affecting other sources or text mode', t => desktopMachine(t, async ({s,fresh,stub,menuDir})=> {
    const fixture=({entry='ListMenuItemsChangeInit',source=s.rmtSD,view=1,active=1,ready=0}={})=> {
        const cpu=fresh(),calls=[];
        cpu.m[s.GeosViewMode]=view;cpu.m[s.GeosBitmapActive]=active;
        cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceHome;
        cpu.m[s.GeosOverlayMode]=s.GeosOverlayControl;
        cpu.m[s.IO1Port+s.rwRegCursorItemOnPg]=3;
        cpu.m[s.IO1Port+s.rwRegSelItemOnPage]=3;
        let command=0;
        cpu.onWrite=(address,value)=> {
            if(address===s.IO1Port+s.rWRegCurrMenuWAIT) calls.push('source:'+value);
            if(address===s.IO1Port+s.wRegControl) {command=value;calls.push('command:'+value);}
            assert.notEqual(address,s.IO1Port+s.rwRegSelItemOnPage,'discovery does not retarget the visible selection');
        };
        stub(cpu,'WaitForTRWaitMsg',c=>{
            calls.push('wait');
            c.m[s.IO1Port+s.rRegFirmwareTargetState]=command===s.rCtlFirmwareDiscoverWAIT?ready:0;
        });
        stub(cpu,'ListMenuItems',()=>calls.push('draw'));
        stub(cpu,'GeosDialogOpen',()=>calls.push('prompt'));
        for(const label of ['GeosDialogBegin','GeosDialogSerial','GeosDialogStatus','GeosDialogLocal','GeosDialogPublish']) stub(cpu,label);
        stub(cpu,'GeosDialogWait',c=>{c.a=c.nz(1);calls.push('cancel');});
        stub(cpu,'IRQDisable',()=>assert.fail('retry cannot start an update without affirmative confirmation'));
        cpu.a=source;
        cpu.call(s[entry]);
        assert.equal(cpu.m[s.IO1Port+s.rwRegSelItemOnPage],3);
        return {calls,cpu};
    };
    await t.test('SD paths share the retry and final render; no candidate and Cancel render once',()=> {
        for(const entry of ['ListMenuItemsChangeInit','GeosHomeOpenSD','GeosDiskSD']) {
            for(const ready of [0,1]) {
                const {calls,cpu}=fixture({entry,ready});
                assert.deepEqual(calls,[`source:${s.rmtSD}`,'wait',`command:${s.rCtlFirmwareDiscoverWAIT}`,'wait',
                    ...(ready?['prompt','cancel']:[]),`command:${s.rCtlFirmwareCancel}`,'draw']);
                assert.equal(cpu.m[s.GeosSurfaceMode],s.GeosSurfaceBrowser);
                assert.equal(cpu.m[s.GeosOverlayMode],s.GeosOverlayNone);
            }
        }
    });
    await t.test('other sources, ordinary redraw and text mode do not discover',()=> {
        for(const source of [s.rmtTeensy,s.rmtUSBDrive])
            assert.deepEqual(fixture({source}).calls,[`source:${source}`,'wait','draw']);
        for(const mode of [{view:0,active:0},{view:0,active:1},{view:1,active:0}])
            assert.deepEqual(fixture(mode).calls,[`source:${s.rmtSD}`,'wait','draw']);
        assert.deepEqual(fixture({entry:'GeosShellRedraw'}).calls,['draw']);
    });
    await t.test('F3 and Control/browser source opening converge on the same explicit source entry',()=> {
        const main=fs.readFileSync(path.join(menuDir,'source/MainMenu.asm'),'utf8');
        const shell=fs.readFileSync(path.join(menuDir,'source/GeosShell.s'),'utf8');
        assert.match(main,/cmp #ChrF3[^\n]*\s+bne \+\s+lda #rmtSD\s+jsr ListMenuItemsChangeInit/);
        assert.match(shell,/GeosShellOpenSource = ListMenuItemsChangeInit/);
    });
}));
