// Short, bright confirmation with a restrained transient and no bass tail.
export function feedbackSamples(sampleRate,hit=true){
  const duration=hit?.048:.028,data=new Float32Array(Math.ceil(sampleRate*duration));
  let noise=9173;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,attack=Math.min(1,t/.0007),tail=Math.min(1,(duration-t)/.004);
    noise=(Math.imul(noise,1664525)+1013904223)|0;
    const transient=(noise/2147483648)*Math.exp(-t/.0014);
    const tone=hit?Math.sin(2*Math.PI*2200*t)*.072*Math.exp(-t/.010)+Math.sin(2*Math.PI*3520*t)*.028*Math.exp(-t/.006):Math.sin(2*Math.PI*940*t)*.028*Math.exp(-t/.005);
    data[i]=(tone+transient*(hit?.025:.012))*attack*tail;
  }
  return data;
}
const buffers=new WeakMap();
export function playFeedback(context,hit){
  if(context.state!=='running')return;
  let pair=buffers.get(context);
  if(!pair){pair=[false,true].map(value=>{const samples=feedbackSamples(context.sampleRate,value),buffer=context.createBuffer(1,samples.length,context.sampleRate);buffer.copyToChannel(samples,0);return buffer;});buffers.set(context,pair);}
  const source=context.createBufferSource();source.buffer=pair[Number(hit)];source.connect(context.destination);source.onended=()=>source.disconnect();source.start();
}
