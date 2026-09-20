/** Durable review feedback reaches both image and video retries. It is art
 * direction, never executable configuration or an automatic retry request. */
export function withMotionReviewFeedback(prompt, draft, row) {
  const review=draft?.motionRows?.[row]?.review;
  const notes=review?.decision==='changes-requested'?review.notes?.trim():'';
  if(!notes)return prompt;
  const feedback=`Requested corrections from visual review of ${row}: ${notes.slice(0,4000)}`;
  return String(prompt??'').includes(feedback)?prompt:`${prompt??''}\n\n${feedback}`;
}
