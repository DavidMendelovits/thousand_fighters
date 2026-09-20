import {buildFixture} from '../helpers/buildFixture.js';
const fixture=await buildFixture({port:Number(process.env.BUILD_FIXTURE_PORT??8795),delayMs:15000});
console.log(`Controlled build demo: ${fixture.url}/roster/${fixture.characterId}?standalone=1 (no external generation)`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await fixture.close();process.exit();});
