/* ============================================================
   Gear3D — application identity
   ------------------------------------------------------------
   One place. The version previously lived hard-coded in the page
   header AND in the project-file writer, which is exactly the
   arrangement where the two drift apart — they had, and both were
   still claiming 1.0 several releases later.

   A project file records the version that wrote it, so a stale
   number here is not cosmetic: it misattributes provenance in a
   saved figure.
   ============================================================ */

'use strict';

export const APP_NAME = 'Gear3D';

/** Semantic version of the application. */
export const APP_VERSION = '1.11.0';

/** Short form for the title block: major.minor only. */
export const APP_REVISION = APP_VERSION.split('.').slice(0, 2).join('.');
