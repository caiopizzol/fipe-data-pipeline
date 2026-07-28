# Pickled context integrity

## Invariant

The repository's agent-facing usage contract stays semantically consistent across the
implementation, `llms.txt`, and `pickled.yml`. When a change affects supported commands or flags,
prerequisites, optional versus required environment variables, backup or retention behavior,
database concepts, or checked examples and misstatements, every representation that became stale
is updated. `llms.txt` is the primary injected context for Pickled questions, and `pickled.yml`
assertions test the current contract instead of preserving obsolete behavior.

## Exceptions

Internal refactors, non-user-facing fixes, and additions outside this usage contract do not require
documentation changes. Wording may differ as long as the meaning agrees. The Pickled solution
fixture is task-specific and changes only when that task's contract changes.

## Consequence

Drift can leave deterministic configuration checks green while real-agent evaluations use stale
guidance or assert obsolete behavior. It can also publish commands or requirements that no longer
work.

## Scope

Apply this invariant to changes affecting agent context, Pickled configuration and fixtures,
documented setup and commands, package scripts, CLI behavior, environment configuration, backup
behavior, schema sources, Docker usage, or the Pickled workflow.
