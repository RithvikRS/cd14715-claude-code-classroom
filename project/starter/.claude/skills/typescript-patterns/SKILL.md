---
name: typescript-patterns
description: Reviews TypeScript (.ts, .tsx) code for type safety holes, unsafe casts, async mistakes, and type design problems, with severity guidance for each finding.
---

# TypeScript Patterns Review

Use this for `.ts` and `.tsx` files. The JavaScript rules still apply; this skill covers what the type system adds and the ways people work around it. Most TypeScript problems in a PR are places where the types claim something the runtime doesn't guarantee.

## Severity Guide

| Severity | Use when |
|----------|----------|
| critical | A type hole lets untrusted input reach a security-sensitive call (SQL, shell, auth check) without validation |
| high | The types lie in a way that will throw at runtime on a realistic path: unchecked cast of external data, `!` on a value that can be missing, a floating promise in a request handler |
| medium | Type safety is weakened but nothing is broken yet: `any` in an exported signature, `@ts-ignore` with no reason, a non-exhaustive switch over a union |
| low | Types are correct but looser or noisier than they need to be: `Function` or `{}` as a type, numeric enums, missing `readonly` on shared constants |
| info | Optional improvements: `satisfies`, clearer generic names |

Categories: type holes that can crash are `bug-risk`; type holes on input that reaches a sensitive call are `security`; weak or duplicated types are `maintainability`; idiomatic TS choices are `best-practice`; naming and formatting are `style`.

## Escape Hatches

### `any`
`any` turns off checking for everything it touches and spreads to callers.

```ts
// Bad
function getUserId(body: any) {
  return body.user.id;
}

// Good
function getUserId(body: unknown): string {
  return UserBody.parse(body).user.id;
}
```

- `any` in an exported function, type, or class member: medium (maintainability).
- `any` on data from the network, files, or `JSON.parse`, then used without checks: high (bug-risk).
- `catch (e: any)` followed by `e.message`: low. Use `unknown` and narrow with `instanceof Error`.
- Implicit `any` from untyped parameters means `noImplicitAny` is off. Mention it once per file, not on every line.

### Type assertions (`as`)
An assertion is a promise the compiler can't check. Flag it when the value comes from outside the program.

```ts
// Bad - nothing checks the response shape
const user = (await res.json()) as User;

// Good
const user = UserSchema.parse(await res.json());
```

- `as` on external data: high (bug-risk).
- Double assertion `as unknown as T`: high, unless a comment explains why it's safe.
- `as` used to silence an error between two internal types: medium. Usually one of the types is wrong.
- `as const`: fine, don't flag.

### Non-null assertion (`!`)

```ts
// Bad
const item = items.find((i) => i.id === id)!;

// Good
const item = items.find((i) => i.id === id);
if (!item) throw new NotFoundError(id);
```

`!` on `.find()`, `Map.get()`, an array index, `getElementById`, or `process.env.X`: high when the value can realistically be missing, medium otherwise.

### Suppression comments
- `@ts-ignore` with no explanation: medium. Prefer `@ts-expect-error` with a reason; it fails once the error goes away, so it doesn't rot.
- New `eslint-disable` for `no-explicit-any` or the `no-unsafe-*` rules: treat it the same as the `any` it hides.

## Unions and Narrowing

### Exhaustiveness
A switch over a union with no `never` check silently ignores members added later.

```ts
// Bad
function label(s: Status): string {
  switch (s) {
    case 'open': return 'Open';
    case 'closed': return 'Closed';
  }
  return '';
}

// Good
function label(s: Status): string {
  switch (s) {
    case 'open': return 'Open';
    case 'closed': return 'Closed';
    default: {
      const unhandled: never = s;
      throw new Error(`Unknown status: ${unhandled}`);
    }
  }
}
```

Medium (bug-risk) if the PR changes the union, low otherwise.

### Optional fields that only make sense together
Several optional fields that are only valid in certain combinations allow impossible states.

```ts
// Bad
interface Result { ok: boolean; data?: User; error?: string }

// Good
type Result = { ok: true; data: User } | { ok: false; error: string };
```

Medium (maintainability) when callers already check combinations of the optional fields.

### Type guards that don't check enough
A guard (`x is Foo`) that checks less than it claims is an `as` in disguise. High if it guards external data.

```ts
// Bad - only checks that `id` exists
function isUser(x: unknown): x is User {
  return typeof x === 'object' && x !== null && 'id' in x;
}
```

## Async and Promises

- Floating promise (async call with no `await`, `.catch`, or explicit `void`): high in request handlers and anywhere the work must finish before returning; medium elsewhere.
- `async` callback passed to `forEach`: high. Nothing waits for it. Use `for...of` or `Promise.all`.
- Async predicate passed to `filter`, `some`, or `every`: high. A promise is always truthy, so every item passes.
- `Promise<any>` return types or untyped `fetch` wrappers: medium.

```ts
// Bad
const active = users.filter(async (u) => await isActive(u));

// Good
const flags = await Promise.all(users.map(isActive));
const active = users.filter((_, i) => flags[i]);
```

## Type Design

- An interface that copies another type by hand instead of using `Pick`, `Omit`, `Partial`, or `z.infer` from an existing schema: medium (maintainability) if the copies have already drifted, low otherwise.
- `Function`, `Object`, or `{}` used as a type: low (best-practice). Write the real signature or use `Record<string, unknown>`.
- Numeric `enum` in new code: low. Numbers are assignable to it and reverse mappings surprise people; a string union or an `as const` object is simpler. Don't flag existing enums the PR doesn't touch.
- `null` and `undefined` both used to mean "missing" in the same API: low.
- Exported arrays or objects meant as constants but left mutable: low. Suggest `readonly` or `as const`.
- Deeply nested conditional or mapped types for a function with two call sites: low (maintainability).
- An annotation that widens a literal type when `satisfies` would keep it: info (best-practice).

```ts
// Keys widen to string, so routes.hme compiles
const routes: Record<string, string> = { home: '/', about: '/about' };

// Keys stay literal and values are still checked
const routes = { home: '/', about: '/about' } satisfies Record<string, string>;
```

## Indexing and Compiler Settings

- Using `arr[i]` or `record[key]` as if it were always defined, with a key that comes from input: medium (bug-risk). `noUncheckedIndexedAccess` catches this; without it, the reviewer has to.
- A PR that turns off `strict`, `strictNullChecks`, or `noImplicitAny` in `tsconfig.json`: high (maintainability). It hides whole classes of bugs across the project.
- `skipLibCheck` or a lowered `target` added only to get past errors: low, ask why.

## React (.tsx)

- Props typed as `any` or not typed: medium.
- `useState(null)` for a value that will later hold an object: low. The state is typed `null` and people reach for `any` to set it. Use `useState<User | null>(null)`.
- Event handlers typed as `any` instead of `React.ChangeEvent<HTMLInputElement>` and friends: low.
- `dangerouslySetInnerHTML` with non-constant content: see security-analysis.

## What Not to Flag

- Missing return types on small internal functions where inference is obvious.
- `as const`, `satisfies`, and `unknown` used correctly.
- `type` vs `interface`, unless the codebase has a rule.
- Code the PR didn't change, unless the change makes it newly reachable.

## Output:
For each finding provide:
1. `line` - the line in the file where the problem is
2. `severity` - critical, high, medium, low, or info, using the guide above
3. `category` - security, performance, maintainability, style, bug-risk, or best-practice
4. `description` - what is wrong and what can go wrong at runtime
5. `suggestion` - the fix, with a short code snippet when it helps

The test-coverage and refactoring agents use the same checklist to decide which paths need tests and which code is worth refactoring, and report in their own schemas.
