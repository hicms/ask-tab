# Automatic Chrome Web Store uploads

After setup, `./scripts/release.ps1 -Publish` creates the GitHub release and uploads the same ZIP to your existing Chrome Web Store item. The uploaded package remains a draft: **this workflow does not submit it for review or publish it to users**.

Developer registration is the first step. Paying the registration fee does not create an extension item or configure API access.

## 1. Create your extension item once

1. Download `asktab-chrome-vX.Y.Z.zip` from the [AskTab releases](https://github.com/hicms/ask-tab/releases). Use the extension ZIP, not GitHub's source-code archive.
2. Open your [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Choose **New item**, select the ZIP, and wait for the upload to finish.
4. Copy the extension's **Item ID** (32 letters) from its dashboard page.
5. Open **Publisher > Settings** and copy the **Publisher ID**. This is different from the extension ID.

Before submitting your first release for review, complete the store listing, screenshots, privacy disclosures, and any account requirements shown by Google. Creating the draft item does not publish it.

## 2. Allow a service account to upload

Follow Google's [service account setup guide](https://developer.chrome.com/docs/webstore/service-accounts):

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable **Chrome Web Store API**.
2. Under **IAM & Admin > Service Accounts**, create a service account such as `asktab-release`. Google does not require project roles for this initial setup.
3. Copy the service account email. In the Web Store Developer Dashboard's **Account** section, add it as the API service account for your publisher.
4. In Google Cloud, open that service account's **Keys** tab, select **Add key > Create new key > JSON**, and download the key.

Keep the key outside the repository. Do not paste it into chat or commit it. It grants access to your publisher's items.

## 3. Configure the GitHub repository

Open the repository's **Settings > Secrets and variables > Actions**.

On the **Secrets** tab, add:

| Name | Value |
| --- | --- |
| `CWS_SERVICE_ACCOUNT_JSON` | The complete contents of the downloaded service account JSON key |

On the **Variables** tab, add:

| Name | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Publisher ID from the Web Store settings |
| `CWS_EXTENSION_ID` | Your extension's 32-letter Item ID |
| `CWS_UPLOAD_ENABLED` | `true` — set this last, after the other values are ready |

The upload job is skipped until `CWS_UPLOAD_ENABLED` is `true`. Missing or invalid credentials fail the upload job once enabled; they are never printed by the uploader.

## 4. Release normally

```powershell
.\scripts\release.ps1 -Publish
```

The release workflow builds and publishes the GitHub assets, then downloads that exact ZIP and checksum in a separate upload job. The uploader validates the checksum and manifest version, authenticates with Google's official library, uploads through the Chrome Web Store V2 API, and waits for asynchronous processing when needed.

After the job succeeds, open the Web Store dashboard to inspect the package and submit it for review when ready. Google review is a separate step; an upload success does not mean the extension is publicly available.

## Troubleshooting

- **Upload job skipped:** check that `CWS_UPLOAD_ENABLED` is exactly `true`.
- **Authentication or HTTP 403 error:** verify that the API is enabled, the service account key is current, and the same account email is linked to the correct publisher.
- **Version rejected:** Google requires an increased extension version. The release script increments the patch version automatically.
- **Upload failed after GitHub publication:** the GitHub release remains available. Inspect the Web Store dashboard first, then use GitHub Actions' **Re-run failed jobs** if the upload was not accepted. Do not rerun the successful GitHub release creation job.
- **Processing timed out:** the server may still be processing the package. Check the dashboard before retrying; the script does not automatically resend the upload.
- **Disable automatic uploads:** set `CWS_UPLOAD_ENABLED` to `false`. Normal GitHub releases continue to work.

Official references: [Web Store API](https://developer.chrome.com/docs/webstore/using-api), [upload endpoint](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload), and [upload status](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus).
