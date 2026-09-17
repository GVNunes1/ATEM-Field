const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Run these fixtures against a local server only.');
const artifacts = path.join(__dirname, '..', 'test-results', 'modal-overlays');
fs.mkdirSync(artifacts, { recursive: true });
const today = new Date().toLocaleDateString('sv-SE');
const technicians=Array.from({length:46},(_,i)=>({id:i+1,name:i===0?'EQAT':`Técnico ${String(i+1).padStart(2,'0')}`,role:'Técnico de Campo',status:'Ativo',pin:'1234',phone:'11900001234'}));
const analyzers=[{id:301,name:'Analisador de teste',asset_tag:'QA-001',serial_number:'QA-SERIAL',type:'Analisador',status:'Disponível',calibration_expiry:'2027-06-01'}];
const appointments=[{id:201,title:'Manutenção',client_name:'Cliente de teste',appointment_date:today,appointment_time:'10:00',technician_id:1,technician_ids:[1],technician_names:'EQAT',status:'Agendado',equipments:[],reservations:[]}];
const reservations=[{id:401,analyzer_id:301,asset_tag:'QA-001',analyzer_name:'Analisador de teste',technician_id:1,technician_name:'EQAT',appointment_id:201,client_name:'Cliente de teste',status:'Reservado',reserved_date:today}];
const fixture={success:true,technicians,appointments,analyzers,reservations,credentials:[{id:1,username:'qa',display_name:'EQAT',role:'technician',pin:'1234'}],categories:[],recentReservations:[],stats:{},portal_url:'https://example.test/portal-tecnico#access=fixture'};
let writes=0; const errors=[]; let checks=0;

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
 try {
 for(const [width,height] of (process.env.QA_LANDSCAPE_ONLY ? [[812,375]] : process.env.QA_MOBILE_ONLY ? [[375,812],[768,1024],[1024,768],[812,375]] : [[1440,900],[375,812],[768,1024],[1024,768],[812,375]])) {
  const context=await browser.newContext({viewport:{width,height}});
  await context.route('**/api/**',route=>{
   if(route.request().method()!=='GET'){writes++;return route.fulfill({status:403,json:{success:false}});}
   return route.fulfill({json:fixture});
  });
  await context.addInitScript(()=>{localStorage.setItem('atem.auth.user',JSON.stringify({id:1,name:'Teste',role:'admin'}));localStorage.setItem('atem.auth.token','isolated-fixture');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const go=async route=>{await page.goto(`${baseUrl}${route}`);await page.waitForTimeout(400);};
  async function verify(label) {
   const layer=page.locator('.field-modal-layer').last(); await layer.waitFor();
   await page.waitForTimeout(150);
   const result=await layer.evaluate(el=>{
    const rect=el.getBoundingClientRect();const card=el.firstElementChild;const bounds=card.getBoundingClientRect();
    const hit=document.elementFromPoint(bounds.x+bounds.width/2,Math.max(bounds.top+20,20));
    return {rect:rect.toJSON(),card:bounds.toJSON(),bodyParent:el.parentElement===document.body,focused:el.contains(document.activeElement),rootInert:document.getElementById('root').inert,cardHit:el.contains(hit),overflow:card.scrollWidth-card.clientWidth};
   });
   assert.equal(result.bodyParent,true,label+' portal');assert.equal(result.rect.x,0,label+' left');assert.equal(result.rect.y,0,label+' top');
   assert.ok(Math.abs(result.rect.width-width)<2,label+' viewport width');assert.ok(Math.abs(result.rect.height-height)<2,label+' viewport height');
   assert.ok(result.card.top>=0 && result.card.bottom<=height+1,label+' visible vertically');
   assert.ok(result.card.left>=0 && result.card.right<=width+1,label+' visible horizontally');
   assert.ok(result.overflow<=2,label+' card horizontal overflow '+result.overflow);
   assert.ok(result.focused && result.rootInert && result.cardHit,label+' focus and foreground');
   await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
   assert.ok(await layer.evaluate(el=>el.contains(document.activeElement)),label+' focus trap');
   checks++;console.log('PASS',width+'x'+height,label);
   if(label==='Novo técnico') await page.screenshot({path:path.join(artifacts,`modal-fixed-${width}.png`)});
  }
  async function close() {const count=await page.locator('.field-modal-layer').count();await page.keyboard.press('Escape');await page.waitForTimeout(50);assert.equal(await page.locator('.field-modal-layer').count(),count-1);}
  await go('/tecnicos');
  const create=page.getByRole('button',{name:'Novo técnico',exact:true});
  await create.click();await verify('Novo técnico');await close();assert.ok(await create.evaluate(el=>el===document.activeElement));
  for(const item of ['Editar cadastro','Mesclar usuário','Apagar usuário']) {
   await page.getByRole('button',{name:'Ações de EQAT',exact:true}).click();
   await page.getByRole('menuitem',{name:new RegExp(item)}).click();await verify(item);await close();
  }
  await page.getByRole('button',{name:'Gerenciar PINs & Acessos',exact:true}).click();await verify('PINs');
  await page.getByRole('button',{name:'Novo Usuário / PIN',exact:true}).click();await verify('Novo PIN sobre gerenciador');
  assert.equal(await page.locator('.field-modal-layer').first().evaluate(el=>el.inert),true);
  await close();assert.equal(await page.locator('.field-modal-layer').first().evaluate(el=>el.inert),false);await close();
  await page.getByRole('button',{name:'Gerar link de acesso',exact:true}).click();await verify('Link do técnico');await close();
  // Scroll a long page before opening the same dialog.
  await page.evaluate(()=>{document.querySelector('.app-content-wrapper').scrollTop=1200;window.scrollTo(0,1200)});
  await page.getByRole('button',{name:/^Ações de /}).last().click();
  await page.getByRole('menuitem',{name:/Editar cadastro/}).click();await verify('Editar após rolagem');await close();
  await go('/templates');await page.getByRole('button',{name:'Novo template',exact:true}).click();await verify('Template');await close();
  await go('/padroes');await page.getByRole('button',{name:'Cadastrar Patrimônio',exact:true}).click();await verify('Novo padrão');await close();
  await page.getByTitle('Editar Padrão (Admin)',{exact:true}).click();await verify('Editar padrão');await close();
  await page.getByTitle('Sincronizar identificação e datas de calibração via Excel').click();
  const excel=page.getByRole('dialog');await excel.waitFor();
  await page.waitForTimeout(250);
  const excelRect=await excel.boundingBox();assert.equal(excelRect.x,0);assert.equal(excelRect.y,0);
  const excelCard=await excel.locator(':scope > div').first().boundingBox();
  assert.ok(excelCard.x>=0 && excelCard.y>=0 && excelCard.x+excelCard.width<=width+1 && excelCard.y+excelCard.height<=height+1,'Excel card bounds');
  await page.keyboard.press('Escape');await excel.waitFor({state:'hidden'});console.log('PASS',width,'Excel portal existente');
  await go('/reservas');await page.getByTitle('Editar Reserva (Admin)',{exact:true}).click();await verify('Editar reserva');await close();
  await page.getByRole('button',{name:'Abrir Ajuda ATEM',exact:true}).click();
  await page.waitForTimeout(300);
  const support=page.getByRole('dialog',{name:'Assistente de suporte'});
  const supportRect=await support.boundingBox();
  assert.ok(supportRect.x>=-1 && supportRect.y>=0 && supportRect.x+supportRect.width<=width+1 && supportRect.y+supportRect.height<=height+1,'Support drawer bounds');
  await page.keyboard.press('Escape');await support.waitFor({state:'hidden'});
  console.log('PASS',width,'Ajuda ATEM');
  await go('/totem');await page.locator('.tablet-tech-card').filter({hasText:'EQAT'}).click();await verify('PIN do totem');
  for(const digit of ['1','2','3','4']) await page.locator('.field-modal-layer').getByRole('button',{name:digit,exact:true}).click();
  await page.locator('.field-modal-layer').waitFor({state:'hidden'});
  await page.getByRole('button',{name:/Reservar Padrões|Alterar Padrões/}).first().click();await verify('Reserva do totem');await close();
  await page.getByRole('button',{name:'Retirar para Chamado',exact:true}).click();await verify('Chamado do totem');await close();
  for(const name of ['Calibração','Empréstimo']) {
   await page.getByRole('button',{name:new RegExp(name)}).first().click();await verify(name+' do totem');await close();
  }
  await page.emulateMedia({reducedMotion:'reduce'});await go('/tecnicos');await create.click();await verify('Movimento reduzido');await close();
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(writes,0);console.log('PASS ALL',checks,'modal checks; zero API writes; zero runtime errors.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
