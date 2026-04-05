# Job description inference service

FastAPI + HuggingFace `AutoModelForSequenceClassification` for line-level job description labeling.

## Model path

Place your trained model under:

`apps/inference/models/job-parser-model/`

(or set `JOB_PARSER_MODEL_DIR` to an absolute path).

## Run

```bash
cd apps/inference
python -m venv .venv
# Windows CMD:        .venv\Scripts\activate
# Windows Git Bash:   source .venv/Scripts/activate
# macOS/Linux:        source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8001
```

If you skip the venv, you still need a one-time install: `pip install -r requirements.txt`, then run `python -m uvicorn ...` (not bare `uvicorn`, unless your PATH includes the install location).

Optional:

- `JOB_PARSER_BATCH_SIZE` — inference batch size (default `32`).

## API

- `POST /parse` — body `{ "description": "..." }` → JSON with `position`, `responsibility`, `requirement`, `experience`, `benefit`, `contact`, `other` (string arrays).
