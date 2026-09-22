import {AsyncLocalStorage} from 'node:async_hooks';

const execution=new AsyncLocalStorage();
export const withBuildObserver=(observe,callback)=>execution.run(observe,callback);
export const observeBuildAttempt=event=>execution.getStore()?.(event);
