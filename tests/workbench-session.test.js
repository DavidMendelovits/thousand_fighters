import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchSession} from '../admin/WorkbenchSession.js';
import {initialMove} from '../admin/workbenchLayout.js';

test('one session owns listeners, document resources and stale selection callbacks',()=>{
  const owner={},target=new EventTarget();let calls=0,disposals=0;
  const first=new WorkbenchSession(owner);first.listen(target,'click',()=>calls++);
  const stale=first.beginSelection();first.beginSelection();assert.equal(stale(),false);
  for(let i=0;i<20;i++){
    const scope=first.replaceDocument();scope.listen(target,'row',()=>calls++);scope.own(()=>disposals++);
  }
  target.dispatchEvent(new Event('row'));assert.equal(calls,1);assert.equal(disposals,19);
  const late=first.documentScope.guard(()=>calls++);
  const next=new WorkbenchSession(owner);late();target.dispatchEvent(new Event('click'));
  assert.equal(calls,1);assert.equal(disposals,20);assert.equal(first.disposed,true);
  assert.equal(owner.__workbenchSession,next);next.dispose();assert.equal(owner.__workbenchSession,undefined);
});

test('focus resolves URL then remembered move then actionable row, with safe fallback',()=>{
  const groups=[{id:'idle'},{id:'jab',moves:[{}]},{id:'kick',moves:[{}]},{id:'projectiles'}];
  assert.equal(initialMove(groups,'kick','jab'),'kick');
  assert.equal(initialMove(groups,'deleted','kick'),'kick');
  assert.equal(initialMove(groups,'deleted','other_character'),'jab');
  assert.equal(initialMove([{id:'idle'}],null,null),'idle');
  assert.equal(initialMove([],null,null),undefined);
});

test('repeated modal and review scopes release listeners without accumulating cleanup entries',()=>{
  const session=new WorkbenchSession({}),target=new EventTarget();let calls=0;
  for(let i=0;i<30;i++)session.replaceScope('modal').listen(target,'click',()=>calls++);
  target.dispatchEvent(new Event('click'));assert.equal(calls,1);
  assert.equal(session.children.size,1);
  const child=session.children.get('modal');session.dispose();
  target.dispatchEvent(new Event('click'));assert.equal(calls,1);assert.equal(child.disposed,true);
});
