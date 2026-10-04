/**
 * CANVAS domain — public API. Owner: canvas agent.
 * Presentational: receives data + `DesignActions` through props; never imports the store.
 */
export { Scene } from './Scene';
export { PhotoSizeProvider } from './PhotoSize';
export { Thumbnail } from './Thumbnail';
export { usePlayback, DEFAULT_PLAYBACK_SPEED } from './usePlayback';
export { fitView, type View } from './Scene';
