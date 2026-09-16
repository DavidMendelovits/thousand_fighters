/** Deterministic companion effect contract; shared by CMS generation and runtime export. */
export function projectileImpact(projectile, prompt = '') {
  const words=`${projectile.id} ${projectile.visual?.kind??''} ${prompt}`.toLowerCase();
  const kind=projectile.grab?'bind':/ink/.test(words)?'ink':/stun|electric|static|sting/.test(words)?'electric':/spore|root|fung/.test(words)?'spores':/wave|pressure|toll/.test(words)?'pressure':/scrap|clinker|furnace|errata|shard/.test(words)?'shards':/needle|seam|thread|ribbon/.test(words)?'thread':'spark';
  const colors={ink:0x73629b,electric:0x96e9ff,spores:0xb9cc68,pressure:0x8bd5d4,shards:0xe3a966,thread:0x66d8c7,bind:0xe1c08e,spark:0xffbd66};
  return {id:`${projectile.id}_impact`,kind,color:projectile.visual?.color??colors[kind],accent:projectile.visual?.accent??0xfff0bc,durationTicks:kind==='bind'?24:18,radius:Math.max(22,Math.min(54,(projectile.width??40)*.7))};
}
