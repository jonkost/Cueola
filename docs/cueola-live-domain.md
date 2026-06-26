# cueola.live Domain Rollout

Cueola is ready to be served by Firebase Hosting on `cueola.live` after the
domain is connected in Firebase Console and DNS is pointed at the Firebase
records.

## Firebase Hosting

1. In Firebase Console, open the `cueola` project.
2. Go to Hosting > Add custom domain.
3. Add `cueola.live`.
4. Add `www.cueola.live` as a second custom domain if the registrar should also
   support `www`.
5. Copy the TXT verification record into the domain registrar.
6. After verification, copy the Firebase A/AAAA/CNAME records into the registrar.
7. Wait for Firebase to issue the managed SSL certificate before sending traffic.

## App Check

Before enabling Firestore App Check enforcement:

1. Create or update the reCAPTCHA v3 site key in Firebase App Check.
2. Add both `cueola.live` and `www.cueola.live` to the allowed domains.
3. Paste the public site key into `APP_CHECK_RECAPTCHA_V3_SITE_KEY` in
   `index.html` and `dashboard.html`.
4. Deploy with enforcement still off.
5. Confirm hosted requests show as verified, then enable Firestore enforcement.

## Local Check

Run this before deploy:

```bash
firebase emulators:start --only hosting
```

or, for a quick static check:

```bash
python3 -m http.server 8010
```

Then open `http://localhost:8010/index.html`.
