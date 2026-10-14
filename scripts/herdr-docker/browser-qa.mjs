// Run with ego-browser nodejs < scripts/herdr-docker/browser-qa.mjs after starting Vite on 5180.
const task=await taskSpace('Pairfob onboarding regression'); const page=task.page('p1');
await page.goto('http://127.0.0.1:5180/qa/index.html?scene=home-empty&lang=zh');
await page.evaluate(async()=>{for(let i=0;i<300&&!window.qa;i++)await new Promise(r=>setTimeout(r,100));if(!window.qa)throw Error("QA unavailable");await window.qa.ready});
const assert=(x,m)=>{if(!x)throw Error(m)};
for(const [width,height,touch] of [[390,844,true],[820,768,true],[1024,768,true],[1440,900,false]]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});
 await page.cdp('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:touch?5:1});
 await page.evaluate(()=>window.qa.setScene('home-empty'));
 async function pressText(text){
  const selector=await page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!b)throw Error('missing '+text); b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}},text);
  if(touch){await page.cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...selector,id:1}]});await page.cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else await page.mouse.click(selector.x,selector.y);
 }
 await pressText('新建会话');
 let state=await page.evaluate(()=>({text:document.querySelector('dialog').textContent,focus:document.activeElement.tagName}));
 assert(state.text.includes('运行 pwd'),'path help absent');assert(state.text.includes('安装并登录'),'agent prerequisite absent');
 if(touch)assert(state.focus!=='INPUT','touch raised keyboard without request');
 await pressText('输入其他路径');
 await page.fill('input[placeholder="/home/me/projects/my-app"]','/home/me/project with spaces');
 await pressText('终端');
 await page.evaluate(()=>{window.qa.clearCalls();window.qa.hold('createConversation');window.qa.failNext('createConversation','invalid_argument')});
 await pressText('新建并打开');
 await pressText('新建并打开');
 state=await page.evaluate(()=>({disabled:[...document.querySelectorAll('dialog button')].find(b=>b.textContent.includes('新建并打开')||b.textContent.includes('正在')).disabled,calls:window.qa.calls.filter(c=>c.method==='createConversation')}));
 assert(state.disabled,'submit not disabled');assert(state.calls.length===1,'submission count '+state.calls.length);
 await page.evaluate(()=>window.qa.release('createConversation'));
 await page.snapshot();
 state=await page.evaluate(()=>({value:document.querySelector('input[placeholder="/home/me/projects/my-app"]')?.value,text:document.querySelector('dialog')?.textContent,snap:window.qa.snapshot()}));
 assert(state.value==='/home/me/project with spaces','failure lost input');assert(state.text.includes('请检查这台电脑上的项目目录是否存在'),'actionable directory error absent');assert(!state.snap.overflow.documentX&&!state.snap.overflow.appX,'horizontal overflow');assert(!state.snap.errors.length,'runtime errors');
 if(touch) await pressText('新建并打开');
 else { await page.click('input[placeholder="/home/me/projects/my-app"]'); await page.keyboard.press('Enter'); }
 await page.snapshot();
 state=await page.evaluate(()=>({dialog:!!document.querySelector('dialog[open]'),calls:window.qa.calls.filter(c=>c.method==='createConversation'),snap:window.qa.snapshot()}));
 assert(!state.dialog,'success did not close form');assert(state.calls.length===2,'unexpected retry');assert(!state.snap.errors.length,'runtime errors');
 await page.evaluate(()=>window.qa.setScene('settings'));
 const computer=await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('这台设备')).textContent.trim());
 await pressText(computer);
 const help=await page.evaluate(()=>{const a=document.querySelector('a[href$="install#herdr-runtime"]');return {href:a?.getAttribute('href'),height:a?.getBoundingClientRect().height,overflow:window.qa.snapshot().overflow}});
 assert(help.href==='https://pairfob.com/doc/zh/install#herdr-runtime','Herdr update help missing when Pairfob is current');
 assert(help.height>=44,'update help touch target too small');assert(!help.overflow.documentX&&!help.overflow.appX,'settings overflow');
 console.log(JSON.stringify({width,height,touch,passed:true,calls:state.calls.length,herdrHelp:true}));
}

await task.finish({keep:[]});
