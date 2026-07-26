# Fragrance Collect DNS Cutover Runbook

This runbook records the public production DNS state observed on July 26, 2026 and the no-downtime sequence for moving `fragrancecollect.com` from GitHub Pages to the integrated Cloudflare Worker.

## Current authority and rollback target

- Registrar/DNS provider: Namecheap BasicDNS
- Authoritative nameservers: `dns1.registrar-servers.com`, `dns2.registrar-servers.com`
- Parent delegation cache: up to 48 hours
- Active parent DS: key tag `7393`, algorithm `13`, digest type `1`, digest `6052EFBB4C75DEA611B92DC35F9714AF7C9705F5`
- Parent DS TTL: 24 hours
- Current web origin: GitHub Pages

Keep the Namecheap zone unchanged and available for at least 48 hours after changing nameservers. During that mixed-cache period, the old and new zones must both serve a working site and identical mail records.

## Minimum observed records that must be reproduced in Cloudflare

Public DNS cannot prove that every private verification or service record has been discovered. Export the complete Namecheap zone in the dashboard and compare that export with this observed minimum before changing DNSSEC or nameservers.

Mail-related records must remain DNS-only. Do not proxy them.

| Type | Name | Priority | Value |
| --- | --- | ---: | --- |
| MX | `@` | 10 | `mx1.privateemail.com` |
| MX | `@` | 10 | `mx2.privateemail.com` |
| TXT | `_dmarc` | — | `v=DMARC1; p=none;` |
| TXT | `resend._domainkey` | — | Use the complete public RSA key recorded below. |
| TXT | `send` | — | `v=spf1 include:amazonses.com ~all` |
| SRV | `_autodiscover._tcp` | 0 | Weight `0`, port `443`, target `privateemail.com` |
| CNAME | `autoconfig` | — | `privateemail.com` |
| CNAME | `autodiscover` | — | `privateemail.com` |
| CNAME | `mail` | — | `privateemail.com` |

The exact current Resend DKIM TXT value is:

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDuHheTgfVBZAz498FyNWSvOyyzFRibEnFfXsgsD4kGZeRLnqPUVSC8I4oHzryTqvEATR91uzRf0cWVP1w/nKRQ/hSqJe3J7F3zHQUWOKclNlfGKPsn1JcdyTr3L5i6K9B2rZKbwf6pGrxy0A7ry3muJFMQ07fP7IwZr8VongYg/QIDAQAB
```

The current public zone has no apex SPF TXT, no published Private Email DKIM selector, and no MX record at `send.fragrancecollect.com`. Confirm the intended Private Email configuration and copy Resend's exact generated SPF/MX/DKIM records from its dashboard before cutover. Add the corrected records to both the still-live Namecheap zone and the pending Cloudflare zone before delegation so mail remains consistent during mixed resolver caching. Do not guess a DKIM selector, Resend region, or MX target.

The Worker health flag only confirms that its email configuration is bound; it does not prove Resend domain verification or delivery. Confirm that `info@fragrancecollect.com` and `support@fragrancecollect.com` are real Namecheap mailboxes or aliases, then perform controlled inbound and outbound delivery tests.

These web records are the rollback origin and should initially be copied into Cloudflare:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `awdiawdoiawjdioajw.github.io` |

Do not import the old provider's NS, SOA, DNSKEY, NSEC, RRSIG, or DS records into Cloudflare.

## No-downtime sequence

1. Add `fragrancecollect.com` to the correct Cloudflare account, but do not change registrar nameservers yet.
2. Export the Namecheap zone, reproduce every exported record, and independently compare it with the minimum observed set above. Keep the GitHub web records active at first so both DNS providers lead to the existing site.
3. Confirm the Cloudflare zone reports the expected assigned nameservers and that Universal SSL is enabled or pending. Require an active certificate after delegation before removing the GitHub records.
4. In Google Cloud, confirm `https://fragrancecollect.com` is an authorized JavaScript origin for the configured client. The Worker redirects `www` before authentication.
5. In Namecheap, confirm both site mailboxes or aliases and copy the provider's exact apex SPF and DKIM records. In Resend, confirm the sending domain is verified and copy every generated record exactly. Put these corrections in both zones before delegation. Keep the Namecheap Private Email MX records at the apex; do not add a competing Resend receiving MX there.
6. Disable Namecheap DNSSEC/remove the old DS at the registrar. Wait at least the old 24-hour DS TTL and verify public resolvers no longer return the old DS. Never change nameservers while a stale DS remains.
7. Change the registrar nameservers to the two assigned by Cloudflare. Keep the Namecheap zone and matching Cloudflare rollback records intact for the full 48-hour parent NS cache window.
8. Wait the full observed 48-hour parent NS TTL after the registrar change and verify through multiple public resolvers that the delegation now uses Cloudflare. Require the zone to be Active and Universal SSL enabled, while confirming the apex and `www` still reach GitHub Pages over HTTPS through the copied rollback records. Do not remove those records, merge the PR, or install Cloudflare's new DS during this mixed-authority window.
9. In Cloudflare, remove only the four GitHub apex A records and the `www` GitHub CNAME. Immediately deploy the Worker configuration in this repository; its two Custom Domains create the replacement DNS records and their certificates. Wait for both Custom Domains and certificates to become active before continuing.
10. Verify the apex API/static contracts, the `www` permanent redirect, sign-in, reset email, contact email, search, favorites, export, and watches.
11. Merge the validated release PR only after the custom domain is serving correctly. This is important because GitHub Pages currently builds from `main`, and the PR intentionally removes its `CNAME`. Record the exact temporarily deployed Worker SHA/version, smoke-test it, and merge immediately afterward so production is not left ahead of `main`.
12. After the delegation is stable, enable Cloudflare DNSSEC and install Cloudflare's new DS at the registrar. Verify DNSSEC before considering the cutover complete.

## Verification

```bash
npm run api:check:production
npm run check:cloudflare-production
```

Also confirm unauthenticated account endpoints return `401`, `robots.txt` and `sitemap.xml` load, and the custom 404 responds with `404`. Send controlled password-reset and contact messages, and verify inbound and outbound mail for the configured Namecheap mailboxes.

## Rollback

The normal rollback is inside the active Cloudflare zone: remove the Worker Custom Domains, restore the four GitHub Pages apex A records and the `www` CNAME above, and verify GitHub Pages. Do not immediately revert nameservers; recursive resolvers may still be split between the old and new authorities for up to 48 hours.

## Provider references

- [Cloudflare full-zone setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Cloudflare Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Resend domain records](https://resend.com/docs/dashboard/domains/introduction)
- [Namecheap Private Email DNS verification](https://www.namecheap.com/support/knowledgebase/article.aspx/1262/2176/what-does-namecheap-private-email-dns-verification-imply/)
- [Google Identity authorized JavaScript origins](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
