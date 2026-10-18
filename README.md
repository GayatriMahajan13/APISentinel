# APISentinel

API anomaly detection using your Colab-trained XGBoost model on the CSIC 2010 HTTP dataset.

## What is here

- `models/` — trained model, feature names, and scores from Colab
- `backend/` — FastAPI app that loads the model and scores requests
- `vendor/libomp/` — OpenMP library XGBoost needs on this Mac
- `data/apisentinel.db` — local SQLite persistence for predictions and anomaly alerts

The model files were not changed.

## Run the backend

From the project folder:

```bash
chmod +x run.sh
./run.sh
```

Then open:

- http://127.0.0.1:8000
- http://127.0.0.1:8000/docs  (interactive tester)

## Run the frontend

```bash
cd frontend
npm run dev
```

Open the frontend using the same loopback hostname as the API, preferably http://127.0.0.1:5173. The frontend follows `localhost` versus `127.0.0.1` for its default API host so browser cookies remain same-site. Override the API origin with `VITE_API_BASE_URL` when needed.

## Check the backend

```bash
curl http://127.0.0.1:8000/health
```

To run predictions, register or sign in through the frontend. `POST /predict` now requires an authenticated session cookie and a valid CSRF header; it returns a `normal` or `anomalous` prediction.

Manual analysis accepts JSON request bodies up to 512 KiB, URLs up to 8,192 characters, and payloads up to 256 KiB. Oversized bodies receive HTTP 413, while URLs or payloads beyond their individual length limits receive HTTP 422. These limits apply only to `POST /predict`; monitoring ingestion retains its existing 16 KiB event limit.

## Persistent prediction history

The API stores successful `/predict` results and creates an alert only when a result is classified as anomalous. Request payloads are never stored. URLs are sanitized before persistence by removing user-info, fragments, and values for sensitive query parameters.

The default database is `data/apisentinel.db`. Set `DATABASE_URL` to select another SQLAlchemy database URL; relative SQLite file paths resolve from the project directory. The API is intended for local development and `run.sh` binds it to `127.0.0.1`.

Database-backed endpoints:

- `POST /auth/register` and `POST /auth/login`
- `GET /auth/session` restores the server-managed session and provides a CSRF token
- `POST /auth/logout`
- `GET /history?limit=50&offset=0&classification=anomalous` (authenticated)
- `GET /alerts?limit=50&offset=0` (authenticated)
- `PATCH /alerts/{alert_id}` with `review_status` and/or `analyst_notes` (authenticated, CSRF protected)
- `GET /analytics/summary` (authenticated)
- `POST /websites` (authenticated, CSRF protected)
- `GET /websites` and `GET /websites/{website_id}` (authenticated, owner-scoped)
- `PATCH /websites/{website_id}` and `DELETE /websites/{website_id}` (authenticated, owner-scoped, CSRF protected)
- `POST /websites/{website_id}/integration/credentials` (authenticated, owner-scoped, CSRF protected; plaintext shown once)
- `POST /websites/{website_id}/integration/credentials/rotate` (authenticated, owner-scoped, CSRF protected)
- `POST /websites/{website_id}/integration/credentials/revoke` (authenticated, owner-scoped, CSRF protected)
- `POST /monitoring/events` (server-to-server, authenticated using `X-APISentinel-Integration-Key`)
- `GET /monitoring/events` (authenticated, owner-scoped, bounded and paginated event metadata)

Predictions, alerts, history, and analytics are scoped to the authenticated account. Existing records are retained with a null `user_id` and are not visible to newly registered accounts; legacy records are not automatically claimed. The authentication schema migration adds nullable ownership columns without deleting prediction, alert, or investigation-note data.

Website registrations belong to the account that created them. Website removal is a soft removal: it hides the registration from active lists while retaining its database row. New websites start as `Not Connected`; registration does not verify ownership or make network requests. Connection status changes only after a valid credential-authenticated event arrives.

Website integration credentials are generated randomly, stored only as SHA-256 hashes, and returned only by create/rotate. Keep them in the monitored backend's environment and never in browser code or logs. Ingestion requires strict version-1 JSON, including a sender-generated `event_id`, is limited to 16 KiB per event, and currently allows 120 accepted events per integration per minute by default (`APISENTINEL_INGEST_RATE_LIMIT` configures the per-process limit). The validated integration credential determines the website and owner; those values cannot be selected in the event body. Event timestamps must include a timezone and are stored normalized to UTC, while the server records the ingestion time separately.

An exact retry for the same website and `event_id` returns the stored event and scoring result without rerunning inference; reusing that ID with different submitted content returns HTTP 409. A SHA-256 hash of the canonical submitted JSON is stored for this comparison. The eight numeric features are bounded and checked individually. When all eight are present and valid, ingestion uses the same loaded XGBoost model and feature ordering as the manual Request Analyzer, saves the `scored` result, and includes it in the credential-derived website owner's prediction history. An `anomalous` prediction creates the same owner-scoped alert used by manual analysis. `model_score` is the model's output confidence, not a calibrated probability that an actual attack occurred. Missing or invalid features do not reject an otherwise valid event: it is saved as `Not Scored` with a reason, and missing values are never filled with zero. If loading or inference fails, ingestion still saves the event as `Not Scored` with the failure reason. Events store only allowlisted metadata, validated safe numeric features, and an optional pseudonymous actor ID; unknown top-level fields such as request bodies and authorization data are rejected. Old monitoring events are pruned in batches of up to 500 during ingestion using a 90-day retention period by default (`APISENTINEL_EVENT_RETENTION_DAYS`). The authenticated Live Monitoring page polls `GET /monitoring/events` every 10 seconds while visible and shows only owner-scoped event metadata; it does not capture external traffic automatically or implement behavioral detection. Ingestion rate limiting is process-local and resets on restart, so use a shared limiter before deploying multiple workers or exposing the collector publicly.

Passwords are stored as salted scrypt hashes. Login submissions are limited to 5 attempts per normalized account and client IP over a rolling 5-minute window by default; configure `APISENTINEL_LOGIN_RATE_LIMIT` and `APISENTINEL_LOGIN_RATE_WINDOW_SECONDS` to change these process-local limits. Successful and failed submissions count toward the limit; throttled responses return HTTP 429 with `Retry-After`. The bounded in-memory limiter does not impose account-wide lockouts, but it resets on restart and is not shared between workers; configure a shared limiter before multi-worker or public deployment. Session identifiers are random, stored hashed server-side in SQLite, and sent only in HttpOnly cookies. Browser state keeps the CSRF token in memory, not localStorage or sessionStorage. Cookies use `SameSite=Lax`; local HTTP uses `Secure=false` by default. Set `APISENTINEL_COOKIE_SECURE=true` when serving over HTTPS. Do not expose the local development server or use it in production without HTTPS, a secure deployment configuration, and backups.

The database was backed up before the authentication schema migration to `data/apisentinel.pre-auth-20261017T0050.db`. Keep that backup until the migrated application and retained legacy rows have been verified. Password recovery is not implemented; there is no password-reset API or configured email-delivery mechanism.

## Notes for beginners

- Use `python3`, not `python`.
- A pickle version warning from XGBoost is expected. The model still loads.
- Feature formulas live in `backend/features.py`. If they do not match your Colab notebook exactly, we can adjust them later.

## Browser regression tests

Run the Playwright workflow tests from `frontend/` with `npm run test:e2e`. They start a local Vite server and a separate FastAPI server on ports 5173 and 8001. The backend uses a newly created SQLite database under the operating system's temporary directory and removes it after a normal test run; it never uses `data/apisentinel.db`. The tests allow browser requests only to `127.0.0.1` and use `https://api.example.test` only as inert website-registration data.

The batch CSV analyzer reads files locally in the browser and never uploads the CSV itself. It accepts `url` and `payload`, plus optional `method`; absent or blank methods default to `GET`, and an explicitly empty payload is valid. Existing file/parse limits remain 1 MiB, 1,000 data rows, and 32 columns. Each row is checked for the expected number of cells, a non-empty URL, the existing 8,192-character URL limit, and the existing 256 KiB payload limit before any requests are sent. Invalid rows are reported and excluded; valid rows are sent sequentially through the authenticated manual prediction endpoint. Failed rows are not automatically retried, and the batch must be reset before loading another file. The results CSV includes row number, URL, method, prediction, and status/error. A successful prediction response does not guarantee database persistence; after processing, verify successful rows in Request history.

The backend test server uses `.venv/bin/python` and the bundled `vendor/libomp` library. Playwright is configured for the installed Google Chrome channel because the bundled Chromium download is not supported by this project's current macOS 12.7 environment. Keep ports 5173 and 8001 available before running the suite.
