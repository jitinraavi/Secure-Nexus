# Gmail delivery for Groundwork login codes

Groundwork needs an outgoing email account to send codes. A visitor using a Gmail address does not configure a sender automatically. Login email is sent to the registered account's email address, including when the visitor enters their username.

## Configure privately

1. Sign in to the Google account that will **send** Groundwork email. Enable Google 2-Step Verification if needed, then create an app password at [Google App Passwords](https://myaccount.google.com/apppasswords). Google requires an app password for this SMTP setup; do not use the ordinary Google password. Google may restrict app passwords for some managed accounts or security configurations. See [Google's app-password guidance](https://support.google.com/mail/answer/185833).
2. In a local terminal, open the Groundwork repository and run:

   ```sh
   npm run mail:setup
   ```

3. Enter the full sender address and its 16-character Google app password. Password input is hidden. The command checks Gmail authentication before saving settings to the ignored `server/.env`. It preserves the existing encryption key and other settings. Do not put the app password in chat, source code or command arguments.
4. Restart the API (`npm run dev -w server` for development, or restart the production service). Mail configuration is read at startup.
5. Open **Sign in → Email code**, request a new code and check the registered mailbox, including Spam. A connection test proves authentication; only a real code request verifies inbox delivery.

For production, supply these variables through your host's secret store instead of copying a local environment file. The server never exposes the SMTP app password or login codes in production API responses.

## Settings

```dotenv
MAIL_PROVIDER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=your-google-sender@gmail.com
MAIL_PASS=YOUR_GOOGLE_APP_PASSWORD
MAIL_FROM="Groundwork <your-google-sender@gmail.com>"
```

Port 587 with `MAIL_SECURE=false` uses STARTTLS instead. Keep certificate verification enabled. Gmail setup uses the authenticated account as sender unless you deliberately configure an authorised sender alias. [Google SMTP settings](https://developers.google.com/workspace/gmail/imap/imap-smtp), [Nodemailer SMTP transport](https://nodemailer.com/smtp).

Run `npm run mail:verify` to verify the saved Gmail configuration without sending a message. If authentication fails, confirm that the app password belongs to the configured sender and has not been revoked after a Google account password change. If the connection times out, check whether your hosting provider blocks outbound SMTP; use a supported email API provider when required. Never disable TLS verification to work around a connection failure.

A failed delivery must remain a failure in the UI. It must not tell the visitor that a code was emailed, and a failed dispatch must not leave an unusable login challenge active. Development code display is a separate explicit loopback-only testing option; it is not Gmail delivery and stays disabled in production.
