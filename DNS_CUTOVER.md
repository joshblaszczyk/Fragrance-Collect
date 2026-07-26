# Hybrid Hosting Runbook (No DNS Cutover)

This file replaces the abandoned Cloudflare nameserver-cutover plan. Its historical filename is retained so existing repository links do not break.

Fragrance Collect uses this production layout:

| Service | Production location |
| --- | --- |
| Frontend | GitHub Pages at `https://fragrancecollect.com` |
| API | Cloudflare Worker at `https://weathered-mud-6ed5.joshuablaszczyk.workers.dev` |
| Database | Cloudflare D1 bound to the Worker |
| Mailboxes | Namecheap Private Email |
| Transactional sending | Resend through the Worker |

Do **not** change the registrar nameservers, move the zone to Cloudflare, remove the GitHub Pages records, or attach `fragrancecollect.com` as a Worker Custom Domain. The frontend calls the Worker directly through its `workers.dev` URL.

In **GitHub → Settings → Pages**, keep **Build and deployment** on **Deploy from a branch**, branch **`main`**, folder **`/(root)`**. The old `gh-pages` branch is not the production source.

## DNS records to retain

Namecheap remains authoritative. Keep these web records:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `awdiawdoiawjdioajw.github.io` |

Keep the repository `CNAME` file set to `fragrancecollect.com`. Also retain every existing Namecheap Private Email record, including the two apex MX records, mailbox/autodiscovery CNAME and SRV records, DMARC, and any provider verification records. Mail records are unrelated to the Worker API host.

If a Cloudflare zone was started only for the abandoned cutover, do not proceed to nameserver activation. An inactive copy of the zone does not control production DNS.

## Google sign-in setup

The Google button is rendered on GitHub Pages, so Google must authorize the **frontend origin**, not the Worker URL.

1. Open [Google Auth Platform — Clients](https://console.cloud.google.com/auth/clients) and select the Google Cloud project used by Fragrance Collect.
2. Open the Web application OAuth client whose client ID is:

   ```text
   351083759622-fnmbu0am1knlj8ltcps8i7la64dhjpnn.apps.googleusercontent.com
   ```

3. Under **Authorized JavaScript origins**, add exactly:

   ```text
   https://fragrancecollect.com
   ```

4. Do not add a path, a trailing page name, query parameters, or the Worker URL. `https://fragrancecollect.com/auth.html` is not a valid origin entry.
5. Do not add this value under **Authorized redirect URIs**. The current Google Identity Services popup flow returns its credential to JavaScript and does not use a redirect endpoint.
6. Add `https://www.fragrancecollect.com` only if the Google button is actually rendered there before redirecting to the apex. The intended canonical login page uses the apex origin.
7. Save. Google configuration can take several minutes—and occasionally longer—to propagate.
8. Open **Google Auth Platform → Audience**. If the app is still in **Testing**, add `joshuablaszczyk@gmail.com` as a test user. Before publishing externally, confirm the branding page has the production homepage, privacy-policy, and terms links and complete any verification Google requires.
9. Open a private browser window, visit `https://fragrancecollect.com/auth.html`, and try Google sign-in. Confirm the `origin_mismatch` page no longer appears, reload the page, and confirm the same account remains signed in.

Changing DNS, authorizing the Worker origin, or adding a redirect URI will not fix a JavaScript-origin mismatch on the GitHub Pages login page.

Google references: [create a web client and configure origins](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and [manage OAuth clients](https://support.google.com/cloud/answer/15549257?hl=en).

## Resend sending-domain setup

Resend sends transactional messages; it does not replace the Namecheap inboxes. Keep the root Namecheap MX records so `info@fragrancecollect.com` and `support@fragrancecollect.com` continue receiving mail.

1. Open [Resend Domains](https://resend.com/domains), select `fragrancecollect.com`, and open its DNS record list.
2. Copy the exact records shown by Resend. The expected record purposes are:

   - DKIM TXT with host `resend._domainkey`.
   - SPF TXT with host `send` and value `v=spf1 include:amazonses.com ~all`.
   - A sending MX record with host `send`.

3. In Namecheap, open **Domain List → Manage → Advanced DNS** for `fragrancecollect.com`.
4. Compare the existing `resend._domainkey` TXT value with the complete value in Resend. If it differs, replace it with the complete Resend value. Copy from the provider dashboard; do not copy a visually truncated screenshot.
5. Compare the existing `send` SPF TXT value. Keep one SPF TXT record for that host. Do not create a duplicate SPF record.
6. Under Namecheap's mail/custom MX controls, add Resend's sending MX exactly as its dashboard shows:

   - Type: `MX`
   - Host: `send`
   - Value/target: copy Resend's exact target
   - Priority: copy Resend's exact priority
   - TTL: `Automatic`

   Enter `send`, not `send.fragrancecollect.com`, because Namecheap appends the zone name. Resend's target can be region-specific, so do not guess it from an example.
7. Preserve the two inbound Namecheap records at the zone apex:

   ```text
   @  MX  10  mx1.privateemail.com
   @  MX  10  mx2.privateemail.com
   ```

8. Do not enable Resend Receiving and do not add a Resend receiving MX at `@`. Namecheap Private Email remains responsible for inbound mail.
9. Save the Namecheap changes. Return to Resend and choose **Verify** or **Restart verification** for the domain.
10. DNS verification often completes quickly but can take up to 72 hours. If it remains pending, compare the host, type, full value, and priority in Namecheap against the current Resend dashboard one field at a time.

After the domain shows **Verified**:

1. Open **Resend → API Keys**. Reuse the existing Fragrance Collect sending key if it is active; otherwise create a sending-only key scoped as narrowly as the dashboard permits. Copy a newly created value once and do not place it in DNS, Git, GitHub Pages, frontend JavaScript, screenshots, or chat.
2. In **Cloudflare → Workers & Pages → weathered-mud-6ed5 → Settings → Variables and Secrets**, confirm a secret named exactly `RESEND_API_KEY` exists. Add or replace it only through the protected Cloudflare secret control. The value must be marked encrypted/secret, never plaintext.
3. Keep `RESEND_FROM` as the non-secret Worker variable `Fragrance Collect <support@fragrancecollect.com>` unless the reviewed application configuration intentionally changes the sender. A verified domain can send from its addresses without putting the mailbox password in the Worker.
4. Run the repository's name-only Worker binding check, then send one password-reset message and one contact-form message. Confirm delivery and replies without printing the API key.

Resend references: [Namecheap setup](https://resend.com/docs/knowledge-base/namecheap), [domain records](https://resend.com/docs/dashboard/domains/introduction), and [domain verification troubleshooting](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying).

### Separate Namecheap Private Email DKIM record

The `default._domainkey` panel shown by Namecheap Private Email is unrelated to Resend's `resend._domainkey`; both records can coexist. If Namecheap still shows the mailbox DKIM record as missing, click **Copy** next to **DNS Record** (not **Public Key**) and add a Namecheap **TXT Record** with host `default._domainkey`, the complete copied `v=DKIM1;k=rsa;p=...` value, and TTL `Automatic`. Never reconstruct the key from a truncated screenshot and do not delete `resend._domainkey`.

## Worker configuration and verification

The committed Worker configuration already identifies the frontend origin and sending address:

```text
ALLOWED_ORIGIN=https://fragrancecollect.com
PUBLIC_SITE_URL=https://fragrancecollect.com
RESEND_FROM=Fragrance Collect <support@fragrancecollect.com>
```

`GOOGLE_CLIENT_ID` is a public client identifier and remains a non-secret Worker variable. `RESEND_API_KEY` must remain a Cloudflare Worker secret; never put it in Git, frontend JavaScript, GitHub Pages settings, or a DNS record. Provision or rotate that secret only through the controlled operator procedure, then run the repository's binding-name preflight.

After Google and Resend report ready and the reviewed Worker release is deployed:

1. Load `https://fragrancecollect.com/auth.html` in a private window and complete Google sign-in.
2. Reload the auth/account page and confirm the same account remains signed in. Save and remove one favorite, save and remove one watch, download account data, then sign out. Treat any secure-cookie compatibility message as a failed release check.
3. Request one password-reset email and confirm the message arrives without exposing whether an arbitrary address has an account.
4. Submit one contact message and confirm it reaches the configured support mailbox.
5. Inspect the browser network panel and confirm account API calls go to `https://weathered-mud-6ed5.joshuablaszczyk.workers.dev`, return the exact `Access-Control-Allow-Origin: https://fragrancecollect.com`, and allow credentials.
6. Confirm the four GitHub Pages apex A records, the `www` CNAME, and the Namecheap root MX records remain unchanged.

No step in this runbook requires a Cloudflare zone activation, nameserver change, DNSSEC transition, or Worker custom domain.
