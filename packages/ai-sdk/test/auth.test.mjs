import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthSessionManager, ZhijueAIClient, ZhijueAuthClient, ReauthenticationRequiredError, SessionChangedError, AuthRenewalError, AuthenticationError, sessionFromLogin, buildPhoneCodeRequest, LoginRejectedError, LoginBootstrapError, BusinessError } from '../dist/index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const makeSession=(token='fixture-token',expiresAt=100000,userId=11)=>({accessToken:token,expiresAt,userId});

test('login lifetime uses numeric seconds/default and does not adopt a refresh token',()=>{
  assert.deepEqual(sessionFromLogin({status:'success',userId:11,accessToken:'fixture',accessExpiresIn:60,expiresIn:20,refreshToken:'not-adopted'},1000),{userId:11,accessToken:'fixture',expiresAt:61000});
  assert.equal(sessionFromLogin({status:'success',userId:11,accessToken:'fixture',expiresIn:'10'},1000).expiresAt,7201000);
  assert.equal(sessionFromLogin({status:'success',userId:11,accessToken:'fixture',accessExpiresIn:0},1000).expiresAt,1000);
  assert.throws(()=>sessionFromLogin({status:'failure',userId:11,accessToken:'fixture'}),LoginRejectedError);
});

test('expired token without a verified renewal adapter fails before any API request',async()=>{
  const session=new AuthSessionManager({now:()=>1000});session.setSession(makeSession('expired',1000));let requests=0;
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async()=>{requests++;return json({code:0});}});
  await assert.rejects(client.bootstrap(),ReauthenticationRequiredError);assert.equal(requests,0);
  await assert.rejects(session.renewNow(),ReauthenticationRequiredError);
  assert.equal(JSON.stringify(session).includes('expired'),false);client.dispose();
});

test('concurrent expiry checks share one renewal and use the replacement token',async()=>{
  const gate=deferred();let renewals=0;const used=[];
  const session=new AuthSessionManager({now:()=>1000,renew:async context=>{renewals++;assert.equal(context.reason,'expired');await gate.promise;return makeSession('renewed',100000);}});
  session.setSession(makeSession('expired',500));
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url,init)=>{used.push(init.headers.get('authorization'));return json({code:0,result:{}});}});
  const operations=[client.bootstrap(),client.getWorkSettings(),client.request('GET','/wapi/user/info')];await tick();assert.equal(renewals,1);gate.resolve();await Promise.all(operations);
  assert.deepEqual(used,['Bearer renewed','Bearer renewed','Bearer renewed']);client.dispose();
});

test('GET401 renews once; late old401 uses an already renewed token without another renewal',async()=>{
  const late=deferred();let oldCalls=0,renewals=0;const used=[];
  const session=new AuthSessionManager({now:()=>1000,renew:async()=>{renewals++;return makeSession('new-token');}});session.setSession(makeSession('old-token'));
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url,init)=>{
    const token=init.headers.get('authorization');used.push(token);
    if(token==='Bearer old-token'){oldCalls++;if(oldCalls===2)await late.promise;return json({code:401},401);}
    return json({code:0,result:{ok:true}});
  }});
  const a=client.bootstrap(),b=client.getWorkSettings();await a;late.resolve();await b;
  assert.equal(renewals,1);assert.deepEqual(used.sort(),['Bearer new-token','Bearer new-token','Bearer old-token','Bearer old-token'].sort());client.dispose();
});

test('POST401 is not automatically replayed; next request may renew proactively',async()=>{
  let writes=0,renewals=0;
  const session=new AuthSessionManager({now:()=>1000,renew:async()=>{renewals++;return makeSession('new-token');}});session.setSession(makeSession());
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url,init)=>{if(init.method==='POST'){writes++;return json({code:401});}return json({code:0,result:{}});}});
  await assert.rejects(client.toggleProxy(true,'AUTO_CHAT'),AuthenticationError);assert.equal(writes,1);assert.equal(renewals,0);
  await client.bootstrap();assert.equal(renewals,1);assert.equal(writes,1);client.dispose();
});

test('a second401 cannot enter a renewal loop and invalidates only the rejected token',async()=>{
  let calls=0,renewals=0;const session=new AuthSessionManager({now:()=>1000,renew:async()=>{renewals++;return makeSession('new-token');}});session.setSession(makeSession());
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async()=>{calls++;return json({code:401});}});
  await assert.rejects(client.bootstrap(),AuthenticationError);assert.equal(calls,2);assert.equal(renewals,1);assert.equal(session.authenticated,false);client.dispose();
});

test('account replacement rejects old HTTP success/401 instead of replaying under new identity',async()=>{
  for(const raw of [{code:0,result:{owner:11}},{code:401}]){
    const gate=deferred();let calls=0;const session=new AuthSessionManager({now:()=>1000});session.setSession(makeSession('A'));
    const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async()=>{calls++;await gate.promise;return json(raw);}});
    const pending=client.bootstrap();await tick();session.setSession(makeSession('B',100000,22));gate.resolve();
    await assert.rejects(pending,SessionChangedError);assert.equal(session.exportSession().accessToken,'B');assert.equal(calls,1);client.dispose();
  }
});

test('logout during renewal aborts its context and stale completion cannot restore a session',async()=>{
  const gate=deferred();let signal;const session=new AuthSessionManager({now:()=>1000,renew:async context=>{signal=context.signal;await gate.promise;return makeSession('late-token');}});session.setSession(makeSession('old',0));
  const operation=session.authorize();await tick();session.clear();assert.equal(signal.aborted,true);gate.resolve();await assert.rejects(operation,SessionChangedError);assert.equal(session.hasSession,false);
});

test('renewal adapter cannot silently switch accounts or return an already expired token',async()=>{
  for(const next of [makeSession('wrong-account',100000,22),makeSession('still-expired',0,11)]){
    const session=new AuthSessionManager({now:()=>1000,renew:async()=>next});session.setSession(makeSession('old',0));
    await assert.rejects(session.authorize(),error=>error instanceof SessionChangedError||error instanceof AuthRenewalError);
    assert.equal(session.exportSession().accessToken,'old');
  }
});

test('session change cancels an unstarted AI session without sending it as another account',async()=>{
  let calls=0;const session=new AuthSessionManager({now:()=>1000});session.setSession(makeSession('A'));
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async()=>{calls++;throw new Error('not expected');}});
  const stream=client.userSay({content:{content_type:'text'}});session.setSession(makeSession('B',100000,22));
  await assert.rejects(async()=>{for await(const event of stream){}},SessionChangedError);assert.equal((await stream.completion).termination,'aborted');assert.equal(calls,0);client.dispose();
});

test('captcha request preserves verified proof shape and explicitly supplied headers',async()=>{
  assert.deepEqual(buildPhoneCodeRequest('fixture-phone',{type:3,randKey:'fixture-key',captcha:'fixture-proof'}),{phone:'fixture-phone',loginDevice:'H5',captchaType:3,geetVerify:{},wyVerify:{},imageVerify:{key:'fixture-key',captcha:'fixture-proof'}});
  const requests=[];const session=new AuthSessionManager();
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,headers:{Authorization:'Bearer must-be-removed'},fetch:async(url,init)=>{requests.push({url:new URL(url),init});return json({code:0,result:{}});}});
  const auth=new ZhijueAuthClient(client,session);await auth.captchaType();await auth.sendPhoneCode('fixture-phone',{type:4,wyCaptchaId:'fixture-id',validate:'fixture-proof'},{headers:{'X-Captcha-Proof':'fixture-header'}});
  assert.equal(requests[0].init.headers.has('authorization'),false);assert.equal(requests[1].init.headers.get('x-captcha-proof'),'fixture-header');
  assert.equal(JSON.parse(requests[1].init.body).loginDevice,'H5');client.dispose();
});

test('phone login uses APP body then authenticated profile; guide remains an explicit step',async()=>{
  const requests=[];let now=1000;const session=new AuthSessionManager({now:()=>now});
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url,init)=>{
    const path=new URL(url).pathname;requests.push({path,init});
    if(path.endsWith('/phone/login'))return json({code:0,result:{status:'success',userId:11,accessToken:'fixture-login-token',accessExpiresIn:3600,refreshToken:'ignored'}});
    return json({code:0,result:{id:11,identity:'GEEK',status:'NOT_AUTHORIZED_ZP'}});
  }});
  const auth=new ZhijueAuthClient(client,session,{now:()=>now});const outcome=await auth.loginWithPhoneCode('fixture-phone','fixture-code',{platform:'ios'});
  assert.deepEqual(JSON.parse(requests[0].init.body),{phone:'fixture-phone',code:'fixture-code',userIdentity:'GEEK',sessionType:'APP',source:'JOBSEEKER_MOBILE_IOS'});
  assert.equal(requests[1].init.headers.get('authorization'),'Bearer fixture-login-token');assert.equal(outcome.authorizationRequired,true);
  assert.equal(requests.length,2);assert.equal(session.exportSession().refreshToken,undefined);assert.equal(session.exportSession().expiresAt,3601000);client.dispose();
});

test('concurrent login attempts reject stale adoption; failed logout still clears local session',async()=>{
  const old=deferred();let logins=0;const session=new AuthSessionManager({now:()=>1000});
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url)=>{
    if(new URL(url).pathname.endsWith('/phone/login')){logins++;if(logins===1){await old.promise;return json({code:0,result:{status:'success',userId:11,accessToken:'A'}});}return json({code:0,result:{status:'success',userId:22,accessToken:'B'}});}
    return json({code:500,msg:'fixture logout failed'});
  }});
  const auth=new ZhijueAuthClient(client,session,{now:()=>1000});const a=auth.loginWithPhoneCode('A','fixture',{fetchProfile:false});await tick();await auth.loginWithPhoneCode('B','fixture',{fetchProfile:false});old.resolve();await assert.rejects(a,SessionChangedError);assert.equal(session.exportSession().accessToken,'B');
  await assert.rejects(auth.logout());assert.equal(session.hasSession,false);client.dispose();
});

test('async header preparation cannot send an old-account POST with a new-account token',async()=>{
  const gate=deferred();let calls=0;const session=new AuthSessionManager({now:()=>1000});session.setSession(makeSession('A'));
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,headers:async()=>{await gate.promise;return {};},fetch:async()=>{calls++;return json({code:0});}});
  const pending=client.request('POST','/wapi/user/updateInfo',{body:{identity:'GEEK'}});await tick();session.setSession(makeSession('B',100000,22));gate.resolve();
  await assert.rejects(pending,SessionChangedError);assert.equal(calls,0);assert.equal(session.exportSession().accessToken,'B');client.dispose();
});

test('multi-step BOSS consent stays bound to the original account',async()=>{
  let headers=0,calls=0;const session=new AuthSessionManager({now:()=>1000});session.setSession(makeSession('A'));
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,headers:()=>{if(++headers===2)session.setSession(makeSession('B',100000,22));return {};},fetch:async()=>{calls++;return json({code:0,result:{}});}});
  const auth=new ZhijueAuthClient(client,session);await assert.rejects(auth.authorizeBossData(),SessionChangedError);assert.equal(calls,1);assert.equal(session.exportSession().accessToken,'B');client.dispose();
});

test('same-token renewal increments credential revision so a late401 cannot expire it',async()=>{
  let renewals=0;const session=new AuthSessionManager({now:()=>1000,renew:async()=>{renewals++;return makeSession('same-token',200000);}});session.setSession(makeSession('same-token'));
  const old=await session.authorize();await session.renewNow();session.rejectAuthorization(old);
  assert.equal(session.exportSession().expiresAt,200000);await session.recoverUnauthorized(old);assert.equal(renewals,1);
});

test('login profile failure reports partial bootstrap; skip-profile uncertainty remains explicit',async()=>{
  const session=new AuthSessionManager({now:()=>1000});const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async(url)=>new URL(url).pathname.endsWith('/phone/login')?json({code:0,result:{status:'success',userId:11,accessToken:'fixture'}}):json({code:500})});
  const auth=new ZhijueAuthClient(client,session,{now:()=>1000});await assert.rejects(auth.loginWithPhoneCode('fixture','fixture'),LoginBootstrapError);assert.equal(session.hasSession,true);assert.equal(session.authenticated,true);
  const outcome=await auth.loginWithPhoneCode('fixture','fixture',{fetchProfile:false,returnEnvelope:true});assert.equal(outcome.authorizationRequired,'unknown');assert.equal(outcome.login.data.status,'success');client.dispose();
});

test('SMS code4 is not a success and disposed clients cannot send after async preparation',async()=>{
  const session=new AuthSessionManager();const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',auth:session,fetch:async()=>json({code:4})});
  await assert.rejects(new ZhijueAuthClient(client,session).sendPhoneCode('fixture',{type:0}),error=>error instanceof BusinessError&&error.code===4);client.dispose();
  const gate=deferred();let calls=0;const waiting=new ZhijueAIClient({baseUrl:'https://sdk.invalid',headers:async()=>{await gate.promise;return {};},fetch:async()=>{calls++;return json({code:0});}});
  const pending=waiting.bootstrap();await tick();waiting.dispose();gate.resolve();await assert.rejects(pending,/disposed/);assert.equal(calls,0);
});
