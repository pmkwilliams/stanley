# Layouts: Jev decides what the screen shows

The screen used to show one app. Stanley works in the background on the app in `focus`, and when a
task ended `finishTask` called `global('show')`, which always put that app alone in front. That
line is now a decision Jev makes, from the conversation and what is on the screen, among four
layouts:

- one app, filling the screen
- two apps side by side
- one left, two stacked on the right
- two stacked on the left, one right

(and the home screen, with none).

## The decision (Jev only, no extra call)

Two questions join the four every tick already asks (`screen.ts`):

- `show`: "When Stanley has done what the user asked, which apps are on the screen?" One option per
  set of one to three apps ("Email", "Email and Tasks", "Email, Tasks and Weather"), then home:
  64 for 7 apps.
- `left`: "…which apps are on the left side of the screen?" One option per set of one or two: 28.

The layout follows: one app fills the screen; with more, the likeliest left side the chosen apps
can make (at least one on each side, at most two) goes left, the rest right. Apps keep the stacking
order they had. When `left` is unsure (< `screen.left`) about apps already on the screen, they keep
their sides.

What `eval:layout` settled:

- A question per set, not per app: per app (alone / left / right / hidden) passed 31/38.
- What is on the screen is in the conversation, where it changed (`layoutLine`), as thinking reads
  it too; how the screen works (`SCREEN_PROMPT`) is in both models' instructions. After the
  conversation, Jev kept to the screen as it was: 0/16 on the two hardest cases, against 8–13/16
  ahead of it. In it, where it changed, passed 59/63 to ahead of it 62/63 on 3 runs, and 14/20 each
  on 10 runs of the two that differed.
- Home last among `show`'s options: first, it drew answers toward the screen as it was.
- Unsure (`show` < `screen.show`, 0.3): the screen stays as it is. Showing the app Stanley worked on
  alone, as before, was the worst choice in 7 of the 9 unsure answers; Jev's own guess was right.
- Words, not pictures (below).

Candidates (`World.placeable()`): the apps, plus the one that shows web pages once it has a page;
those on the screen and in focus first, at most 11 (232 `show` options, under Jev's 255). The
option names are frozen with the question, so answers map back to ids.

## When the screen changes

1. **A task ends** (`settleScreen`):
   - by a `done` tick: its `show`/`left` answers already saw the final state;
   - any other way (thinking, a question asked): one Jev call asks just `show` and `left`.
   It is left alone when the task laid the screen out itself (an `arrange the screen` step, Full
   screen, going home), when new words made the deciding call stale, or when the screen changed
   (the user clicked) since Jev decided. A failed call shows the app worked on, as before.
2. **The request is only about the screen** ("swap them", "just the inbox", "hide the weather"):
   the `arrange the screen` step applies the same tick's answers at once, and is written into the
   conversation ("Wren arranged the screen: Tasks (left), Email (right).") so the next tick sees it
   done. It is Jev's alone: thinking isn't offered it. Unsure, thinking takes the turn and can ask.
   A stale one never runs (unlike other navigation).
3. **Going home** shows the home screen at once.

Mid-task nothing moves: Stanley works in the background until the task ends, except that a page it
writes is shown as it is written. Showing the app Stanley works on (that page, or the user's own
click on an app) leaves a layout it is already in, and otherwise shows it alone.

## Full screen

A window control on apps that can fill the screen, remembered per app, in effect only when the app
is alone. Pressing it shows the app alone, filling the screen; beside another app the button reads
"Full screen".

## Code

- `packages/agent/src/screen.ts`: `screenQuestions`, `chooseScreen`, `describeScreen`,
  `validSides`, `layoutText`.
- `World`: `sides()`, `placeable()`, `arrange(sides)`; without them the agent behaves as before.
- `Shell`: `shown: Sides`; `arrange` validates, opens apps not yet open, and leaves `focus` alone.
- `Layout` (`app-sdk`): `{ sides, fullscreen }`.
- Renderer: `screen.ts` places windows on a two-column grid (`screenGrid`, `windowPlace`); the
  gallery's `Screen.svelte` uses the same, so the eval's pictures match the app. A hidden kept
  window (Web) is out of the grid.
- Motion (`motion.ts`), as a tiling window manager's (Hyprland): windows that stay glide to their
  new cells, resizing on the way, with a slight overshoot (FLIP, 450 ms); new ones pop in; leaving
  ones shrink away where they were, out of the grid. Full screen glides the same way.
- Debug: a `screen` event per decision (source, before, after or why it was left, confidence), shown
  in the tick inspector.

## Not in this build: pictures (jev-1.14.0)

Tried both ways on the eval, with pictures of the apps' real windows (see `evals/README.md`): a
picture with the words passed 31/38 to the words' 37/38 on `jev`, and a picture alone 28/38.
Checking the screen after it is arranged, in words or as a picture, kept 32/38 right arrangements
and turned down only 30–34 of 50 wrong ones, favouring the app Stanley worked on: it would undo more
right choices than it caught wrong ones. So no check, and the decision reads words.

## What the decision costs the rest

Two more questions make each decision read about 55% more (64 + 28 options), at the same p50
(0.2 s). Replaying the decisions where two scenarios went wrong, ten-odd times each through Jev
with parts of the prompt taken out: `tasks-homophone-fixed` sits on the act threshold with or
without the layout (P(act) 0.53–0.57, 0.55 on main), so it is main's own flake. `files-answer`
turned on the `arrange the screen` option's description, which tipped a near tie between "list
files" and "open Tasks" to the wrong side; "Move, show or hide the windows on the screen." put it
back (8/8 over 8 runs, 6/8 before). What is on the screen raises P(act) a little (0.73, against 0.58
without it) without changing the step.

## Follow-ups

- Tiles are as big as their cells: apps should lay out for a half-height tile (the forecast and
  the inbox list scroll).
