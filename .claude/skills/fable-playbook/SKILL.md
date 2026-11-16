---
name: fable-playbook
description: Use when starting any task that changes code, data, or documents, or when asked to plan a task, break work into steps, or check your own work before reporting it done. Also use when a fix looks obvious, when time pressure tempts skipping checks, or when two attempts at the same problem have failed.
---

# Fable Playbook

## Overview

A working method in seven steps: pin down the task, look, find the trap, split, build, check, report.

Core principle: every claim you make about your work must trace back to something you ran or read in this session. If it does not, either go get the evidence or say plainly that you did not check.

Before you start any task, tell the user which steps you are following, by number and name. On a small task each step can be one line. Shrink steps, never skip them.

## The steps

### S1. Pin down the task

1. Restate the request in one sentence, in your own words.
2. Write the done criteria as things someone could observe: a command that passes, an output that matches, a screen that shows a value.
3. Write what is out of scope, so you do not drift into it.
4. Ask the user a question only if the answer changes what you build and you cannot find it by looking. Otherwise pick the sensible default and say which one you picked.

### S2. Look before planning

Read first. A plan made before reading is a guess.

1. Open the code you will change and read all of it, not just the function named in the request.
2. Search for every caller and every consumer of what you will change. Open at least one real call site.
3. Find out what real input looks like. Read the data, the fixtures, or the place the values come from.
4. Find the project's own checks before you edit anything: lint, build, type check, tests. Read the scripts in the package or build file. Run them once now so you know which failures were already there.

### S3. Find the trap

Before choosing an approach, answer these in writing:

1. What is the obvious fix, and what legitimate case does it break? Look for normal input that resembles the bad input.
2. Who else depends on the current behavior?
3. What here is hard to undo? Deleting, overwriting, sending, publishing, and migrating all need a look at the target and a go ahead from the user.
4. What am I assuming that I have not verified? Verify the one that would hurt most if wrong.

If a stronger advisor model is available, this step and the stuck rule below are the moments to consult it.

### S4. Split into steps

1. Each step has exactly one outcome and one check that proves it.
2. Put the riskiest or least understood step first. Learn the bad news early.
3. Keep the change as small as the done criteria allow. No extra refactors, no extra features.
4. Mark steps that do not depend on each other. Those can run in parallel.
5. If you cannot name the check for a step, the step is too vague. Split it again.

### S5. Build one step at a time

1. Do one step. Run its check. Only then start the next.
2. Never stack several unchecked steps. When the stack fails you will not know which layer broke.
3. When something surprises you, stop. A surprise means your picture from S2 is wrong. Go back and look again instead of patching around it.

Stuck rule: two failed attempts at the same idea means the idea is wrong, not the execution. Return to S2, reread, and form a different explanation before trying a third time.

### S6. Check your own work

Do all of these that apply. Write down the ones you could not do.

1. Run the changed thing for real, with real shaped input. Reading the code is not running it.
2. Test the bad case, the normal case, the edge case, and the case that must stay unchanged.
3. Run the project checks you found in S2. Compare against the earlier run so you only own the new failures.
4. Read your full diff from top to bottom as if a stranger wrote it. Look for leftover debug output, unrelated edits, and comments that no longer match.
5. Go back to the done criteria from S1. Tick each one against evidence. A criterion with no evidence is not done.

### S7. Report

Your final message has these parts, in this order:

1. The outcome in one or two sentences.
2. What you verified and how: the commands and what they showed.
3. What you did not verify and why. Include what the user can do to cover it.
4. Choices you made on the user's behalf, and any side effects of them.
5. Anything unfinished or newly discovered.

If a check failed, say so and show the output. Never write that something works, passes, or is fixed unless S6 produced the evidence in this session.

## Quick reference

1. S1 Pin down the task: one sentence restatement, observable done criteria, scope.
2. S2 Look before planning: full file, callers, real input, project checks run once.
3. S3 Find the trap: what the obvious fix breaks, who depends on it, what is irreversible.
4. S4 Split into steps: one outcome and one check each, riskiest first, smallest change.
5. S5 Build one step at a time: check before moving on, stop on surprise.
6. S6 Check your own work: run it, four cases, project checks, read the diff, tick criteria.
7. S7 Report: outcome, verified, not verified, choices, leftovers.

## Example

Request: "Stop CSV formula injection in the export helper. Ship fast."

1. S1: Done means a cell starting with an equals sign opens as text in a spreadsheet, and existing exports otherwise look the same.
2. S2: Search for callers of the export helper. Open them. See that several columns carry money amounts, some negative.
3. S3: The obvious fix prefixes every cell that starts with a minus sign. That turns every negative amount into text and breaks totals in the spreadsheet. Plain numbers must pass through untouched.
4. S4: Step one, guard formula like text. Step two, exempt plain numbers. Each gets a sample run.
5. S5 and S6: Run the escape function on formula text, negative numbers, ordinary text, and cells with commas. Run lint and build.
6. S7: Report the fix, the sample results, the lint and build results, and that nobody opened a real export in a spreadsheet yet.

## Common mistakes

1. Editing the named file without searching for callers. Fix: S2 item 2 comes before any edit.
2. Verifying only with a hand written script while the project's lint and build sit unused. Fix: S2 item 4 and S6 item 3.
3. Testing only the case you fixed. Fix: always include the case that must stay unchanged.
4. Treating time pressure as permission to skip checks. Fix: shrink the steps to one line each, keep all seven.
5. Saying "done" when part of the work is untested. Fix: S7 part 3 is required even when the list is short.
6. Trying a third variation of a failed idea. Fix: the stuck rule.
