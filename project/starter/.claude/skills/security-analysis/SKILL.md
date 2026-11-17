---
name: security-analysis
description: Finds security vulnerabilities in JavaScript, TypeScript, and Python code, using the OWASP Top 10 as a checklist and rating each finding by how exploitable it is. Use on every file in a review.
---

# Security Analysis

Run this on every file, whatever the language. The job is to find places where data an attacker controls reaches something dangerous, and places where a security control is missing or weak. Rate a finding by how easy it is to exploit and what an attacker gets out of it, not by how bad the code looks.

## How to Judge a Finding

1. Find the source. Request bodies, query strings, route params, headers, cookies, uploaded files, webhook and queue payloads, and database fields that users wrote are untrusted. Constants, server config, and values the server generated are not.
2. Find the sink: a query, a shell, a template or the DOM, a file path, an outbound URL, a deserializer, a redirect.
3. Check what sits between them. Parameterization, an allow-list, schema validation, or framework escaping usually closes the hole. A deny-list or a home-made regex "sanitizer" usually doesn't.
4. If the source is outside the diff (the value comes from a caller you can't see), still flag it, drop one severity level, and say what you're assuming.

## Severity Guide

| Severity | Use when |
|----------|----------|
| critical | Anyone, or any logged-in user, can run code, read or change other users' data, or get in without credentials: injection into SQL, shell, or eval from request input; missing auth on a sensitive endpoint; live secrets in the repo; deserializing untrusted data |
| high | Exploitable with some setup or limited reach: XSS, SSRF, path traversal, weak password hashing, JWTs accepted without proper verification, TLS verification turned off, guessable tokens |
| medium | Makes an attack easier or the damage worse: no rate limit on login or reset, stack traces or SQL errors sent to clients, missing CSRF protection on cookie-authenticated forms, ReDoS-prone regex on input |
| low | Defense in depth: missing security headers, personal data in logs, cookies without `Secure` or `SameSite`, outdated dependency with no known exploitable path |
| info | Hardening ideas where nothing is currently weak |

Use category `security` for everything this skill finds. Use `best-practice` only for info-level hardening notes.

## OWASP Top 10 (2021)

### A01 Broken Access Control
For every new route or handler, ask who can call it and whether it checks that the caller owns the record it touches.

```ts
// Bad - any logged-in user can read any invoice by changing the id
app.get('/invoices/:id', requireLogin, async (req, res) => {
  res.json(await db.invoice.findUnique({ where: { id: req.params.id } }));
});

// Good
app.get('/invoices/:id', requireLogin, async (req, res) => {
  const invoice = await db.invoice.findFirst({
    where: { id: req.params.id, ownerId: req.user.id },
  });
  if (!invoice) return res.sendStatus(404);
  res.json(invoice);
});
```

- Missing ownership check (IDOR) or missing role check on admin actions: critical.
- Authorization only in the frontend (hidden button, disabled field) and not repeated in the API: critical.
- Role or user id read from the request body instead of the session: critical.
- Open redirect such as `res.redirect(req.query.next)`: medium. Require a relative path or check an allow-list.
- Python `assert user.is_admin` used as an access check: high. Asserts are removed under `python -O`.

### A02 Cryptographic Failures
- Passwords hashed with MD5, SHA-1, plain SHA-256, or without a salt: high. Use bcrypt, scrypt, or argon2.
- `Math.random()` or Python's `random` for session ids, reset codes, API keys, or any value that must be unguessable: high. Use `crypto.randomBytes`, `crypto.randomUUID`, or `secrets`.
- Hardcoded keys, IVs, or salts; ECB mode; IVs reused with AES-GCM: high.
- Secrets or HMACs compared with `===` or `==`: medium. Use `crypto.timingSafeEqual` or `hmac.compare_digest`.
- Sensitive data over plain `http://`, or stored in plaintext (tokens in `localStorage`, card numbers in a DB column): high.

```python
# Bad
token = ''.join(random.choice(string.ascii_letters) for _ in range(32))

# Good
token = secrets.token_urlsafe(32)
```

### A03 Injection
Covers SQL, NoSQL, OS commands, dynamic code, and HTML (XSS).

```js
// Bad
db.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);
exec(`convert ${req.file.path} out.png`);

// Good
db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);
execFile('convert', [req.file.path, 'out.png']);
```

```python
# Bad
cur.execute(f"SELECT * FROM users WHERE email = '{email}'")
subprocess.run(f"ping -c 1 {host}", shell=True)

# Good
cur.execute("SELECT * FROM users WHERE email = %s", (email,))
subprocess.run(["ping", "-c", "1", host])
```

- SQL built with string concatenation or interpolation, including raw ORM calls (`sequelize.query`, `knex.raw`, `Model.objects.raw`, SQLAlchemy `text()` with an f-string): critical with request input.
- Mongo filters built straight from the body, where `{ "$ne": null }` can be sent in place of a value: high. Validate types first.
- `exec`, `execSync`, `spawn` with `shell: true`, `os.system`, or `subprocess` with `shell=True` on input: critical.
- `eval`, `new Function`, `setTimeout` with a string, `vm.runInContext`, Python `eval` or `exec` on input: critical.
- XSS through `innerHTML`, `outerHTML`, `document.write`, `dangerouslySetInnerHTML`, `v-html`, Jinja `|safe`, `mark_safe`, or `autoescape=False` with user content: high.
- User input placed in response headers such as `Location` or `Set-Cookie` without encoding: medium.

### A04 Insecure Design
Flaws that no single line fixes. Look for:
- Prices, quantities, or discounts sent from the client and trusted by the server: critical.
- Multi-step flows where a later step doesn't confirm the earlier one finished (jumping straight to "confirm payment"): high.
- No limit on actions that cost money or reach other people (SMS, email, payouts): medium.
- Signup or reset flows that reveal whether an account exists: low to medium.

### A05 Security Misconfiguration
- Debug mode in shipped code: `app.run(debug=True)`, `DEBUG = True` in Django settings, Express error handlers that return `err.stack`: high.
- CORS with `credentials: true` and an origin that is `*` or copied from the request without checking: high.
- Default or example credentials left in config: critical.
- Session cookies without `HttpOnly`: medium. Without `Secure` or `SameSite`: low.
- A new HTTP server without security headers (`helmet` or equivalent): low.
- XML parsers that resolve external entities on untrusted input (`libxmljs` with `noent: true`, `lxml` with `resolve_entities=True`): high. In Python, `defusedxml` is the safe choice for untrusted XML.

### A06 Vulnerable and Outdated Components
- New entries in `package.json`, `requirements.txt`, or `pyproject.toml`: check the name is spelled right (typosquatting), the package looks maintained, and the version isn't one you know to be vulnerable.
- Production dependencies pinned to `*` or `latest`, or a dependency change without a lock file update: low.
- A dependency downgraded without explanation: medium.

Only name a specific CVE if you are sure of it. Otherwise suggest running `npm audit` or `pip-audit`.

### A07 Identification and Authentication Failures
- JWT read with `jwt.decode` instead of `jwt.verify`, algorithms not pinned, `none` accepted, or no expiry: high, critical if it is the only auth check.
- Session id not rotated after login, or logout that leaves the server-side session valid: medium.
- No rate limiting or lockout on login, OTP, or password reset: medium.
- Tokens or credentials in URLs, where they end up in logs and `Referer` headers: medium.
- Password rules that cap length or strip characters: low.

```ts
// Bad - decode does not check the signature
const payload = jwt.decode(token) as { userId: string };

// Good
const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
```

### A08 Software and Data Integrity Failures
- `pickle.loads`, `yaml.load` without `SafeLoader`, `marshal`, `shelve`, or `node-serialize` on data from users, caches, or queues: critical.
- Deep merges or `obj[key] = value` with keys from input, allowing `__proto__` or `constructor` (prototype pollution): high. Reject those keys, or use `Map` or `Object.create(null)`.
- Webhooks accepted without verifying their signature: high.
- Third-party scripts loaded without `integrity`, or `curl | sh` in CI or Dockerfiles: medium.

```js
// Bad - path "__proto__.isAdmin" sets isAdmin on every object
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys.at(-1)] = value;
}
setPath(settings, req.body.path, req.body.value);
```

### A09 Security Logging and Monitoring Failures
- Passwords, tokens, session cookies, or full card numbers written to logs: high. Other personal data in logs: low.
- `catch {}` or `except: pass` in auth or payment code, so failures leave no trace: medium.
- A new auth flow that logs nothing on failed logins, denied access, or admin actions: low.
- User input logged without stripping newlines (log forging): low.

### A10 Server-Side Request Forgery (SSRF)
Any outbound request whose URL or host comes from the user.

```python
# Bad
requests.get(request.args["url"])

# Good
url = urlparse(request.args["url"])
if url.scheme != "https" or url.hostname not in ALLOWED_HOSTS:
    abort(400)
requests.get(url.geturl(), allow_redirects=False, timeout=5)
```

- Fetching a user-supplied URL with no allow-list: high. Critical if the service can reach a cloud metadata endpoint or internal admin APIs.
- Blocking only `localhost` and `127.0.0.1` is not enough. Redirects, DNS rebinding, IPv6, and decimal IP forms get around it.

## Other Checks

### Secrets
- API keys, private keys, passwords, or connection strings with credentials in source, tests, Dockerfiles, or CI config: critical if they look real, info if they are obvious placeholders in a fixture.
- A committed `.env` file: critical.
- Server secrets exposed to the browser through public build-time env prefixes (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`): critical.

### Files and Paths
- A path built from input without resolving it and checking it stays inside a base directory (`path.join(UPLOAD_DIR, req.params.name)`, `open(os.path.join(base, name))`): high.
- Uploads with no size limit, no type check, or saved under the client's filename: medium.
- Python `tempfile.mktemp`: low. Use `mkstemp` or `NamedTemporaryFile`.

### Denial of Service
- Regex with nested quantifiers such as `(a+)+` or `(.*,)*` run on input: medium.
- No cap on request body size, page size, or loop counts driven by input: medium.

## What Not to Flag

- Parameterized queries, ORM filters built from objects, and auto-escaped template output. These are already safe.
- `eval`-like calls on constant strings in build scripts or tests.
- Fake credentials in test fixtures.
- Issues with no path from untrusted input. If you aren't sure, say so in the description rather than raising the severity.

## Output:
For each finding provide:
1. `line` - where untrusted data reaches the sink, or where the missing check belongs
2. `severity` - critical, high, medium, low, or info, using the guide above
3. `category` - `security` (or `best-practice` for info-level hardening notes)
4. `description` - the source, the sink, and what an attacker can do with it
5. `suggestion` - the fix, with a short code snippet

The test-coverage and refactoring agents use the same checklist to decide which security paths need tests and which code is worth refactoring, and report in their own schemas.
