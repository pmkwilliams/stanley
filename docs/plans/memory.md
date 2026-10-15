# Memory

What Stanley keeps from one session to the next: facts the user asked it to remember, or said
about themselves and will clearly need again ("my manager is Priya", "I'm allergic to peanuts").
Skills are how to do something; memory is what to know.

Status: implemented.

## Shape

- One file, `~/Wren/.agents/MEMORY.md` (`~/.agents/MEMORY.md` to the agent), one short line per
  fact. The user's to read and edit; kept by the files history like everything else in the folder.
- Read once when the session starts (`Agent.memoryReady`), and given whole:
  - to thinking, in a `## Memory` section of its instructions (`memoryPrompt`), so the prompt cache
    holds for the session;
  - to Jev, after its other prompts (`jevMemory`), so "email my manager" can stay on the fast path.
- At most 4,000 characters are read; past that it is cut short.
- Thinking adds a line with its file tools when the user asks it to remember something, or says
  something about themselves it will clearly need later. The instructions give this one line and
  say it is rare. A change reaches the next session; this one already has it in the conversation.
- No files folder, no memory. Background tasks get what they need in their brief.

## Evals

The fixture folder has a `MEMORY.md` with one fact, so every scenario runs with memory present.
- `memory-recalled`: "open the email from my manager" opens Priya's.
- `memory-saved`: "remember that I'm allergic to peanuts" adds it and keeps the fact already there.
- `skill-not-needed` also checks a task's details aren't saved.
