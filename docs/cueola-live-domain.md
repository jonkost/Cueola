# cueola.live Domain Rollout

Cueola is served as a static GitHub Pages site from the `jonkost/Cueola`
repository. The custom domain should be `cueola.live`, with `www.cueola.live`
redirecting to it.

## GitHub Pages

1. In GitHub, open `jonkost/Cueola`.
2. Go to Settings > Pages.
3. Confirm the publishing source is `main` from `/root`.
4. Set Custom domain to `cueola.live`.
5. Keep the root-level `CNAME` file containing `cueola.live`.
6. Wait for GitHub to finish the DNS check.
7. Enable Enforce HTTPS when GitHub makes it available.

## Registrar DNS

Remove the old Squarespace records first:

- Any `A` records for `@` pointing at `198.49.23.144`, `198.49.23.145`,
  `198.185.159.144`, or `198.185.159.145`.
- Any `CNAME` record for `www` pointing at `ext-sq.squarespace.com`.

Then add these GitHub Pages records:

| Type | Host/Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `jonkost.github.io` |

Registrar notes:

- Some registrars use `@` for the apex/root domain; others want `cueola.live`.
- Do not add a `CNAME` at `@` if the registrar already has `A`/`AAAA` records
  there.
- Do not include the repository name in the `www` target; use
  `jonkost.github.io`, not `jonkost.github.io/Cueola`.
- DNS can propagate quickly, but GitHub says changes can take up to 24 hours.

## App Check

Before enabling Firestore App Check enforcement:

1. Create or update the reCAPTCHA v3 site key in Firebase App Check.
2. Add both `cueola.live` and `www.cueola.live` to the allowed domains.
3. Paste the public site key into `APP_CHECK_RECAPTCHA_V3_SITE_KEY` in
   `index.html` and `dashboard.html`.
4. Deploy with enforcement still off.
5. Confirm hosted requests show as verified, then enable Firestore enforcement.

## Verify

Check these after DNS and SSL are connected:

- `https://cueola.live/`
- `https://cueola.live/dashboard`
- `https://cueola.live/?code=TEST`
- `https://www.cueola.live/` redirects or serves as expected

For a local static preview:

```bash
python3 -m http.server 8010
```

Then open `http://localhost:8010/index.html`.
