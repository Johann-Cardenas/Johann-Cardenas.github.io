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

## Follow-up: module discovery and lesson recovery

This iteration addresses the long overview, the disabled Previous button at lesson boundaries, and generic recovery after an incorrect prediction.

- A five-button module chooser exposes all four module titles and their completion counts before the lesson cards. It combines with text and status filters. A single Show all lessons action clears every filter.
- Search includes module names as well as lesson titles, vocabulary, introductions, and experiment prompts.
- Explicit step selection scrolls to the content. Previous from Understand returns to the preceding lesson’s Check step; the first lesson still has no previous lesson.
- Incorrect answers point back to the current experiment prompt, with a direct Revisit the experiment action. Passing a check reveals lesson, module, or full-path completion and an unfinished lesson to continue with.
- Moving past an unanswered check is labeled Continue without completing; browsing remains unrestricted and completion counts stay accurate.
- `navigation.test.cjs` verifies module selection, combined-filter recovery, previous-lesson transitions, retries, module milestones, mobile overflow, and content focus. Existing progress and course suites remain the regression checks.

## Desktop typography revision

A rendered review showed that the previous 17 px body, 16 px equations, and 14 px chart captions still looked undersized on desktop. The revised default is 24 px body text, 32 px introductory copy, 22 px equations, and 20 px captions, chart labels, and primary lesson controls. Larger text remains optional; the larger baseline does not depend on enabling it. Mobile retains 19 px body text and 16 px supporting text.

The reading panel receives a larger share of the desktop workspace and uses primary text color for explanations. In stacked layouts, reading steps precede the visualization while Experiment keeps the visual first. Field legends and scene notes move below the canvas into a wrapping row. Numeric legend endpoints are checked for overlap.

The typography browser suite asserts computed sizes, overflow, and reading order at desktop widths of 1280/1440/1920 px and mobile widths of 390/320 px. Desktop screenshots are captured at actual viewport size to review the balance between text, navigation, and diagrams.
