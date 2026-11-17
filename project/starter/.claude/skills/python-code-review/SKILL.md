---
name: python-code-review
description: Reviews Python (.py) code for common bugs, error and resource handling mistakes, async pitfalls, performance problems, and non-idiomatic patterns, with severity guidance for each finding.
---

# Python Code Review

Use this for `.py` files. Put most of the effort into code that will misbehave; several Python bugs look like perfectly normal code. Style comes last, and if the project runs a formatter or linter (black, ruff, flake8), don't repeat what it would catch.

Security problems such as `eval`, `pickle`, `shell=True`, and SQL built from strings are covered by the security-analysis skill.

## Severity Guide

| Severity | Use when |
|----------|----------|
| critical | Data loss or corruption on a normal path: writing to the wrong file, committing a transaction after a failure, swallowing an exception in code that moves money or deletes records |
| high | A bug real users will hit: a mutable default shared across calls, blocking I/O inside `async def`, a coroutine that's never awaited, a resource leaked on every request, `except: pass` around important work |
| medium | Wrong under some conditions or hard to maintain: naive and aware datetimes mixed, `float` for money, a broad `except Exception` that hides the cause, N+1 queries, changing a collection while looping over it |
| low | Works, but non-idiomatic or slow in a way that won't matter yet: index-based loops, `+=` string building, missing type hints on a public function |
| info | Optional cleanups: `pathlib` over `os.path`, `@dataclass` for a plain data holder |

Categories: crashes and wrong results are `bug-risk`; slow code is `performance`; code that is hard to change is `maintainability`; Python idioms are `best-practice`; naming and formatting are `style`.

## Common Bugs

### Mutable defaults
A default value is created once and shared by every call.

```python
# Bad
def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags

# Good
def add_tag(tag, tags=None):
    if tags is None:
        tags = []
    tags.append(tag)
    return tags
```

- Mutable default (`[]`, `{}`, `set()`) that the function changes: high. If it is only read: low.
- Dataclass field defaulting to a shared mutable object: high. Use `field(default_factory=...)`.
- Mutable class attribute meant to be per instance (`class Cart: items = []`): high. Every instance shares it.

### Late binding in closures

```python
# Bad - every callback prints 2
callbacks = [lambda: print(i) for i in range(3)]

# Good
callbacks = [lambda i=i: print(i) for i in range(3)]
```

Medium (bug-risk).

### Identity and truthiness
- `is` with string or number literals (`if status is "done"`): high. It only works by accident for small ints and interned strings.
- `if value:` or `value or default` when `0`, `''`, or `[]` are valid values: medium. Use `is None` / `is not None`.
- `== None` instead of `is None`: low (style).

### Other bugs to watch for
- Removing items from a list or dict while iterating over it: medium. It skips items or raises `RuntimeError`. Build a new collection or loop over a copy.
- A function that returns a value on some paths and falls off the end (returning `None`) on others: medium.
- `/` where integer division was meant, with the result used as an index or in `range()`: high. It raises `TypeError`.
- `datetime.now()` or `datetime.utcnow()` compared with timezone-aware datetimes: medium. `utcnow()` is deprecated since 3.12; use `datetime.now(timezone.utc)`.
- `float` for money: medium. Use `Decimal` or integer cents.
- Floats compared with `==`: medium. Use `math.isclose`.
- Shadowing a builtin (`list`, `id`, `type`, `input`, `dict`) in a scope that later needs the builtin: medium, otherwise low.

## Errors and Exceptions

```python
# Bad
try:
    charge(order)
except:
    pass

# Good
try:
    charge(order)
except PaymentDeclined as e:
    logger.warning("payment declined", extra={"order_id": order.id})
    raise OrderFailed(order.id) from e
```

- Bare `except:`: high. It also catches `KeyboardInterrupt` and `SystemExit`.
- `except Exception: pass`, or only `print(e)`: high around writes, payments, or external calls; medium elsewhere.
- `return` or `break` inside `finally`: high. It silently throws away the exception in flight.
- Raising a new exception inside `except` without `from e`: low. The original cause gets harder to trace.
- `raise Exception("...")` instead of a specific exception type: low (maintainability).
- `logger.error(str(e))` inside an `except` block: low. `logger.exception(...)` keeps the traceback.
- A `try` block wrapping many statements when only one call can fail: low. Narrow it.

## Resources

```python
# Bad
f = open(path)
data = json.load(f)

# Good
with open(path, encoding="utf-8") as f:
    data = json.load(f)
```

- Files, sockets, locks, DB connections, or HTTP sessions opened without `with` or `try/finally`: high when it happens per request or in a loop, medium otherwise.
- `requests` calls without `timeout=`: medium. They can hang forever.
- A new `requests.Session()` or DB connection created on every call in hot code: medium (performance).
- `open()` in text mode without `encoding=`: low. The default depends on the platform.

## Async

```python
# Bad - blocks the event loop for every request
async def fetch_user(uid):
    return requests.get(f"{API}/users/{uid}").json()

# Good
async def fetch_user(client: httpx.AsyncClient, uid: str):
    resp = await client.get(f"{API}/users/{uid}")
    resp.raise_for_status()
    return resp.json()
```

- Blocking calls inside `async def` (`requests`, `time.sleep`, sync DB drivers, heavy CPU work): high. They stall every other task. Use an async client, `asyncio.sleep`, or `asyncio.to_thread`.
- Calling a coroutine without `await`: high. The work never runs.
- `asyncio.create_task(...)` with no reference kept to the task: medium. It can be garbage collected before it finishes.
- `asyncio.run()` called from code that is already inside a running loop: high. It raises `RuntimeError`.
- `asyncio.gather` where one failure shouldn't cancel or hide the others, with no `return_exceptions=True` or `TaskGroup`: low to medium, depending on intent.

## Performance

Only flag these when the code runs on large inputs or on a hot path.

- ORM queries inside a loop (N+1): medium, high on list endpoints. Use `select_related` / `prefetch_related` in Django, or `selectinload` / `joinedload` in SQLAlchemy.
- `x in some_list` inside a loop over large data: medium. Use a `set` or `dict`.
- Loading a whole file or query result into memory when it could be streamed or paginated: medium for unbounded data.
- `pandas` `iterrows()` or row-wise `apply` where a vectorized operation exists: medium on large frames.
- String building with `+=` in a long loop: low. Use `"".join(...)`.
- Compiling the same regex inside a tight loop: low.
- `list(...)` around a generator that is only iterated once: low.

## Structure and Idioms

Keep these short in reports; they are low or info unless they cause a bug.

- `from module import *`: medium (maintainability). It hides where names come from and can shadow other imports.
- Work done at import time (network calls, DB connections, reading files): medium. It slows startup and breaks tests.
- A script without `if __name__ == "__main__":` that other modules import: medium.
- Module-level mutable state changed from inside functions: medium (maintainability).
- `for i in range(len(xs))` where direct iteration, `enumerate`, or `zip` works: low.
- A class that only holds data with a hand-written `__init__`, `__repr__`, and `__eq__`: info, suggest `@dataclass`.
- `os.path` string handling where `pathlib.Path` is clearer: info.
- `%` or `.format()` in new code when the rest of the project uses f-strings: low (style).

## Type Hints

- Public functions with no hints in a codebase that otherwise uses them: low.
- An `Optional[X]` (or `X | None`) parameter used without a `None` check: medium (bug-risk).
- `Any` on values that cross module boundaries: low.
- `List[int]` vs `list[int]`: don't flag unless the project has a rule.

## What Not to Flag

- Anything the project's formatter or linter config already enforces.
- Idiom preferences in code the PR didn't change.
- Missing type hints in a codebase that doesn't use them.

## Output:
For each finding provide:
1. `line` - the line in the file where the problem is
2. `severity` - critical, high, medium, low, or info, using the guide above
3. `category` - security, performance, maintainability, style, bug-risk, or best-practice
4. `description` - what is wrong and when it breaks
5. `suggestion` - the fix, with a short code snippet when it helps

The test-coverage and refactoring agents use the same checklist to decide which paths need tests and which code is worth refactoring, and report in their own schemas.
