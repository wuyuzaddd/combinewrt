# Generate a per-build self-signed HTTPS certificate

When HTTPS is enabled, the build generates a unique self-signed certificate and key for that image, with the configured hostname as the common name. This makes the default HTTPS option usable without an external CA and avoids shipping one shared private key across every image.

## Consequences

- The certificate and key are generated inside the build workflow and written only into the image's files; they are never logged or included in the source offer.
- Browsers will still warn about the self-signed certificate until the operator replaces it or configures a trusted certificate.
- Rebuilding an image creates a new key pair, so replacing a running image also replaces its certificate.
- A later user-supplied certificate flow must keep the private key out of plans, logs and source offers.
