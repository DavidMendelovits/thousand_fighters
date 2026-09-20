export type ScenarioLayout = 'center-right' | 'center-left' | 'right-wall' | 'left-wall';
export function scenarioPositions(layout: ScenarioLayout, distance: number): {playerX:number; dummyX:number; facing:1|-1} {
  const gap=Math.max(40,Math.min(420,distance));
  if(layout==='left-wall')return {playerX:104+gap,dummyX:104,facing:-1};
  if(layout==='right-wall')return {playerX:696-gap,dummyX:696,facing:1};
  if(layout==='center-left')return {playerX:550,dummyX:550-gap,facing:-1};
  return {playerX:250,dummyX:250+gap,facing:1};
}
