# Workbench: summons, transformations and animation planning

The **Summons, forms & animation plan** section edits character mechanics without calling image or video providers. Generation remains explicit on each animation row. Definitions are checkpointed through the CMS tool boundary.

## Controlled summons

1. Expand Summons. Set an actor ID, isolated appearance/movement description, lifetime, speed, spawn offsets and button/direction.
2. Save. The workbench adds a summon command and a neutral-heavy recall for that actor. The body remains vulnerable while control is transferred; this is currently a fixed mechanic, not an invulnerability toggle.
3. Add a controlled strike or grab from an existing compatible move. Choose a fresh ID and a character-appropriate command. Body velocity and visual effects are not copied; contact geometry and timing are retained and scoped to the summon.
4. Use the move's Tune tools to adjust timing, collision and grip sockets. Generate the actor's isolated reference, then video motion for its actions. Review each row before publication.

Commands conflict only within the same control context: a body and its summon may use the same button. The native editor checks exact directional command conflicts, not every possible ambiguity involving long strings or motion inputs. It does not auto-invent a complete move vocabulary.

## Independent transformation forms

1. Expand Transformations. Supply a globally unique form ID, name, independent art brief, meter cost and expiry: timed or until knockout.
2. Save, then Open workspace. The hidden child starts with compatible body mechanics and **no inherited artwork**. Edit its moves and create its own reference, motion and projectile assets. It may also have its own summons.
3. Finish the animation plan and visually review motion. Install reviewed snapshot from the parent workspace.
4. Publish the parent. The form cannot be published directly as a separately selectable fighter. Use the game's existing Form control to activate it.

Installation requires its own base reference, at least eight extracted frames for each required motion row, approved motion reports, no reported clipping, and readable required assets. These structural checks do not replace reviewing identity, fluid movement, contact, direction and clipping in gameplay.

Installed form config and assets are copied into a unique parent-owned directory with the source child version recorded. Editing the child later does not mutate the installed form. Install again deliberately to update it; parent history includes the copied pack. Missing or concurrently changed assets leave the parent's installed config unchanged. Existing legacy embedded forms remain in the advanced editor until a migration workflow is built. Nested transformations are unsupported.

## Animation job plan

The planner groups the current draft and linked hidden forms, identifies actor ownership, and lists required rows once. Statuses distinguish missing reference, blocked motion, extracted frames, pending review, rejection and approval. Filters and Open row/Open form lead back to the existing generation/review interface.

Opening or refreshing the plan submits **zero generation requests** and creates no character checkpoint. Normal audit logging may still occur. It does not schedule batches, retry paid calls, estimate bills or provide process-restart recovery. Projectile travel/impact and other effect sequences are not yet jobs in this plan; author those through their existing controls.

## Verification and limits

Use `node tests/fixtures/summon-workbench.mjs` for the disposable, keyless browser fixture on port 8796. Its mock assets are plumbing checks only. Stop it normally to remove its temporary data.

`node --test tests/character-components.test.js` covers definitions, input conflicts, independent form drafts, read-only planning, immutable installation/export, missing or changing assets, hidden publication and controlled summons inside forms.

This implementation has desktop/mobile browser checks and focused automated coverage. It is not evidence of a newly generated, visually approved fighter or a completed gameplay recording. Independent form SFX packaging, broader expiry rules, full effects planning and durable background jobs remain separate roadmap items.
