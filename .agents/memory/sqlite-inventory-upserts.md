---
name: SQLite inventory upserts
description: Why nonnegative inventory values must be calculated before upserting.
---

**Rule:** Compute and validate the next nonnegative quantity before `INSERT ... ON CONFLICT`; do not insert a negative delta and expect the conflict update to clamp it.

**Why:** SQLite checks the candidate row's `CHECK` constraints before applying the conflict-update branch, so an invalid candidate aborts the statement.

**How to apply:** For inventory changes, calculate the final quantity from the stored value, validate that it is finite and nonnegative, then upsert that absolute quantity.
