import {requiredMotionRows,assertMotionCoverage} from '../pipeline/motionRowArtifacts.js';
import {loadReviewContext,motionFingerprint,motionReviewStatus,packFingerprint} from '../pipeline/reviewFingerprint.js';

export async function publishReadiness(repository, characterId) {
  const context = await loadReviewContext(repository, characterId);
  const {draft,frameData,conceptHash} = context;
  const strict = draft.requireMotionCoverage === true;
  const checks = [];
  const check = (id,status,message) => checks.push({id,status,message});
  check('workspace',draft.workbench?.archived || draft.parentId ? 'blocked' : 'pass',draft.workbench?.archived ? 'Restore this draft before publishing.' : draft.parentId ? 'Install this hidden form through its parent fighter.' : 'Active selectable fighter draft.');
  const referenceStatus = conceptHash && draft.referenceReview?.sha256 === conceptHash ? draft.referenceReview.status : 'unreviewed';
  check('reference',referenceStatus === 'rejected' ? 'blocked' : conceptHash && referenceStatus !== 'approved' && strict ? 'blocked' : referenceStatus === 'approved' ? 'pass' : 'warning',
    referenceStatus === 'rejected' ? 'The current identity reference was rejected. Replace it before continuing.' : referenceStatus === 'approved' ? 'Identity review matches the current reference bytes.' : conceptHash ? 'Review the current identity reference.' : 'No separate concept reference recorded. Review identity in the base and motion rows.');
  check('base',frameData.frames?.base?.length ? 'pass' : 'blocked',frameData.frames?.base?.length ? 'Base reference frames are present.' : 'Generate and extract a base reference first.');
  const rows = [];
  for (const row of requiredMotionRows(draft).filter(Boolean)) {
    const fingerprint = await motionFingerprint(context,row);
    const report = draft.motionRows?.[row];
    const clipped=frameData.frames?.[row]?.some(frame=>frame.sourceClipped);
    rows.push({row,...fingerprint,status:clipped?'rejected':motionReviewStatus(report,fingerprint.fingerprint,fingerprint.missing),frameCount:frameData.frames?.[row]?.length ?? 0,
      canRequestChanges:!!fingerprint.fingerprint&&!fingerprint.missing.length,
      canReview:!!fingerprint.fingerprint && !fingerprint.missing.length && (frameData.frames?.[row]?.length??0)>=8 && report?.uniqueFrames >= 8 && !report?.clippedFrames?.length && !clipped,
      notes:report?.review?.notes ?? ''});
  }
  const pending = rows.filter(row => row.status !== 'approved');
  if(rows.some(row=>row.status==='changes-requested'))check('visual-changes','blocked','A current motion review requests changes. Revise and review those rows before publishing.');
  check('motion',pending.length ? strict ? 'blocked' : 'warning' : 'pass',pending.length ? `${pending.length} of ${rows.length} required rows need generation or a current visual review.` : `All ${rows.length} required rows have current, version-bound reviews.`);
  try {assertMotionCoverage(draft);} catch (error) {if(!error.message.startsWith('Incomplete motion pack:'))check('coverage','blocked',error.message);}
  const qa = await repository.getLatestQaReport(characterId);
  const fingerprint = await packFingerprint(context);
  const qaCurrent = qa?.inputFingerprint === fingerprint;
  if(strict&&qa&&qa.provider!=='real')check('qa-adapter','blocked','Validator provenance is missing or not production QA. Run the real pack validator.');
  check('qa',!qa || qa.status === 'fail' || (strict && !qaCurrent) ? 'blocked' : qaCurrent ? 'pass' : 'warning',
    !qa ? 'QA gate: run pack validation before publishing.' : qa.status === 'fail' ? 'QA gate: pack validation failed. Fix its reported errors, then validate again.' : !qaCurrent ? 'QA is stale or unversioned. Validate the current assets and rules.' : 'Pack validation matches the current assets and rules.');
  if (qaCurrent && qa?.status === 'warning') check('qa-warnings','warning','QA has warnings. Read the detailed report before publishing.');
  return {characterId,checkedAt:new Date().toISOString(),strict,canPublish:checks.every(check => check.status !== 'blocked'),checks,rows,
    counts:{approved:rows.length-pending.length,required:rows.length},qaCurrent,referenceStatus,
    note:'Structural readiness does not replace visual review or a real playtest. Existing published copies are unchanged.'};
}

export async function assertPublishReadiness(repository, characterId) {
  const report = await publishReadiness(repository,characterId);
  if (!report.canPublish) throw Object.assign(new Error(`Publish blocked: ${report.checks.filter(check => check.status === 'blocked').map(check => check.message).join(' ')}`),{statusCode:409,readiness:report});
  return report;
}
