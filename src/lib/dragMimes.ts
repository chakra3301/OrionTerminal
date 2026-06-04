/** Cross-surface drag MIMEs. Centralized so producers (e.g. Archives Media
 * tiles) and consumers (e.g. ClaudeChat input) can't drift. */

/** Carries an absolute filesystem path for an Archives asset. Drop targets
 * that recognize this MIME can pull the path via
 * `e.dataTransfer.getData(ASSET_DRAG_MIME)` and use it however they want
 * (Claude rails append `@<path>` to the input; future targets might
 * embed the asset into a note or a frame). */
export const ASSET_DRAG_MIME = "application/x-orion-asset";
