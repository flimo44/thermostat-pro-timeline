const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const registry=new Map();
const context=vm.createContext({HTMLElement:class {},customElements:{get:n=>registry.get(n),define:(n,c)=>registry.set(n,c)},
  window:{},navigator:{language:'en'},console,localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../thermostat-pro-timeline.js'),'utf8').replaceAll('import.meta.url',JSON.stringify('https://example.test/card.js')),context);
const Card=registry.get('thermostat-timeline-card');
function card(){
  const c=Object.create(Card.prototype);
  c._config={};c._schedules={};c._hasConfig=false;c._initialized=false;
  c.setConfig({entities:['climate.room']});
  c._hasConfig=true;
  return c;
}
test('repeated HA setConfig preserves settings edited in the card',()=>{
  const c=card();
  c._config.labels={'climate.room':'Living room'};
  c._config.temp_sensors={'climate.room':'sensor.temperature'};
  c._config.boiler_rooms=['climate.room'];
  c._config.boiler_enabled=true;c._config.boiler_min_temp=18;
  c.setConfig({entities:['climate.room']});
  assert.equal(c._config.labels['climate.room'],'Living room');
  assert.equal(c._config.temp_sensors['climate.room'],'sensor.temperature');
  assert.equal(c._config.boiler_enabled,true);
  assert.equal(c._config.boiler_min_temp,18);
});
test('explicit YAML settings still override saved settings including empty maps',()=>{
  const c=card();c._config.labels={'climate.room':'Living room'};
  c.setConfig({entities:['climate.room'],labels:{},boiler_enabled:false});
  assert.equal(Object.keys(c._config.labels).length,0);
  assert.equal(c._config.boiler_enabled,false);
});
test('sensor pause suppresses frontend scheduled writes and resumes when off',async()=>{
  const c=card();c._config.storage_enabled=false;c._config.auto_apply=true;
  c._config.pause_sensor_enabled=true;c._config.pause_sensor_entity='binary_sensor.summer';
  c._hass={states:{'binary_sensor.summer':{state:'on'}}};
  let writes=0;c._allTargetEntities=()=>['climate.room'];c._desiredFor=()=>20;
  c._getNowMin=()=>600;c._lastApplied={};c._applySetpointForEntity=async()=>writes++;
  await c._applyCurrentSetpoints(true);
  assert.equal(writes,0);assert.equal(c._isPaused(),true);
  c._hass.states['binary_sensor.summer'].state='off';
  assert.equal(c._isPaused(),false);
});

for (const enabled of [false,true]) {
  for (const order of ['before','after']) {
    test(`frontend turn_on enabled=${enabled}, order=${order}`,async()=>{
      const c=card(),calls=[];
      c._config.turn_on={'climate.primary':{enabled,order}};
      c._groupPrimaryOf=()=> 'climate.primary';
      c._serviceTempFromC=x=>x;
      c._hass={states:{'climate.room':{state:'off',attributes:{hvac_modes:['off','heat']}}},
        callService:async(domain,service)=>calls.push(service)};
      await c._applySetpointForEntity('climate.room',20);
      assert.deepEqual(calls,enabled?(order==='before'?['set_hvac_mode','set_temperature']:['set_temperature','set_hvac_mode']):['set_temperature']);
    });
  }
}

