# Security Policy

## Supported Versions

Security updates are provided for the following releases:

| Version | Supported          |
| ------- | ------------------ |
| 1.5.x   | :white_check_mark: |
| < 1.5.0 | :x:                |

---

## Reporting a Vulnerability

The `memory-context` project takes security seriously. If you discover a security vulnerability or vulnerability pattern (such as path traversal, sanitization bypass, or denial-of-service risks in context buffers):

1. **Do not create a public GitHub issue.**
2. Report the issue privately by emailing the maintainers or opening a private GitHub Security Advisory on the repository.
3. Include:
   - Description of the vulnerability and its potential impact.
   - Minimal steps or proof-of-concept to reproduce the behavior.
   - Recommended mitigations or patches if available.

### Response Timeline

- **Initial Response**: Within 48 hours of receipt.
- **Triage & Status Update**: Within 5 business days.
- **Fix & Advisory Release**: Coordinated with the reporter following testing and validation.

---

## Guidelines for Safe Operation

- **Local Storage**: The plugin stores session memory in local SQLite files (`sql.js`). Ensure file system permissions on the data directory restrict unauthorized access.
- **No Embedded Credentials**: Never commit API keys or production environment variables to version control. Use `.env.example` as a template for local variables.
