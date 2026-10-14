# Skills

Plan for giving Stanley skills: know-how and ways of acting ("when I say wind down, dim the lights
and play my sleep playlist", "how I like my emails written") that the user, or Stanley when asked,
writes down once and Stanley uses from then on.

Status: planned.

## Principles

- **As close to what models are trained on as we can.** The Agent Skills format (agentskills.io)
  in the coding-agent location, loaded by progressive disclosure, edited with ordinary file tools.
  No skill-specific tools, and no skill for writing skills: models already know how.
- **A skill is context, not a route.** Loading one puts its body in the history. Who acts next is
  decided as it is without it: Jev takes clear, reversible steps, thinking takes words and judgement,
  and the commit rules don't change.
- **The user's to edit.** Plain files in a folder they can open, versioned like the rest of it.

## Where skills live

`~/Stanley/.agents/skills/<name>/SKILL.md`. Commands run with `HOME` set to the files folder, so to
the agent this is `~/.agents/skills/`, the user-level location coding agents use.

```
---
name: wind-down
description: When the user says "wind down" or that they're going to bed. Dims the lights and plays the sleep playlist.
---

Turn the lights down to 20%, then open Music and play the "Sleep" playlist. Don't say anything.
```

- `name` is the folder's name: lowercase letters, numbers and hyphens, at most 64 characters.
  `description` is what it does and when to use it, at most 1024 characters. A folder without a
  valid `SKILL.md` is skipped (and shown in the debug window, so a typo is findable).
- Other files in the skill's folder (`references/`, notes, examples) are read only when the body
  says to, by thinking with `bash`.
- Every change is kept by the files history already: snapshots `git add -A` the whole folder,
  dot-folders included.
- `FileTools.paths()` leaves out hidden paths, so skills never show up as `read file:` options.
  They show up once, as skills.
- Skills need the files folder: a session without it has none.

## Using a skill

**Jev.** Each skill is a step option, `use skill: <name>`, its description the option's
description. Skills are few, so all are offered, like apps; if there are many, they are ranked with
the screen's elements by `pick`. Using one is a read, like `read file:`, so it runs mid-word: it
goes into the history as `cat -- '.agents/skills/<name>/SKILL.md'` with its output, and Jev's
rendering (`narrate`) shows the whole body, not a 200-character excerpt, while it is in Jev's window.
Then Jev decides the next step with the skill in view, and hands over to thinking whenever it would
anyway.

**Thinking.** A `## Skills` section in `instructions()` lists each skill's name, description and
path, and says to read a skill's `SKILL.md` with `bash` before acting on a request it matches. A skill
Jev already loaded is in the history as Stanley's own `bash` call, so thinking doesn't read it again.

## Creating and editing skills

Thinking does it with `bash`, when the user asks ("remember that…", "next time I say…", "change my
wind-down skill"). The instructions say where skills live and that they follow the Agent Skills
format; the rest models know. It edits a skill only when asked, as for the user's other files.

## Keeping the list current

The instructions are fixed for the session (the prompt cache depends on it), so the list in them is
the list at the start. Skills are read from disk each tick (as `paths()` is): Jev's options are
always current. When the skills differ from what thinking was last told, a note goes with the next
observation, like a new day does: `Skills changed: added wind-down (<description>); removed …`.
Editing a skill's body needs no note: thinking reads the file when it uses it.

## Stages

1. **Skills on disk.** `FileTools.skills()` in `packages/files`: scan `.agents/skills/*/SKILL.md`,
   parse the frontmatter, return `{ name, description, path }`. Tests for valid, invalid and
   missing skills.
2. **Jev.** The `skill` target in `stepOptions`, its run in `agent.ts` (beside `look`), a `skill`
   `FileMeta`, and `narrate` rendering the body in full. The Jev prompt's file line mentions skills.
3. **Thinking.** The `## Skills` section, and the `Skills changed` note.
4. **Evals.** Scenarios with a skills folder:
   - a routine skill Jev runs on the fast path ("wind down");
   - a know-how skill that changes what thinking writes ("reply to Sam saying yes", with a skill on
     how the user signs off);
   - a skill that doesn't apply losing to the obvious app;
   - "remember that when I say focus, you pause the music", then "focus" in the same session.

## Open questions

- Does Jev follow a loaded skill's steps, or does a body in its state mostly push it to `think`?
  Stage 4's first scenario answers it; if not, a skill may still be loaded by Jev but acted on by
  thinking.
- How long a body Jev can carry in its state before ticks slow down. A body is in Jev's window for
  as long as the turn it was loaded in is.
