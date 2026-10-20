# Supabase database certificate

`supabase-root-2021.crt` is the public Supabase Root 2021 CA, downloaded from
the certificate link in the project's Database Settings on 20 October 2026:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Certificate SHA-256 fingerprint:

```
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

The certificate expires on 26 April 2031. This is a public CA certificate,
not a private key. Hosted PostgreSQL verifies the server certificate and hostname.
If Supabase rotates its CA, obtain its replacement through the dashboard and
configure `DATABASE_SSL_CA_FILE` or update this bundled certificate after verification.
