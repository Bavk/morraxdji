'use strict';
const net = require('node:net');
const dgram = require('node:dgram');

const MEDIA_PORTS = Object.freeze([
  {port: 3100, protocol: 'tcp', purpose:'API подключения операторов'},
  {port: 7880, protocol: 'tcp', purpose:'LiveKit / сигнализация'},
  {port: 7881, protocol: 'tcp', purpose:'LiveKit / TCP-транспорт'},
  {port: 7882, protocol: 'udp', purpose:'LiveKit / видеопотоки'}
]);

function checkPort({port,protocol,purpose}, host='0.0.0.0') {
  return new Promise(resolve=> {
    const isTcp=protocol==='tcp';
    const socket=isTcp?net.createServer():dgram.createSocket('udp4');
    let finished=false;
    function finish(ok,reason=''){
      if(finished)return;
      finished=true;
      try {socket.close();} catch {}
      resolve({port,protocol,purpose,available:ok,reason});
    }
    socket.once('error', e=>finish(false,e.code || e.message));
    if(isTcp) {
      socket.listen({host,port,exclusive:true},()=>finish(true));
    } else {
      socket.bind({address:host,port,exclusive:true},()=>finish(true));
    }
  });
}
async function checkMediaPorts(ports=MEDIA_PORTS) {
  return Promise.all(ports.map(p=>checkPort(p)));
}
async function assertMediaPortsAvailable() {
  const checks=await checkMediaPorts();
  const busy=checks.filter(c=>!c.available);
  if(busy.length)throw Error('Невозможно запустить сервер: заняты сетевые порты: '+
    busy.map(c=>`${c.port}/${c.protocol} (${c.purpose}; ${c.reason})`).join(', ')+
    '. Закройте предыдущий сервер/приложение, использующее эти порты, и повторите попытку.');
  return checks;
}
module.exports={MEDIA_PORTS,checkPort,checkMediaPorts,assertMediaPortsAvailable};
