# Learning lab reading and progress improvements

## Planned sequence

1. Audit inherited type sizes, including font shorthands, data labels, controls, and charts. Establish a relative type scale and provide a persistent larger-text setting.
2. Verify that normal launch always shows the course overview, saved progress does not redirect learners automatically, and direct lesson links still work.
3. Track per-lesson visited steps and resume position separately from knowledge-check completion. Expose status and progress in the overview, sidebar, and mobile lesson view.
4. Verify state transitions, persistence, legacy data, keyboard navigation, mobile reflow, both themes, numerical behavior, and exports before committing and pushing.

## Implemented behavior

- Standard body text is 17 px, primary controls are 16 px, and secondary text is at least 14 px. Headings use a responsive hierarchy. Larger text scales relative sizes by 12.5%.
- Charts have larger tick labels and extra axis spacing. Bar labels occupy a separate row. Narrow charts can scroll independently without causing page overflow.
- An overview visit does not create activity. Opening a lesson creates an in-progress record. Visiting steps records activity; only a correct check completes the lesson.
- Each lesson remembers its last step. Global and module summaries distinguish completed, in-progress, and not-started lessons; filters support reviewing each group.
- Completion and existing resume data are preserved. Storage failures retain session progress and display an accurate persistence notice.
- Keyboard skip links focus the visible main content without changing routes. Overview links and progress remain accessible in the mobile lesson strip.

## Verification

Run the numerical suites, `course.test.cjs`, and `progress.test.cjs` from the shared lab README. The progress suite checks fresh overview entry, visited-step accounting, incorrect/correct checks, filtered results, reload and history behavior, persisted large text, desktop/mobile overflow, direct links, and blocked storage. The existing course suite covers all 41 lessons, rendering, themes, jobs, exports, and WebGL fallback.
