/// <reference types="vite/client" />

/** 'full' saves; 'preview' is the teaser VC Writer links to and never saves. */
declare const __EDITION__: 'full' | 'preview';

/** The app's version, from package.json. */
declare const __APP_VERSION__: string;

/** True only in the desktop build: the license decides what this copy may do (edition.ts). */
declare const __LICENSING__: boolean;
