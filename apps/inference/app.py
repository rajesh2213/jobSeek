"""
Job description line classifier API.
Loads a HuggingFace sequence-classification model once at startup; runs batched inference.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Default: apps/inference/models/job-parser-model
_DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models" / "job-parser-model"
MODEL_DIR = Path(os.environ.get("JOB_PARSER_MODEL_DIR", str(_DEFAULT_MODEL_DIR))).resolve()

# API / Pydantic field order (stable JSON shape). Bucket assignment uses model.config.id2label only.
API_LABEL_KEYS = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
]

tokenizer = None
model = None
label_names: list[str] = []
device = None

app = FastAPI(title="JobSeek Inference", version="1.0.0")


class ParseRequest(BaseModel):
    description: str = Field(..., min_length=1)


class ParseResponse(BaseModel):
    position: list[str]
    responsibility: list[str]
    requirement: list[str]
    experience: list[str]
    benefit: list[str]
    contact: list[str]
    other: list[str]


def _resolve_label_names() -> list[str]:
    """Map class index -> label string from the loaded HF config (never hardcode training order)."""
    global model
    if model is None:
        return list(API_LABEL_KEYS)
    cfg = getattr(model.config, "id2label", None) or {}
    if not cfg:
        return list(API_LABEL_KEYS)
    num = int(getattr(model.config, "num_labels", len(cfg)))
    out: list[str] = []
    for i in range(num):
        v = cfg.get(str(i), cfg.get(i))
        if v is None:
            v = API_LABEL_KEYS[min(i, len(API_LABEL_KEYS) - 1)]
        out.append(str(v).lower())
    return out if out else list(API_LABEL_KEYS)


def _empty_buckets() -> dict[str, list[str]]:
    return {k: [] for k in API_LABEL_KEYS}


@app.on_event("startup")
def load_model() -> None:
    global tokenizer, model, label_names, device
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    if not MODEL_DIR.is_dir():
        raise RuntimeError(
            f"Model directory not found: {MODEL_DIR}. "
            "Set JOB_PARSER_MODEL_DIR or place the model under apps/inference/models/job-parser-model."
        )

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
    model.eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    label_names.clear()
    label_names.extend(_resolve_label_names())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model_loaded": str(model is not None)}


@app.post("/parse", response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    import torch
    import torch.nn.functional as F

    lines = [ln.strip() for ln in req.description.splitlines() if ln.strip()]
    if not lines:
        return ParseResponse(**_empty_buckets())

    batch_size = int(os.environ.get("JOB_PARSER_BATCH_SIZE", "32"))
    all_preds: list[int] = []
    all_conf: list[float] = []

    with torch.no_grad():
        for start in range(0, len(lines), batch_size):
            batch = lines[start : start + batch_size]
            enc = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            enc = {k: v.to(device) for k, v in enc.items()}
            logits = model(**enc).logits
            probs = F.softmax(logits, dim=-1)
            max_conf, preds = probs.max(dim=-1)
            all_preds.extend(preds.cpu().tolist())
            all_conf.extend(max_conf.cpu().tolist())

    buckets = _empty_buckets()
    names = label_names if label_names else list(API_LABEL_KEYS)

    min_conf = float(os.environ.get("JOB_PARSER_MIN_CONFIDENCE", "0.6"))
    short_other = int(os.environ.get("JOB_PARSER_SHORT_OTHER_CHARS", "50"))

    for line, pred_id, conf in zip(lines, all_preds, all_conf):
        if float(conf) < min_conf:
            continue
        idx = int(pred_id)
        if 0 <= idx < len(names):
            lab = names[idx]
        else:
            lab = "other"
        if lab not in buckets:
            lab = "other"
        if lab == "other" and len(line) < short_other:
            continue
        buckets[lab].append(line)

    for k in API_LABEL_KEYS:
        buckets.setdefault(k, [])

    return ParseResponse(
        position=buckets["position"],
        responsibility=buckets["responsibility"],
        requirement=buckets["requirement"],
        experience=buckets["experience"],
        benefit=buckets["benefit"],
        contact=buckets["contact"],
        other=buckets["other"],
    )
